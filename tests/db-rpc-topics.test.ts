// @vitest-environment node
//
// Tests for the topics per-domain RPC (transcript_topics):
//   - listByTranscript orders by topic_index, scoped to one transcript
//   - replaceForTranscript wipes + rewrites atomically, serializing the
//     chunk_ids/centroid JSON columns and defaulting topic_index to position
//   - a bad row id rolls the whole replace back (no partial write)
//   - deleteByTranscript clears a transcript's topics
//
// transcript_topics is created at runtime in electron.js (not schema.sql),
// so the test creates it. node:sqlite has no transaction(fn), so we shim it
// the same way db-rpc-settings.test.ts does.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/topics.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

const TOPICS_TABLE = `
  CREATE TABLE transcript_topics (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL,
    topic_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    summary TEXT,
    chunk_ids TEXT NOT NULL,
    centroid TEXT,
    model_used TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
  )`;

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.exec(TOPICS_TABLE);
  return db;
}

// node:sqlite lacks a transaction(fn) helper; wrap one (see settings test).
function shim(db: DatabaseSync): any {
  return {
    prepare: db.prepare.bind(db),
    exec: db.exec.bind(db),
    transaction(fn: (arg: any) => void) {
      return (arg: any) => {
        db.exec('BEGIN');
        try {
          fn(arg);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      };
    },
  };
}

function seedTranscript(db: DatabaseSync, id: string) {
  db.prepare('INSERT INTO transcripts (id, title, filename) VALUES (?, ?, ?)').run(
    id,
    `t-${id}`,
    `${id}.mp3`
  );
}

describe('db-rpc topics', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeTopics>;

  beforeEach(() => {
    db = makeDb();
    api = mod.makeTopics(() => shim(db));
    seedTranscript(db, 't1');
    seedTranscript(db, 't2');
  });

  it('replaceForTranscript inserts rows, serializing JSON columns', () => {
    const result = api.replaceForTranscript('t1', [
      { id: 'a', label: 'Intro', summary: 's', chunk_ids: ['c1', 'c2'], centroid: [0.1, 0.2] },
      { id: 'b', label: 'Body', chunk_ids: ['c3'], model_used: 'm1' },
    ]);
    expect(result).toEqual({ count: 2 });
    const rows = api.listByTranscript('t1');
    expect(rows.map((r: any) => r.id)).toEqual(['a', 'b']);
    expect(rows[0].topic_index).toBe(0);
    expect(rows[1].topic_index).toBe(1);
    expect(rows[0].chunk_ids).toBe('["c1","c2"]');
    expect(rows[0].centroid).toBe('[0.1,0.2]');
    expect(rows[1].model_used).toBe('m1');
  });

  it('replaceForTranscript wipes the previous set and is scoped per transcript', () => {
    api.replaceForTranscript('t1', [{ id: 'a', label: 'old', chunk_ids: [] }]);
    api.replaceForTranscript('t2', [{ id: 'z', label: 'other', chunk_ids: [] }]);
    api.replaceForTranscript('t1', [{ id: 'b', label: 'new', chunk_ids: [] }]);
    expect(api.listByTranscript('t1').map((r: any) => r.id)).toEqual(['b']);
    expect(api.listByTranscript('t2').map((r: any) => r.id)).toEqual(['z']);
  });

  it('rolls back the whole replace if a row is invalid (atomic)', () => {
    api.replaceForTranscript('t1', [{ id: 'keep', label: 'keep', chunk_ids: [] }]);
    expect(() =>
      api.replaceForTranscript('t1', [
        { id: 'good', label: 'g', chunk_ids: [] },
        { id: '', label: 'bad', chunk_ids: [] },
      ])
    ).toThrow(/topic row requires a string id/);
    // the original row survives; the partial new write was rolled back
    expect(api.listByTranscript('t1').map((r: any) => r.id)).toEqual(['keep']);
  });

  it('deleteByTranscript clears a transcript and reports changes', () => {
    api.replaceForTranscript('t1', [
      { id: 'a', label: 'x', chunk_ids: [] },
      { id: 'b', label: 'y', chunk_ids: [] },
    ]);
    expect(api.deleteByTranscript('t1')).toEqual({ changes: 2 });
    expect(api.listByTranscript('t1')).toHaveLength(0);
  });

  it('rejects a bad id', () => {
    expect(() => api.listByTranscript('')).toThrow(/invalid transcript id/);
    expect(() => api.deleteByTranscript(42 as any)).toThrow(/invalid transcript id/);
  });
});
