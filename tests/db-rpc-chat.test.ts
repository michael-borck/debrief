// @vitest-environment node
//
// Tests for the chat per-domain RPC (chat_conversations + chat_messages +
// conversation_memory):
//   - listConversationsWithMeta rolls up message_count/last_message/title and
//     hides conversations whose transcript is trashed
//   - getLatestConversationId / createConversation / deleteConversation
//     (delete cascades to messages + memory)
//   - addMessage validates role; listMessages orders oldest-first
//   - getMemory / setMemory (upsert) / deleteMemory
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts).
// FKs + cascade default ON here, which is what the delete test relies on.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/chat.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seedTranscript(db: DatabaseSync, id: string, overrides: Record<string, string | number> = {}) {
  const cols: Record<string, string | number> = { id, title: `t-${id}`, filename: `${id}.mp3`, ...overrides };
  const keys = Object.keys(cols);
  db.prepare(
    `INSERT INTO transcripts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  ).run(...keys.map((k) => cols[k]));
}

describe('db-rpc chat', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeChat>;

  beforeEach(() => {
    db = makeDb();
    api = mod.makeChat(() => db);
  });

  describe('conversations', () => {
    it('create / getLatest returns most recent, or null', () => {
      seedTranscript(db, 't1');
      expect(api.getLatestConversationId('t1')).toBeNull();
      db.prepare(
        "INSERT INTO chat_conversations (id, transcript_id, created_at) VALUES ('c1','t1','2026-01-01')"
      ).run();
      db.prepare(
        "INSERT INTO chat_conversations (id, transcript_id, created_at) VALUES ('c2','t1','2026-01-02')"
      ).run();
      expect(api.getLatestConversationId('t1')).toEqual({ id: 'c2' });
    });

    it('createConversation rejects bad ids', () => {
      expect(() => api.createConversation('', 't1')).toThrow(/invalid conversation id/);
      expect(() => api.createConversation('c1', 42 as any)).toThrow(/invalid transcript id/);
    });

    it('deleteConversation cascades to messages + memory', () => {
      seedTranscript(db, 't1');
      api.createConversation('c1', 't1');
      api.addMessage('c1', { role: 'user', content: 'hi' });
      api.setMemory('c1', { compactedSummary: 's', totalExchanges: 1 });
      expect(api.deleteConversation('c1')).toEqual({ changes: 1 });
      expect(api.listMessages('c1')).toHaveLength(0);
      expect(api.getMemory('c1')).toBeNull();
    });

    it('listConversationsWithMeta rolls up counts and hides trashed-transcript convos', () => {
      seedTranscript(db, 'live', { title: 'Live' });
      seedTranscript(db, 'dead', { title: 'Dead', is_deleted: 1 });
      api.createConversation('c1', 'live');
      api.createConversation('c2', 'dead');
      api.addMessage('c1', { role: 'user', content: 'one' });
      api.addMessage('c1', { role: 'assistant', content: 'two' });
      const rows = api.listConversationsWithMeta();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('c1');
      expect(rows[0].message_count).toBe(2);
      expect(rows[0].entity_title).toBe('Live');
    });
  });

  describe('messages', () => {
    beforeEach(() => {
      seedTranscript(db, 't1');
      api.createConversation('c1', 't1');
    });

    it('addMessage validates role and content', () => {
      expect(() => api.addMessage('c1', { role: 'system', content: 'x' })).toThrow(/invalid chat role/);
      expect(() => api.addMessage('c1', { role: 'user', content: 42 as any })).toThrow(
        /content must be a string/
      );
    });

    it('listMessages returns rows oldest-first', () => {
      api.addMessage('c1', { role: 'user', content: 'first', created_at: '2026-01-01' });
      api.addMessage('c1', { role: 'assistant', content: 'second', created_at: '2026-01-02' });
      expect(api.listMessages('c1').map((m: any) => m.content)).toEqual(['first', 'second']);
    });
  });

  describe('memory', () => {
    beforeEach(() => {
      seedTranscript(db, 't1');
      api.createConversation('c1', 't1');
    });

    it('setMemory upserts; getMemory reads back; deleteMemory clears', () => {
      api.setMemory('c1', { compactedSummary: 'sum', totalExchanges: 3, lastCompactionAt: '2026-01-01' });
      let row = api.getMemory('c1');
      expect(row.compacted_summary).toBe('sum');
      expect(row.total_exchanges).toBe(3);
      // replace
      api.setMemory('c1', { compactedSummary: 'sum2', totalExchanges: 5 });
      row = api.getMemory('c1');
      expect(row.compacted_summary).toBe('sum2');
      expect(row.total_exchanges).toBe(5);
      expect(api.deleteMemory('c1')).toEqual({ changes: 1 });
      expect(api.getMemory('c1')).toBeNull();
    });
  });
});
