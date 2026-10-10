// @vitest-environment node
//
// Tests for the startup maintenance sweep (db-rpc/maintenance.js):
//   - sweepExpiredTrash deletes trashed rows older than the retention window
//   - it keeps recently-trashed rows and never touches live (is_deleted=0) rows
//   - FK ON DELETE CASCADE removes a purged transcript's children
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts);
// it defaults foreign_keys ON, which the cascade assertion relies on.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/maintenance.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

const DAY = 24 * 60 * 60 * 1000;

function seedTranscript(db: DatabaseSync, id: string, overrides: Record<string, string | number> = {}) {
  const cols: Record<string, string | number> = { id, title: `t-${id}`, filename: `${id}.mp3`, ...overrides };
  const keys = Object.keys(cols);
  db.prepare(
    `INSERT INTO transcripts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => cols[k]));
}

function seedProject(db: DatabaseSync, id: string, overrides: Record<string, string | number> = {}) {
  const cols: Record<string, string | number> = { id, name: `p-${id}`, ...overrides };
  const keys = Object.keys(cols);
  db.prepare(
    `INSERT INTO projects (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => cols[k]));
}

describe('db-rpc maintenance sweepExpiredTrash', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeMaintenance>;
  const NOW = Date.UTC(2026, 4, 21); // fixed "now" for deterministic cutoffs
  const iso = (ms: number) => new Date(ms).toISOString();

  beforeEach(() => {
    db = makeDb();
    api = mod.makeMaintenance(() => db);
  });

  it('purges trash older than 30 days, keeps newer + live rows', () => {
    seedTranscript(db, 'old', { is_deleted: 1, deleted_at: iso(NOW - 31 * DAY) });
    seedTranscript(db, 'recent', { is_deleted: 1, deleted_at: iso(NOW - 5 * DAY) });
    seedTranscript(db, 'live'); // is_deleted defaults 0
    seedProject(db, 'oldp', { is_deleted: 1, deleted_at: iso(NOW - 40 * DAY) });
    seedProject(db, 'livep');

    const result = api.sweepExpiredTrash({ now: NOW, retentionDays: 30 });
    expect(result.transcripts).toBe(1);
    expect(result.projects).toBe(1);

    const tids = db.prepare('SELECT id FROM transcripts ORDER BY id').all().map((r: any) => r.id);
    expect(tids).toEqual(['live', 'recent']);
    const pids = db.prepare('SELECT id FROM projects').all().map((r: any) => r.id);
    expect(pids).toEqual(['livep']);
  });

  it('reports which transcript ids it purged, so the caller can clear their vector chunks', () => {
    // The sweep deletes SQLite rows only. LanceDB rows outlive them, so the
    // caller needs the ids to purge embeddings — otherwise a swept transcript's
    // full text stays searchable forever.
    seedTranscript(db, 'expired-a', { is_deleted: 1, deleted_at: iso(NOW - 31 * DAY) });
    seedTranscript(db, 'expired-b', { is_deleted: 1, deleted_at: iso(NOW - 90 * DAY) });
    seedTranscript(db, 'recent', { is_deleted: 1, deleted_at: iso(NOW - 5 * DAY) });
    seedTranscript(db, 'live');

    const result = api.sweepExpiredTrash({ now: NOW, retentionDays: 30 });

    expect(result.transcriptIds.sort()).toEqual(['expired-a', 'expired-b']);
    // Not-yet-expired and live transcripts must not be listed.
    expect(result.transcriptIds).not.toContain('recent');
    expect(result.transcriptIds).not.toContain('live');
  });

  it('returns an empty transcriptIds list when nothing expired', () => {
    seedTranscript(db, 'live');
    const result = api.sweepExpiredTrash({ now: NOW, retentionDays: 30 });
    expect(result.transcriptIds).toEqual([]);
  });

  it('compares chronologically regardless of the stored timestamp format', () => {
    // deleted_at's SQL default is CURRENT_TIMESTAMP, which SQLite fills as
    // 'YYYY-MM-DD HH:MM:SS' (space separator, no Z) — a DIFFERENT shape from
    // the ISO-8601 string softDelete writes. A plain `<` string compare orders
    // those two shapes by the separator byte (' ' = 0x20 < 'T' = 0x54), so a
    // row written by anything other than softDelete gets mis-bucketed near the
    // cutoff. datetime() normalises both.
    const sqliteFormat = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

    // Written 40 days ago in SQLite's format -> must be swept.
    seedTranscript(db, 'old-sqlite-fmt', {
      is_deleted: 1,
      deleted_at: sqliteFormat(NOW - 40 * DAY),
    });
    // Written 5 days ago in SQLite's format -> must be kept.
    seedTranscript(db, 'recent-sqlite-fmt', {
      is_deleted: 1,
      deleted_at: sqliteFormat(NOW - 5 * DAY),
    });
    // Mixed formats, both expired.
    seedTranscript(db, 'old-iso-fmt', { is_deleted: 1, deleted_at: iso(NOW - 45 * DAY) });

    const result = api.sweepExpiredTrash({ now: NOW, retentionDays: 30 });

    expect(result.transcripts).toBe(2);
    expect(result.transcriptIds.sort()).toEqual(['old-iso-fmt', 'old-sqlite-fmt']);

    const survivors = db.prepare('SELECT id FROM transcripts ORDER BY id').all().map((r: any) => r.id);
    expect(survivors).toEqual(['recent-sqlite-fmt']);
  });

  it('cascades to a purged transcript\'s children', () => {
    seedTranscript(db, 'old', { is_deleted: 1, deleted_at: iso(NOW - 31 * DAY) });
    db.prepare(
      "INSERT INTO chat_conversations (id, transcript_id) VALUES ('c1', 'old')"
    ).run();
    db.prepare(
      "INSERT INTO transcript_segments (transcript_id, sentence_index, text) VALUES ('old', 0, 'hi')"
    ).run();

    api.sweepExpiredTrash({ now: NOW, retentionDays: 30 });

    expect(db.prepare('SELECT COUNT(*) c FROM chat_conversations').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM transcript_segments').get()).toEqual({ c: 0 });
  });

  it('is a no-op when nothing is expired', () => {
    seedTranscript(db, 'recent', { is_deleted: 1, deleted_at: iso(NOW - 1 * DAY) });
    expect(api.sweepExpiredTrash({ now: NOW, retentionDays: 30 })).toMatchObject({
      transcripts: 0,
      projects: 0,
    });
  });
});
