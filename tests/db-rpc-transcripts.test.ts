// @vitest-environment node
//
// Tests for the transcripts per-domain RPC. Focus areas:
//   - reads return the expected rows / filtering
//   - create inserts a row with main-side timestamps
//   - update is allow-list gated (H-1): unknown columns throw, no SQL injected
//   - update serializes JSON columns and coerces booleans to 0/1
//   - archive/softDelete set timestamps; unarchive/restore clear them
//   - remove deletes
//
// node:sqlite stands in for better-sqlite3 (same engine; better-sqlite3 is
// built against Electron's Node ABI and won't load under host-Node vitest).
// node:sqlite rejects raw booleans, so these tests also prove the module's
// own boolean→int coercion works (better-sqlite3 v11 would coerce anyway).

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const transcriptsModule = require('../public/electron/db-rpc/transcripts.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seed(db: DatabaseSync, id: string, overrides: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    id,
    title: `title-${id}`,
    filename: `${id}.mp3`,
    status: 'completed',
    ...overrides,
  };
  const keys = Object.keys(cols);
  const placeholders = keys.map(() => '?').join(', ');
  db.prepare(`INSERT INTO transcripts (${keys.join(', ')}) VALUES (${placeholders})`).run(
    ...keys.map((k) => cols[k])
  );
}

