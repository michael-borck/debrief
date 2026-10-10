// @vitest-environment node
//
// Tests for the diarization_turns db-rpc module.
//
// WHY THIS TABLE EXISTS
// Turns were computed at import and then discarded — only the speaker count was
// kept. transcript_segments cannot substitute for them: its sentence timings are
// interpolated estimates, whereas a turn is the diarizer's actual boundary. These
// tests pin the persistence semantics the audio clipper depends on.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { makeDiarizationTurns } = require('../public/electron/db-rpc/diarizationTurns.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

// node:sqlite lacks better-sqlite3's `transaction(fn)` helper; provide the
// same shape via explicit BEGIN/COMMIT so the module's atomicity is actually
// exercised (same shim as db-rpc-settings.test.ts).
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

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(
    'INSERT INTO transcripts (id, title, filename, status) VALUES (?, ?, ?, ?)'
  ).run('t1', 'Retro', 'retro.mp3', 'completed');
  return db;
}

const T = (speaker: string, start: number, end: number) => ({ speaker, start, end });

describe('diarizationTurns', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof makeDiarizationTurns>;

  beforeEach(() => {
    db = makeDb();
    api = makeDiarizationTurns(() => shim(db));
  });

  it('saves turns in order and reads them back', () => {
    api.save('t1', [T('A', 0, 10), T('B', 10, 12), T('A', 12, 20)]);

    const rows = api.listByTranscript('t1');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ turn_index: 0, speaker: 'A', start_time: 0, end_time: 10 });
    expect(rows[2].turn_index).toBe(2);
  });

  it('REPLACES prior turns rather than appending', () => {
    // A re-diarisation produces a complete new set; stale turns would clip audio
    // on boundaries that no longer exist.
    api.save('t1', [T('A', 0, 10), T('B', 10, 20)]);
    api.save('t1', [T('A', 0, 5)]);

    expect(api.count('t1')).toBe(1);
    expect(api.listByTranscript('t1')[0].end_time).toBe(5);
  });

  it('groups by speaker in recording order', () => {
    api.save('t1', [T('A', 0, 10), T('B', 10, 12), T('A', 12, 20)]);

    expect(api.listBySpeaker('t1')).toEqual({
      A: [
        { start: 0, end: 10 },
        { start: 12, end: 20 },
      ],
      B: [{ start: 10, end: 12 }],
    });
  });

  it('cascades away with the transcript', () => {
    api.save('t1', [T('A', 0, 10)]);
    db.prepare('DELETE FROM transcripts WHERE id = ?').run('t1');
    expect(api.count('t1')).toBe(0);
  });

  it('rejects a turn that ends at or before it starts', () => {
    // A non-positive range would become an invalid ffmpeg atrim and fail the
    // whole export, so it is refused at the door.
    expect(() => api.save('t1', [T('A', 5, 5)])).toThrow(/ends \(5\) at or before/);
    expect(() => api.save('t1', [T('A', 6, 5)])).toThrow(/ends \(5\) at or before/);
    expect(api.count('t1')).toBe(0);
  });

  it('rejects non-numeric and missing speakers', () => {
    expect(() => api.save('t1', [{ speaker: '', start: 0, end: 1 }])).toThrow(/speaker/);
    expect(() => api.save('t1', [{ speaker: 'A', start: 'x', end: 1 }])).toThrow(/non-numeric/);
  });

  it('rejects a non-array payload and a bad transcript id', () => {
    expect(() => api.save('t1', 'nope' as unknown as [])).toThrow(/requires an array/);
    expect(() => api.save('', [T('A', 0, 1)])).toThrow(/invalid transcript id/);
  });

  it('saves atomically: a bad turn leaves no partial set behind', () => {
    api.save('t1', [T('A', 0, 10)]);
    expect(() => api.save('t1', [T('B', 0, 5), T('A', 9, 8)])).toThrow();

    // The replace was rolled back, so the ORIGINAL turns survive intact.
    expect(api.count('t1')).toBe(1);
    expect(api.listByTranscript('t1')[0].speaker).toBe('A');
  });

  it('deletes by transcript', () => {
    api.save('t1', [T('A', 0, 10)]);
    expect(api.deleteByTranscript('t1').changes).toBe(1);
    expect(api.count('t1')).toBe(0);
  });
});