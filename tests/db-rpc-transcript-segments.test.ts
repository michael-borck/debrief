// @vitest-environment node
//
// Tests for the transcriptSegments per-domain RPC (the all-versions
// transcript_segments read/delete that used to go through db-query):
//   - listByTranscript returns every version ordered by start_time
//   - deleteByTranscript removes all of a transcript's segments
//   - both reject a bad id
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts).

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/transcriptSegments.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seedTranscript(db: DatabaseSync, id: string) {
  db.prepare('INSERT INTO transcripts (id, title, filename) VALUES (?, ?, ?)').run(
    id,
    `t-${id}`,
    `${id}.mp3`
  );
}

function seedSegment(
  db: DatabaseSync,
  transcriptId: string,
  sentenceIndex: number,
  startTime: number,
  version = 'original',
  text = 'x'
) {
  db.prepare(
    'INSERT INTO transcript_segments (transcript_id, sentence_index, text, start_time, version) VALUES (?, ?, ?, ?, ?)'
  ).run(transcriptId, sentenceIndex, text, startTime, version);
}

describe('db-rpc transcriptSegments', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeTranscriptSegments>;

  beforeEach(() => {
    db = makeDb();
    api = mod.makeTranscriptSegments(() => db);
    seedTranscript(db, 't1');
    seedTranscript(db, 't2');
  });

  it('listByTranscript returns every version ordered by start_time', () => {
    seedSegment(db, 't1', 1, 5.0, 'original', 'b');
    seedSegment(db, 't1', 0, 1.0, 'original', 'a');
    seedSegment(db, 't1', 0, 1.0, 'corrected', 'a-fixed');
    seedSegment(db, 't2', 0, 0.5, 'original', 'other');
    const rows = api.listByTranscript('t1');
    expect(rows).toHaveLength(3); // both versions, t2 excluded
    expect(rows.map((r: any) => r.start_time)).toEqual([1.0, 1.0, 5.0]);
  });

  it('deleteByTranscript removes only that transcript and reports changes', () => {
    seedSegment(db, 't1', 0, 1.0);
    seedSegment(db, 't1', 1, 2.0);
    seedSegment(db, 't2', 0, 1.0);
    expect(api.deleteByTranscript('t1')).toEqual({ changes: 2 });
    expect(api.listByTranscript('t1')).toHaveLength(0);
    expect(api.listByTranscript('t2')).toHaveLength(1);
  });

  it('rejects a bad id', () => {
    expect(() => api.listByTranscript('')).toThrow(/invalid transcript id/);
    expect(() => api.deleteByTranscript(42 as any)).toThrow(/invalid transcript id/);
  });
});
