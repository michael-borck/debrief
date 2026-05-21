// @vitest-environment node
//
// Regression test for the foreign_keys pragma fix.
//
// Before the fix: every `ON DELETE CASCADE` in schema.sql was a no-op because
// better-sqlite3 defaults to `PRAGMA foreign_keys = OFF`. Deleting a project
// or transcript silently left orphan rows in project_transcripts,
// project_chat_*, project_analysis, transcript_segments, and similar tables.
//
// These tests load the real schema into an in-memory DB so the schema and the
// cascade contracts stay in sync as columns evolve. We use node:sqlite (built
// into Node 22+) rather than better-sqlite3 because the app's better-sqlite3
// binding is compiled for Electron's Node ABI by `electron-builder
// install-app-deps`, which makes it unusable from host-Node test runs.
// node:sqlite uses the same SQLite engine, so cascade semantics are identical.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = resolve(__dirname, '..', 'database', 'schema.sql');
const SCHEMA_SQL = readFileSync(SCHEMA_PATH, 'utf8');

function makeDb(opts: { foreignKeys: boolean }) {
  const db = new DatabaseSync(':memory:');
  // node:sqlite defaults foreign_keys to ON; better-sqlite3 (what the app
  // uses at runtime) defaults to OFF. We set both branches explicitly so
  // the test asserts the schema's behavior under each, independent of the
  // driver's default. The app's electron.js sets `foreign_keys = ON` after
  // opening the DB; this test proves that pragma is load-bearing.
  db.exec(`PRAGMA foreign_keys = ${opts.foreignKeys ? 'ON' : 'OFF'}`);
  db.exec(SCHEMA_SQL);
  return db;
}

function seedProjectWithChildren(db: DatabaseSync) {
  db.exec("INSERT INTO projects (id, name) VALUES ('p1', 'Project 1')");
  db.exec("INSERT INTO transcripts (id, title, filename) VALUES ('t1', 'T1', 'a.mp4')");
  db.exec("INSERT INTO project_transcripts (project_id, transcript_id) VALUES ('p1', 't1')");
  db.exec("INSERT INTO project_chat_conversations (id, project_id) VALUES ('c1', 'p1')");
  db.exec("INSERT INTO project_chat_messages (conversation_id, role, content) VALUES ('c1', 'user', 'hi')");
  db.exec("INSERT INTO project_analysis (id, project_id, analysis_type, results) VALUES ('a1', 'p1', 'theme', '{}')");
  db.exec("INSERT INTO transcript_segments (transcript_id, sentence_index, text) VALUES ('t1', 0, 'hello world')");
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

describe('database foreign-key cascades', () => {
  it('proves the bug: without foreign_keys=ON, deleting a project leaves orphans', () => {
    const db = makeDb({ foreignKeys: false });
    seedProjectWithChildren(db);

    db.exec("DELETE FROM projects WHERE id = 'p1'");

    // Without the pragma every child row stays.
    expect(countRows(db, 'project_transcripts')).toBe(1);
    expect(countRows(db, 'project_chat_conversations')).toBe(1);
    expect(countRows(db, 'project_chat_messages')).toBe(1);
    expect(countRows(db, 'project_analysis')).toBe(1);
  });

  it('with foreign_keys=ON, deleting a project cascades to all child tables', () => {
    const db = makeDb({ foreignKeys: true });
    seedProjectWithChildren(db);

    db.exec("DELETE FROM projects WHERE id = 'p1'");

    expect(countRows(db, 'project_transcripts')).toBe(0);
    expect(countRows(db, 'project_chat_conversations')).toBe(0);
    expect(countRows(db, 'project_chat_messages')).toBe(0);
    expect(countRows(db, 'project_analysis')).toBe(0);
    // The transcript itself is not owned by the project, only the junction row goes.
    expect(countRows(db, 'transcripts')).toBe(1);
  });

  it('with foreign_keys=ON, deleting a transcript cascades segments + junction', () => {
    const db = makeDb({ foreignKeys: true });
    seedProjectWithChildren(db);

    db.exec("DELETE FROM transcripts WHERE id = 't1'");

    expect(countRows(db, 'transcript_segments')).toBe(0);
    expect(countRows(db, 'project_transcripts')).toBe(0);
    expect(countRows(db, 'transcripts')).toBe(0);
  });

  it('with foreign_keys=ON, deleting a chat conversation cascades its messages', () => {
    const db = makeDb({ foreignKeys: true });
    db.exec("INSERT INTO transcripts (id, title, filename) VALUES ('t1', 'T1', 'a.mp4')");
    db.exec("INSERT INTO chat_conversations (id, transcript_id) VALUES ('cc1', 't1')");
    db.exec("INSERT INTO chat_messages (conversation_id, role, content) VALUES ('cc1', 'user', 'hi')");
    db.exec("INSERT INTO conversation_memory (conversation_id, total_exchanges) VALUES ('cc1', 1)");

    db.exec("DELETE FROM chat_conversations WHERE id = 'cc1'");

    expect(countRows(db, 'chat_messages')).toBe(0);
    expect(countRows(db, 'conversation_memory')).toBe(0);
  });
});
