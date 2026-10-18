// @vitest-environment node
//
// Tests for speaker identities + voiceprint embeddings storage (schema v4).
// Matching logic lives in the renderer; this layer must store vectors
// faithfully, link/unlink identities, and never accept malformed input.

import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { makeSpeakerIdentities } = require('../public/electron/db-rpc/speakerIdentities.js');

let db: InstanceType<typeof import('node:sqlite').DatabaseSync>;
let api: ReturnType<typeof makeSpeakerIdentities>;

function shim(dbHandle: typeof db) {
  return {
    prepare: dbHandle.prepare.bind(dbHandle),
    exec: dbHandle.exec.bind(dbHandle),
    transaction(fn: (arg?: unknown) => unknown) {
      return (arg?: unknown) => {
        dbHandle.exec('BEGIN');
        try {
          const r = fn(arg);
          dbHandle.exec('COMMIT');
          return r;
        } catch (e) {
          dbHandle.exec('ROLLBACK');
          throw e;
        }
      };
    },
  };
}

async function openDb() {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const handle = new DatabaseSync(':memory:');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec(readFileSync('database/schema.sql', 'utf8'));
  return handle;
}

describe.skipIf(!existsSync('database/schema.sql'))('speaker identities db-rpc', () => {
  beforeEach(async () => {
    db = await openDb();
    db.prepare("INSERT INTO transcripts (id, title, filename, status) VALUES ('t1', 'One', 'one.wav', 'completed')").run();
    db.prepare("INSERT INTO transcripts (id, title, filename, status) VALUES ('t2', 'Two', 'two.wav', 'completed')").run();
    api = makeSpeakerIdentities(() => shim(db));
  });

  afterEach(() => db.close());

  it('creates, renames and lists identities with counts', () => {
    const alice = api.createIdentity('Alice');
    api.saveEmbedding({ transcriptId: 't1', clusterId: 'SPEAKER_00', embedding: [0.1, 0.2], talkSeconds: 30 });
    api.assignIdentity({ transcriptId: 't1', clusterId: 'SPEAKER_00', identityId: alice.id });
    api.renameIdentity(alice.id, 'Alice Smith');

    const [row] = api.listIdentities();
    expect(row.name).toBe('Alice Smith');
    expect(row.embedding_count).toBe(1);
  });

  it('round-trips an embedding and clears identity on re-save (re-diarisation)', () => {
    const alice = api.createIdentity('Alice');
    api.saveEmbedding({ transcriptId: 't1', clusterId: 'SPEAKER_00', embedding: [1, 0], talkSeconds: 10 });
    api.assignIdentity({ transcriptId: 't1', clusterId: 'SPEAKER_00', identityId: alice.id });

    api.saveEmbedding({ transcriptId: 't1', clusterId: 'SPEAKER_00', embedding: [0, 1], talkSeconds: 12 });
    const [row] = api.listEmbeddingsByTranscript('t1');
    expect(JSON.parse(row.embedding)).toEqual([0, 1]);
    expect(row.identity_id).toBeNull(); // cluster ids are reassigned per run
    expect(row.talk_seconds).toBe(12);
  });

  it('rejects malformed embeddings and ids', () => {
    expect(() =>
      api.saveEmbedding({ transcriptId: 't1', clusterId: 'SPEAKER_00', embedding: [], talkSeconds: 1 })
    ).toThrow(/embedding/);
    expect(() =>
      api.saveEmbedding({ transcriptId: 't1', clusterId: 'SPEAKER_00', embedding: [NaN], talkSeconds: 1 })
    ).toThrow(/embedding/);
    expect(() => api.createIdentity('  ')).toThrow(/non-empty/);
    expect(() => api.assignIdentity({ transcriptId: '', clusterId: 'S', identityId: null }))
      .toThrow(/invalid/);
  });

  it('deleting an identity unlinks but keeps embeddings; deleteAll wipes both', () => {
    const alice = api.createIdentity('Alice');
    api.saveEmbedding({ transcriptId: 't2', clusterId: 'SPEAKER_01', embedding: [0.5], talkSeconds: 5 });
    api.assignIdentity({ transcriptId: 't2', clusterId: 'SPEAKER_01', identityId: alice.id });

    api.deleteIdentity(alice.id);
    const [row] = api.listEmbeddingsByTranscript('t2');
    expect(row.identity_id).toBeNull();

    const wiped = api.deleteAllVoiceprints();
    expect(wiped.embeddings).toBe(1);
    expect(api.listEmbeddings()).toEqual([]);
  });

  it('embeddings cascade away with their transcript', () => {
    api.saveEmbedding({ transcriptId: 't1', clusterId: 'SPEAKER_00', embedding: [0.1], talkSeconds: 1 });
    db.prepare("DELETE FROM transcripts WHERE id = 't1'").run();
    expect(api.listEmbeddings()).toEqual([]);
  });
});
