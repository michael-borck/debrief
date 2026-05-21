// @vitest-environment node
//
// Tests for the projectChat per-domain RPC (project_chat_conversations +
// project_chat_messages):
//   - getLatestConversationId / createConversation / deleteConversation
//     (delete cascades to messages)
//   - addMessage validates role; listMessages orders oldest-first
//   - getStats rolls up conversation/message counts + last activity
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts).

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/projectChat.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seedProject(db: DatabaseSync, id: string) {
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, `proj-${id}`);
}

describe('db-rpc projectChat', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeProjectChat>;

  beforeEach(() => {
    db = makeDb();
    api = mod.makeProjectChat(() => db);
    seedProject(db, 'p1');
  });

  describe('conversations', () => {
    it('create / getLatest returns most recent, or null', () => {
      expect(api.getLatestConversationId('p1')).toBeNull();
      db.prepare(
        "INSERT INTO project_chat_conversations (id, project_id, created_at) VALUES ('c1','p1','2026-01-01')"
      ).run();
      db.prepare(
        "INSERT INTO project_chat_conversations (id, project_id, created_at) VALUES ('c2','p1','2026-01-02')"
      ).run();
      expect(api.getLatestConversationId('p1')).toEqual({ id: 'c2' });
    });

    it('createConversation rejects bad ids', () => {
      expect(() => api.createConversation('', 'p1')).toThrow(/invalid conversation id/);
      expect(() => api.createConversation('c1', 42 as any)).toThrow(/invalid project id/);
    });

    it('deleteConversation cascades to messages', () => {
      api.createConversation('c1', 'p1');
      api.addMessage('c1', { role: 'user', content: 'hi' });
      expect(api.deleteConversation('c1')).toEqual({ changes: 1 });
      expect(api.listMessages('c1')).toHaveLength(0);
    });
  });

  describe('messages', () => {
    beforeEach(() => api.createConversation('c1', 'p1'));

    it('addMessage validates role and content', () => {
      expect(() => api.addMessage('c1', { role: 'system', content: 'x' })).toThrow(/invalid chat role/);
      expect(() => api.addMessage('c1', { role: 'user', content: 1 as any })).toThrow(
        /content must be a string/
      );
    });

    it('listMessages returns rows oldest-first', () => {
      api.addMessage('c1', { role: 'user', content: 'first', created_at: '2026-01-01' });
      api.addMessage('c1', { role: 'assistant', content: 'second', created_at: '2026-01-02' });
      expect(api.listMessages('c1').map((m: any) => m.content)).toEqual(['first', 'second']);
    });
  });

  describe('getStats', () => {
    it('rolls up conversation/message counts and last activity', () => {
      api.createConversation('c1', 'p1');
      api.createConversation('c2', 'p1');
      api.addMessage('c1', { role: 'user', content: 'a', created_at: '2026-01-01' });
      api.addMessage('c1', { role: 'assistant', content: 'b', created_at: '2026-01-03' });
      api.addMessage('c2', { role: 'user', content: 'c', created_at: '2026-01-02' });
      const stats = api.getStats('p1');
      expect(stats.conversation_count).toBe(2);
      expect(stats.message_count).toBe(3);
      expect(stats.last_activity).toBe('2026-01-03');
    });

    it('is empty for a project with no chat', () => {
      const stats = api.getStats('p1');
      expect(stats.conversation_count).toBe(0);
      expect(stats.message_count).toBe(0);
      expect(stats.last_activity).toBeNull();
    });
  });
});
