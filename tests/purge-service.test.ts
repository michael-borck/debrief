// @vitest-environment node
//
// Tests for the coordinated permanent-delete service.
//
// Why this module exists: deletion was orchestrated in the renderer, which
// called db.transcripts.remove() and vectorStore.deleteTranscriptChunks() as two
// separate IPCs. Only one of the four call sites remembered the vector call, so
// "permanently deleted" transcripts kept their full text, speakers and
// timestamps in the LanceDB vector store indefinitely — and stayed searchable,
// because searchSimilar filtered on transcriptId/speaker but never on the
// transcript's is_deleted flag.
//
// These tests pin the behaviours that fix that:
//   - a transcript purge removes BOTH the SQLite row and the embeddings
//   - vectors are purged BEFORE the row is deleted
//   - a vector-store failure does not make a transcript undeletable
//   - project purge does NOT touch transcripts (schema: projects don't own them)
//   - per-id failures are reported rather than swallowed
//
// node:sqlite stands in for better-sqlite3 (same engine; better-sqlite3 is built
// against Electron's Node ABI and won't load under host-Node vitest). The vector
// store is a fake — purge-service only needs deleteTranscriptChunks.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { makePurgeService } = require('../public/electron/purge-service.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seedTranscript(db: DatabaseSync, id: string, extra: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    id,
    title: `title-${id}`,
    filename: `${id}.mp3`,
    status: 'completed',
    ...extra,
  };
  const keys = Object.keys(cols);
  db.prepare(
    `INSERT INTO transcripts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => cols[k]));
}

function seedProject(db: DatabaseSync, id: string) {
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, `project-${id}`);
}

/** Records the order of calls so we can assert vectors precede the row delete. */
function makeFakeVectorStore(
  chunks: Record<string, unknown[]>,
  opts: { throwOn?: string[] } = {}
) {
  const calls: string[] = [];
  return {
    calls,
    isInitialized: true,
    async deleteTranscriptChunks(id: string) {
      calls.push(`vector:${id}`);
      if (opts.throwOn?.includes(id)) throw new Error('LanceDB unavailable');
      delete chunks[id];
    },
  };
}

describe('purge-service', () => {
  describe('purgeTranscripts', () => {
    it('removes the SQLite row AND the vector chunks', async () => {
      const db = makeDb();
      seedTranscript(db, 't1');
      const chunks = { t1: [{ id: 'c1' }] };
      const vectorStore = makeFakeVectorStore(chunks);
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });

      const result = await service.purgeTranscripts(['t1']);

      expect(result.purged).toBe(1);
      expect(result.failed).toBe(0);
      expect(db.prepare('SELECT * FROM transcripts WHERE id = ?').get('t1')).toBeUndefined();
      expect(chunks.t1).toBeUndefined();
      expect(result.results[0].vectorsPurged).toBe(true);
    });

    it('purges vectors BEFORE deleting the SQLite row', async () => {
      const db = makeDb();
      seedTranscript(db, 't1');
      const order: string[] = [];
      const vectorStore = {
        isInitialized: true,
        async deleteTranscriptChunks() {
          order.push('vector');
        },
      };
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });
      const originalPrepare = db.prepare.bind(db);
      db.prepare = ((sql: string) => {
        if (sql.startsWith('DELETE FROM transcripts')) order.push('sqlite');
        return originalPrepare(sql);
      }) as typeof db.prepare;

      await service.purgeTranscripts(['t1']);

      expect(order).toEqual(['vector', 'sqlite']);
    });

    it('purges every transcript in a batch (the empty-trash path)', async () => {
      const db = makeDb();
      seedTranscript(db, 't1');
      seedTranscript(db, 't2');
      seedTranscript(db, 't3');
      const chunks = { t1: [{}], t2: [{}], t3: [{}] };
      const vectorStore = makeFakeVectorStore(chunks);
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });

      const result = await service.purgeTranscripts(['t1', 't2', 't3']);

      expect(result.purged).toBe(3);
      expect(Object.keys(chunks)).toEqual([]);
      expect(db.prepare('SELECT COUNT(*) AS c FROM transcripts').get().c).toBe(0);
    });

    it('still deletes the row when the vector purge fails, and reports it', async () => {
      // A corrupt/locked LanceDB must not make a transcript undeletable — that
      // would trap user data. The row goes; the failure is surfaced.
      const db = makeDb();
      seedTranscript(db, 't1');
      const vectorStore = makeFakeVectorStore({}, { throwOn: ['t1'] });
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });

      const result = await service.purgeTranscripts(['t1']);

      expect(result.purged).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.vectorFailures).toBe(1);
      expect(result.results[0].vectorFailed).toBe(true);
      expect(db.prepare('SELECT * FROM transcripts WHERE id = ?').get('t1')).toBeUndefined();
    });

    it('treats an uninitialized vector store as nothing-to-purge, not a failure', async () => {
      const db = makeDb();
      seedTranscript(db, 't1');
      const service = makePurgeService({
        getDb: () => db,
        getVectorStore: () => null,
      });

      const result = await service.purgeTranscripts(['t1']);

      expect(result.failed).toBe(0);
      expect(result.vectorFailures).toBe(0);
      expect(result.results[0].vectorsPurged).toBe(false);
      expect(db.prepare('SELECT * FROM transcripts WHERE id = ?').get('t1')).toBeUndefined();
    });

    it('cascades to segments via the FK', async () => {
      const db = makeDb();
      seedTranscript(db, 't1');
      db.prepare(
        'INSERT INTO transcript_segments (transcript_id, sentence_index, text, word_count) VALUES (?, ?, ?, ?)'
      ).run('t1', 0, 'hello there', 2);
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => null });

      await service.purgeTranscripts(['t1']);

      expect(
        db.prepare('SELECT COUNT(*) AS c FROM transcript_segments WHERE transcript_id = ?').get('t1').c
      ).toBe(0);
    });

    it('reports an invalid id without touching the database', async () => {
      const db = makeDb();
      const vectorStore = makeFakeVectorStore({});
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });

      const result = await service.purgeTranscripts(['' as string]);

      expect(result.failed).toBe(1);
      expect(result.results[0].ok).toBe(false);
      // The vector store was never asked to purge a bogus id.
      expect(vectorStore.calls).toEqual([]);
    });

    it('rejects a non-array argument', async () => {
      const db = makeDb();
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => null });
      await expect(service.purgeTranscripts('t1' as unknown as string[])).rejects.toThrow(
        /requires an array/
      );
    });
  });

  describe('purgeProjects', () => {
    it('deletes the project but NOT its transcripts', async () => {
      // database/schema.sql: project_transcripts cascades both ways, but a
      // transcript has no ownership relation to a project. Purging vectors here
      // would orphan a still-existing transcript from its search index.
      const db = makeDb();
      seedProject(db, 'p1');
      seedTranscript(db, 't1');
      db.prepare('INSERT INTO project_transcripts (project_id, transcript_id) VALUES (?, ?)').run(
        'p1',
        't1'
      );
      const chunks = { t1: [{ id: 'c1' }] };
      const vectorStore = makeFakeVectorStore(chunks);
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });

      const result = await service.purgeProjects(['p1']);

      expect(result.purged).toBe(1);
      expect(db.prepare('SELECT * FROM projects WHERE id = ?').get('p1')).toBeUndefined();
      expect(db.prepare('SELECT * FROM transcripts WHERE id = ?').get('t1')).toBeDefined();
      expect(chunks.t1).toHaveLength(1);
      expect(vectorStore.calls).toEqual([]);
    });
  });

  describe('purge (mixed)', () => {
    it('routes transcripts and projects to the right store', async () => {
      const db = makeDb();
      seedTranscript(db, 't1');
      seedProject(db, 'p1');
      const chunks = { t1: [{}] };
      const vectorStore = makeFakeVectorStore(chunks);
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });

      const result = await service.purge({ transcripts: ['t1'], projects: ['p1'] });

      expect(result.failed).toBe(0);
      expect(result.transcripts.purged).toBe(1);
      expect(result.projects.purged).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS c FROM transcripts').get().c).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM projects').get().c).toBe(0);
    });

    it('handles an empty request', async () => {
      const db = makeDb();
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => null });
      const result = await service.purge({});
      expect(result.failed).toBe(0);
      expect(result.transcripts.purged).toBe(0);
      expect(result.projects.purged).toBe(0);
    });
  });

  describe('purgeVectorsForMany (the 30-day trash sweep path)', () => {
    it('purges vectors for each id and survives one failing id', async () => {
      const db = makeDb();
      const chunks = { t1: [{}], t2: [{}], t3: [{}] };
      const vectorStore = makeFakeVectorStore(chunks, { throwOn: ['t2'] });
      const service = makePurgeService({ getDb: () => db, getVectorStore: () => vectorStore });

      const result = await service.purgeVectorsForMany(['t1', 't2', 't3']);

      expect(result.failed).toBe(1);
      expect(result.purged).toBe(2);
      expect(chunks.t1).toBeUndefined();
      expect(chunks.t3).toBeUndefined();
    });
  });
});