// @vitest-environment node
//
// Tests for the project_transcripts per-domain RPC (junction + JOIN reads):
//   - listProjectsWithStats rolls up transcript_count/duration, excludes
//     archived+trashed projects, and excludes soft-deleted transcripts
//   - getProjectWithStats returns one project + stats (incl. archived)
//   - listTranscriptsForProject honours includeDeleted/completedOnly/orderBy
//     and never lets a bad orderBy inject SQL
//   - listProjectIdsForTranscript / listTrashedTranscriptIdsForProject
//   - link is idempotent (INSERT OR IGNORE); unlink removes
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts).
// FKs default ON here, so parent rows are seeded before junction rows.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/projectTranscripts.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seedProject(db: DatabaseSync, id: string, overrides: Record<string, string | number> = {}) {
  const cols: Record<string, string | number> = { id, name: `proj-${id}`, ...overrides };
  const keys = Object.keys(cols);
  db.prepare(
    `INSERT INTO projects (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => cols[k]));
}

function seedTranscript(
  db: DatabaseSync,
  id: string,
  overrides: Record<string, string | number> = {}
) {
  const cols: Record<string, string | number> = {
    id,
    title: `t-${id}`,
    filename: `${id}.mp3`,
    ...overrides,
  };
  const keys = Object.keys(cols);
  db.prepare(
    `INSERT INTO transcripts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => cols[k]));
}

describe('db-rpc project_transcripts', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeProjectTranscripts>;

  beforeEach(() => {
    db = makeDb();
    api = mod.makeProjectTranscripts(() => db);
  });

  describe('listProjectsWithStats', () => {
    it('rolls up counts/duration, summing only non-deleted transcripts', () => {
      seedProject(db, 'p1', { updated_at: '2026-01-02' });
      seedTranscript(db, 't1', { duration: 100 });
      seedTranscript(db, 't2', { duration: 50 });
      seedTranscript(db, 't3', { duration: 999, is_deleted: 1 });
      api.link('p1', 't1');
      api.link('p1', 't2');
      api.link('p1', 't3');
      const [row] = api.listProjectsWithStats();
      expect(row.id).toBe('p1');
      // total_duration excludes the soft-deleted transcript (the JOIN filters t).
      expect(row.total_duration).toBe(150);
      // transcript_count mirrors the original query: it counts junction rows
      // (pt.transcript_id), so a project's soft-deleted transcripts still count.
      expect(row.transcript_count).toBe(3);
    });

    it('omits archived and trashed projects', () => {
      seedProject(db, 'live', { updated_at: '2026-01-03' });
      seedProject(db, 'arch', { is_archived: 1, archived_at: '2026-01-01' });
      seedProject(db, 'trash', { is_deleted: 1, deleted_at: '2026-01-01' });
      expect(api.listProjectsWithStats().map((r: any) => r.id)).toEqual(['live']);
    });
  });

  describe('getProjectWithStats', () => {
    it('returns a single project with stats', () => {
      seedProject(db, 'p1');
      seedTranscript(db, 't1', { duration: 30 });
      api.link('p1', 't1');
      const row = api.getProjectWithStats('p1');
      expect(row.name).toBe('proj-p1');
      expect(row.transcript_count).toBe(1);
      expect(row.total_duration).toBe(30);
    });

    it('returns null for an unknown id and rejects a bad id', () => {
      expect(api.getProjectWithStats('nope')).toBeNull();
      expect(() => api.getProjectWithStats(42 as any)).toThrow(/invalid project id/);
    });
  });

  describe('listTranscriptsForProject', () => {
    beforeEach(() => {
      seedProject(db, 'p1');
      seedTranscript(db, 'a', { status: 'completed', created_at: '2026-01-01' });
      seedTranscript(db, 'b', { status: 'processing', created_at: '2026-01-02' });
      seedTranscript(db, 'c', { status: 'completed', created_at: '2026-01-03', is_deleted: 1 });
      db.prepare("INSERT INTO project_transcripts (project_id, transcript_id, added_at) VALUES ('p1','a','2026-02-03')").run();
      db.prepare("INSERT INTO project_transcripts (project_id, transcript_id, added_at) VALUES ('p1','b','2026-02-01')").run();
      db.prepare("INSERT INTO project_transcripts (project_id, transcript_id, added_at) VALUES ('p1','c','2026-02-02')").run();
    });

    it('default excludes deleted, orders by added_at desc', () => {
      expect(api.listTranscriptsForProject('p1').map((r: any) => r.id)).toEqual(['a', 'b']);
    });

    it('includeDeleted keeps trashed rows', () => {
      const ids = api
        .listTranscriptsForProject('p1', { includeDeleted: true, orderBy: 'created_asc' })
        .map((r: any) => r.id);
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('completedOnly + created_asc filters and orders', () => {
      const ids = api
        .listTranscriptsForProject('p1', { completedOnly: true, orderBy: 'created_asc' })
        .map((r: any) => r.id);
      expect(ids).toEqual(['a']); // b is processing, c is deleted
    });

    it('an unknown orderBy falls back to the default (no injection)', () => {
      const ids = api
        .listTranscriptsForProject('p1', { orderBy: 'id; DROP TABLE transcripts' as any })
        .map((r: any) => r.id);
      expect(ids).toEqual(['a', 'b']);
      // table still intact
      expect(db.prepare('SELECT COUNT(*) c FROM transcripts').get()).toEqual({ c: 3 });
    });
  });

  describe('junction reads', () => {
    beforeEach(() => {
      seedProject(db, 'p1');
      seedProject(db, 'p2');
      seedTranscript(db, 't1');
      seedTranscript(db, 't2', { is_deleted: 1 });
      api.link('p1', 't1');
      api.link('p2', 't1');
      api.link('p1', 't2');
    });

    it('listProjectIdsForTranscript returns every project for a transcript', () => {
      expect(api.listProjectIdsForTranscript('t1').map((r: any) => r.project_id).sort()).toEqual([
        'p1',
        'p2',
      ]);
    });

    it('listTrashedTranscriptIdsForProject returns only trashed ids', () => {
      expect(api.listTrashedTranscriptIdsForProject('p1').map((r: any) => r.id)).toEqual(['t2']);
    });

    it('countForProject counts all junction rows (incl. deleted)', () => {
      expect(api.countForProject('p1')).toBe(2); // t1 + t2
      expect(api.countForProject('p2')).toBe(1); // t1
    });
  });

  describe('link / unlink', () => {
    beforeEach(() => {
      seedProject(db, 'p1');
      seedTranscript(db, 't1');
    });

    it('link is idempotent', () => {
      expect(api.link('p1', 't1')).toEqual({ changes: 1 });
      expect(api.link('p1', 't1')).toEqual({ changes: 0 });
      expect(api.listProjectIdsForTranscript('t1')).toHaveLength(1);
    });

    it('unlink removes the row', () => {
      api.link('p1', 't1');
      expect(api.unlink('p1', 't1')).toEqual({ changes: 1 });
      expect(api.listProjectIdsForTranscript('t1')).toHaveLength(0);
    });

    it('rejects bad ids', () => {
      expect(() => api.link('', 't1')).toThrow(/invalid project id/);
      expect(() => api.unlink('p1', 42 as any)).toThrow(/invalid transcript id/);
    });
  });
});
