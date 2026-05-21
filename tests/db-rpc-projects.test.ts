// @vitest-environment node
//
// Tests for the projects per-domain RPC. Focus areas:
//   - get excludes trashed projects; listArchived/listTrashed filter
//   - create inserts with main-side timestamps and serialized JSON columns
//   - update is allow-list gated: unknown columns throw, no SQL injected
//   - archive/restore/unarchive flip flags + timestamps
//   - remove deletes
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts).

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const projectsModule = require('../public/electron/db-rpc/projects.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seed(db: DatabaseSync, id: string, overrides: Record<string, string> = {}) {
  const cols: Record<string, string> = { id, name: `name-${id}`, ...overrides };
  const keys = Object.keys(cols);
  const placeholders = keys.map(() => '?').join(', ');
  db.prepare(`INSERT INTO projects (${keys.join(', ')}) VALUES (${placeholders})`).run(
    ...keys.map((k) => cols[k])
  );
}

describe('db-rpc projects', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof projectsModule.makeProjects>;

  beforeEach(() => {
    db = makeDb();
    api = projectsModule.makeProjects(() => db);
  });

  describe('reads', () => {
    it('get returns a live project but null for a trashed one', () => {
      seed(db, 'a');
      seed(db, 'b', { is_deleted: '1', deleted_at: '2026-01-01' });
      expect(api.get('a').name).toBe('name-a');
      expect(api.get('b')).toBeNull();
    });

    it('get rejects a non-string id', () => {
      expect(() => api.get(42)).toThrow(/invalid project id/);
    });

    it('listArchived / listTrashed filter correctly', () => {
      seed(db, 'a', { is_archived: '1', archived_at: '2026-01-02' });
      seed(db, 'b', { is_deleted: '1', deleted_at: '2026-01-03' });
      seed(db, 'c');
      expect(api.listArchived().map((r: any) => r.id)).toEqual(['a']);
      expect(api.listTrashed().map((r: any) => r.id)).toEqual(['b']);
    });
  });

  describe('create', () => {
    it('inserts a row with timestamps and serialized JSON columns', () => {
      api.create({
        id: 'p1',
        name: 'Research',
        description: 'desc',
        themes: ['t1', 't2'],
        key_insights: ['i1'],
        tags: ['x'],
        color: '#fff',
        icon: '📁',
      });
      const row = api.get('p1');
      expect(row.name).toBe('Research');
      expect(row.themes).toBe('["t1","t2"]');
      expect(row.key_insights).toBe('["i1"]');
      expect(row.tags).toBe('["x"]');
      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
    });

    it('defaults JSON columns to empty arrays', () => {
      api.create({ id: 'p2', name: 'Bare' });
      const row = api.get('p2');
      expect(row.themes).toBe('[]');
      expect(row.key_insights).toBe('[]');
      expect(row.tags).toBe('[]');
    });

    it('requires id and a non-empty name', () => {
      expect(() => api.create({ id: '', name: 'x' })).toThrow(/invalid project id/);
      expect(() => api.create({ id: 'x', name: '' })).toThrow(/name must be a non-empty string/);
    });
  });

  describe('update (allow-list)', () => {
    beforeEach(() => seed(db, 'a'));

    it('updates allow-listed scalar + JSON columns', () => {
      api.update('a', { name: 'Renamed', summary: 'S', themes: ['z'] });
      const row = api.get('a');
      expect(row.name).toBe('Renamed');
      expect(row.summary).toBe('S');
      expect(row.themes).toBe('["z"]');
    });

    it('passes a pre-stringified JSON value through unchanged', () => {
      api.update('a', { tags: '["already"]' });
      expect(api.get('a').tags).toBe('["already"]');
    });

    it('rejects an unknown column (the injection vector)', () => {
      expect(() => api.update('a', { 'name = 1; DROP TABLE projects; --': 'x' })).toThrow(
        /invalid project column/
      );
      expect(api.get('a').name).toBe('name-a');
    });

    it('rejects id and created_at', () => {
      expect(() => api.update('a', { id: 'b' })).toThrow(/invalid project column/);
      expect(() => api.update('a', { created_at: '1999' })).toThrow(/invalid project column/);
    });

    it('is a no-op for empty fields', () => {
      expect(api.update('a', {})).toEqual({ changes: 0 });
    });
  });

  describe('lifecycle', () => {
    beforeEach(() => seed(db, 'a'));

    it('archive sets flag + timestamp; unarchive clears them', () => {
      api.archive('a');
      let row = db.prepare('SELECT * FROM projects WHERE id = ?').get('a') as any;
      expect(row.is_archived).toBe(1);
      expect(row.archived_at).toBeTruthy();
      api.unarchive('a');
      row = db.prepare('SELECT * FROM projects WHERE id = ?').get('a') as any;
      expect(row.is_archived).toBe(0);
      expect(row.archived_at).toBeNull();
    });

    it('restore clears the deleted flag + timestamp', () => {
      seed(db, 'd', { is_deleted: '1', deleted_at: '2026-01-01' });
      api.restore('d');
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get('d') as any;
      expect(row.is_deleted).toBe(0);
      expect(row.deleted_at).toBeNull();
    });

    it('remove deletes the row', () => {
      expect(api.remove('a')).toEqual({ changes: 1 });
      expect(api.get('a')).toBeNull();
    });
  });
});
