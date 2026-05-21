// Per-domain RPC for the transcript-chat tables: chat_conversations,
// chat_messages, and conversation_memory. They're always used together
// (a conversation owns messages + a compacted memory row), so one module.
//
// Project-level chat lives in projectChat.js, not here.

const ROLES = new Set(['user', 'assistant']);

function assertId(name, id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid ${name}: ${JSON.stringify(id)}`);
  }
}

function makeChat(getDb) {
  const nowIso = () => new Date().toISOString();

  return {
    // ---- chat_conversations ----

    // Chat-history list: every conversation with its message count, last
    // message, and the owning transcript's title. Excludes conversations
    // whose transcript is trashed. Raw rows; the renderer renders directly.
    listConversationsWithMeta() {
      return getDb()
        .prepare(
          `SELECT c.id, c.transcript_id, NULL AS project_id, c.created_at, c.updated_at,
             COUNT(m.id) AS message_count, MAX(m.content) AS last_message,
             t.title AS entity_title, 'transcript' AS entity_type
           FROM chat_conversations c
           LEFT JOIN chat_messages m ON c.id = m.conversation_id
           LEFT JOIN transcripts t ON c.transcript_id = t.id
           WHERE (t.is_deleted != 1 OR t.is_deleted IS NULL)
           GROUP BY c.id ORDER BY c.updated_at DESC`
        )
        .all();
    },

    // id of a transcript's most recent conversation, or null.
    getLatestConversationId(transcriptId) {
      assertId('transcript id', transcriptId);
      return (
        getDb()
          .prepare(
            'SELECT id FROM chat_conversations WHERE transcript_id = ? ORDER BY created_at DESC LIMIT 1'
          )
          .get(transcriptId) ?? null
      );
    },

    createConversation(id, transcriptId) {
      assertId('conversation id', id);
      assertId('transcript id', transcriptId);
      getDb()
        .prepare('INSERT INTO chat_conversations (id, transcript_id) VALUES (?, ?)')
        .run(id, transcriptId);
      return { id };
    },

    // Deletes the conversation; messages + memory cascade via FK.
    deleteConversation(id) {
      assertId('conversation id', id);
      const info = getDb().prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);
      return { changes: info.changes };
    },

    // ---- chat_messages ----

    listMessages(conversationId) {
      assertId('conversation id', conversationId);
      return getDb()
        .prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC')
        .all(conversationId);
    },

    addMessage(conversationId, message) {
      assertId('conversation id', conversationId);
      if (message === null || typeof message !== 'object') {
        throw new Error('addMessage() requires a message object');
      }
      const { role, content } = message;
      if (!ROLES.has(role)) throw new Error(`invalid chat role: ${JSON.stringify(role)}`);
      if (typeof content !== 'string') throw new Error('chat message content must be a string');
      const info = getDb()
        .prepare(
          'INSERT INTO chat_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(conversationId, role, content, message.created_at ?? nowIso());
      return { id: info.lastInsertRowid };
    },

    // ---- conversation_memory ----

    getMemory(conversationId) {
      assertId('conversation id', conversationId);
      return (
        getDb()
          .prepare('SELECT * FROM conversation_memory WHERE conversation_id = ?')
          .get(conversationId) ?? null
      );
    },

    setMemory(conversationId, memory) {
      assertId('conversation id', conversationId);
      if (memory === null || typeof memory !== 'object') {
        throw new Error('setMemory() requires a memory object');
      }
      getDb()
        .prepare(
          `INSERT OR REPLACE INTO conversation_memory
             (conversation_id, compacted_summary, total_exchanges, last_compaction_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          conversationId,
          memory.compactedSummary ?? null,
          memory.totalExchanges ?? 0,
          memory.lastCompactionAt ?? nowIso()
        );
      return { success: true };
    },

    deleteMemory(conversationId) {
      assertId('conversation id', conversationId);
      const info = getDb()
        .prepare('DELETE FROM conversation_memory WHERE conversation_id = ?')
        .run(conversationId);
      return { changes: info.changes };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeChat(getDb);
  ipcMain.handle('chat:list-conversations-with-meta', () => api.listConversationsWithMeta());
  ipcMain.handle('chat:get-latest-conversation-id', (_e, transcriptId) =>
    api.getLatestConversationId(transcriptId)
  );
  ipcMain.handle('chat:create-conversation', (_e, { id, transcriptId }) =>
    api.createConversation(id, transcriptId)
  );
  ipcMain.handle('chat:delete-conversation', (_e, id) => api.deleteConversation(id));
  ipcMain.handle('chat:list-messages', (_e, conversationId) => api.listMessages(conversationId));
  ipcMain.handle('chat:add-message', (_e, { conversationId, message }) =>
    api.addMessage(conversationId, message)
  );
  ipcMain.handle('chat:get-memory', (_e, conversationId) => api.getMemory(conversationId));
  ipcMain.handle('chat:set-memory', (_e, { conversationId, memory }) =>
    api.setMemory(conversationId, memory)
  );
  ipcMain.handle('chat:delete-memory', (_e, conversationId) => api.deleteMemory(conversationId));
}

module.exports = { register, makeChat };
