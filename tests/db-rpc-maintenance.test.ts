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