describe('db-rpc transcripts', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof transcriptsModule.makeTranscripts>;

  beforeEach(() => {
    db = makeDb();
    api = transcriptsModule.makeTranscripts(() => db);
  });

  describe('list / get', () => {
    it('list excludes trashed rows', () => {
      seed(db, 'a');
      seed(db, 'b', { is_deleted: '1', deleted_at: '2026-01-01' });
      const rows = api.list();
      expect(rows.map((r: any) => r.id)).toEqual(['a']);
    });

    it('get returns the row, or null when missing', () => {
      seed(db, 'a');
      expect(api.get('a').title).toBe('title-a');
      expect(api.get('missing')).toBeNull();
    });

    it('get rejects a non-string id', () => {
      expect(() => api.get(undefined)).toThrow(/invalid transcript id/);
    });

    it('listArchived / listTrashed filter correctly', () => {
      seed(db, 'a', { is_archived: '1', archived_at: '2026-01-02' });
      seed(db, 'b', { is_deleted: '1', deleted_at: '2026-01-03' });
      seed(db, 'c');
      expect(api.listArchived().map((r: any) => r.id)).toEqual(['a']);
      expect(api.listTrashed().map((r: any) => r.id)).toEqual(['b']);
    });

    it('getForChat / getMetadata return the projected columns', () => {
      seed(db, 'a', { full_text: 'hello', processed_text: 'tagged', duration: '42', speaker_count: '3' });
      expect(api.getForChat('a')).toEqual({ title: 'title-a', full_text: 'hello', processed_text: 'tagged' });
      expect(api.getMetadata('a')).toEqual({ title: 'title-a', duration: 42, speaker_count: 3 });
    });

    it('findDuplicates matches filename or title', () => {
      seed(db, 'a', { filename: 'dup.mp3', title: 'Meeting' });
      expect(api.findDuplicates('dup.mp3', 'nope').map((r: any) => r.id)).toEqual(['a']);
      expect(api.findDuplicates('nope', 'Meeting').map((r: any) => r.id)).toEqual(['a']);
      expect(api.findDuplicates('none', 'none')).toEqual([]);
    });

    it('searchByText matches title/full_text/summary', () => {
      seed(db, 'a', { title: 'Quarterly review', full_text: 'x' });
      seed(db, 'b', { full_text: 'discussed the budget' });
      seed(db, 'c', { summary: 'budget summary' });
      const ids = api.searchByText('budget').map((r: any) => r.id).sort();
      expect(ids).toEqual(['b', 'c']);
    });

    it('listNeedingSegmentMigration excludes rows that already have original segments', () => {
      seed(db, 'a', { full_text: 'has segs' });
      seed(db, 'b', { full_text: 'no segs' });
      seed(db, 'c', { full_text: null as any, status: 'processing' });
      db.prepare(
        "INSERT INTO transcript_segments (transcript_id, sentence_index, text, version) VALUES (?, 0, 'x', 'original')"
      ).run('a');
      expect(api.listNeedingSegmentMigration().map((r: any) => r.id)).toEqual(['b']);
    });
  });

  describe('create', () => {
    it('inserts a row and sets created_at/updated_at', () => {
      api.create({ id: 'new1', title: 'Title', filename: 'f.mp3', file_size: 100 });
      const row = api.get('new1');
      expect(row.title).toBe('Title');
      expect(row.status).toBe('processing');
      expect(row.starred).toBe(0);
      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
    });

    it('coerces a boolean starred to 0/1', () => {
      api.create({ id: 'new2', title: 'T', filename: 'f.mp3', starred: true });
      expect(api.get('new2').starred).toBe(1);
    });

    it('requires id/title/filename', () => {
      expect(() => api.create({ id: '', title: 'T', filename: 'f' })).toThrow(/invalid transcript id/);
      expect(() => api.create({ id: 'x', title: 1 as any, filename: 'f' })).toThrow(/title must be a string/);
      expect(() => api.create({ id: 'x', title: 'T', filename: 2 as any })).toThrow(/filename must be a string/);
    });
  });

  describe('update (H-1 allow-list)', () => {
    beforeEach(() => seed(db, 'a'));

    it('updates allow-listed scalar columns', () => {
      api.update('a', { title: 'Renamed', summary: 'A summary' });
      const row = api.get('a');
      expect(row.title).toBe('Renamed');
      expect(row.summary).toBe('A summary');
    });

    it('serializes JSON columns from objects/arrays but passes strings through', () => {
      api.update('a', { tags: ['x', 'y'], speakers: [{ id: 's1' }] });
      expect(api.get('a').tags).toBe('["x","y"]');
      expect(api.get('a').speakers).toBe('[{"id":"s1"}]');
      // A pre-stringified value must not be double-encoded.
      api.update('a', { key_topics: '["already"]' });
      expect(api.get('a').key_topics).toBe('["already"]');
    });

    it('coerces boolean columns to 0/1', () => {
      api.update('a', { starred: true });
      expect(api.get('a').starred).toBe(1);
      api.update('a', { starred: false });
      expect(api.get('a').starred).toBe(0);
    });

    it('rejects an unknown column (the column-injection vector)', () => {
      expect(() => api.update('a', { 'title = 1; DROP TABLE transcripts; --': 'x' })).toThrow(
        /invalid transcript column/
      );
      // Table is intact and untouched.
      expect(api.get('a').title).toBe('title-a');
    });

    it('rejects id and created_at as updatable columns', () => {
      expect(() => api.update('a', { id: 'b' })).toThrow(/invalid transcript column/);
      expect(() => api.update('a', { created_at: '1999-01-01' })).toThrow(/invalid transcript column/);
    });

    it('is a no-op for an empty fields object', () => {
      expect(api.update('a', {})).toEqual({ changes: 0 });
    });
  });

  describe('lifecycle: archive / delete / restore / remove', () => {
    beforeEach(() => seed(db, 'a'));

    it('archive sets the flag + timestamp; unarchive clears them', () => {
      api.archive('a');
      let row = api.get('a');
      expect(row.is_archived).toBe(1);
      expect(row.archived_at).toBeTruthy();
      api.unarchive('a');
      row = api.get('a');
      expect(row.is_archived).toBe(0);
      expect(row.archived_at).toBeNull();
    });

    it('softDelete sets the flag + timestamp; restore clears them', () => {
      api.softDelete('a');
      let row = api.get('a');
      expect(row.is_deleted).toBe(1);
      expect(row.deleted_at).toBeTruthy();
      api.restore('a');
      row = api.get('a');
      expect(row.is_deleted).toBe(0);
      expect(row.deleted_at).toBeNull();
    });

    it('remove deletes the row', () => {
      expect(api.remove('a')).toEqual({ changes: 1 });
      expect(api.get('a')).toBeNull();
    });
  });
});
