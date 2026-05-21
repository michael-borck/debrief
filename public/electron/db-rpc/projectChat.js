// Per-domain RPC for the project-level chat tables:
// project_chat_conversations + project_chat_messages. Mirrors chat.js but
// keyed on a project rather than a transcript. Project chat has no
// conversation_memory table (memory is reused from the transcript chat path).

const ROLES = new Set(['user', 'assistant']);

function assertId(name, id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid ${name}: ${JSON.stringify(id)}`);
  }
}

function makeProjectChat(getDb) {
  const nowIso = () => new Date().toISOString();

  return {
    // ---- project_chat_conversations ----

    // id of a project's most recent conversation, or null.
    getLatestConversationId(projectId) {
      assertId('project id', projectId);
      return (
        getDb()
          .prepare(
            'SELECT id FROM project_chat_conversations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
          )
          .get(projectId) ?? null
      );
    },

    createConversation(id, projectId) {
      assertId('conversation id', id);
      assertId('project id', projectId);
      getDb()
        .prepare('INSERT INTO project_chat_conversations (id, project_id) VALUES (?, ?)')
        .run(id, projectId);
      return { id };
    },

    // Deletes the conversation; messages cascade via FK.
    deleteConversation(id) {
      assertId('conversation id', id);
      const info = getDb()
        .prepare('DELETE FROM project_chat_conversations WHERE id = ?')
        .run(id);
      return { changes: info.changes };
    },

    // { conversation_count, message_count, last_activity } for a project.
    getStats(projectId) {
      assertId('project id', projectId);
      return getDb()
        .prepare(
          `SELECT
             COUNT(DISTINCT pcc.id) AS conversation_count,
             COUNT(pcm.id) AS message_count,
             MAX(pcm.created_at) AS last_activity
           FROM project_chat_conversations pcc
           LEFT JOIN project_chat_messages pcm ON pcc.id = pcm.conversation_id
           WHERE pcc.project_id = ?`
        )
        .get(projectId);
    },

    // ---- project_chat_messages ----

    listMessages(conversationId) {
      assertId('conversation id', conversationId);
      return getDb()
        .prepare(
          'SELECT * FROM project_chat_messages WHERE conversation_id = ? ORDER BY created_at ASC'
        )
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
          'INSERT INTO project_chat_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(conversationId, role, content, message.created_at ?? nowIso());
      return { id: info.lastInsertRowid };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeProjectChat(getDb);
  ipcMain.handle('project-chat:get-latest-conversation-id', (_e, projectId) =>
    api.getLatestConversationId(projectId)
  );
  ipcMain.handle('project-chat:create-conversation', (_e, { id, projectId }) =>
    api.createConversation(id, projectId)
  );
  ipcMain.handle('project-chat:delete-conversation', (_e, id) => api.deleteConversation(id));
  ipcMain.handle('project-chat:get-stats', (_e, projectId) => api.getStats(projectId));
  ipcMain.handle('project-chat:list-messages', (_e, conversationId) =>
    api.listMessages(conversationId)
  );
  ipcMain.handle('project-chat:add-message', (_e, { conversationId, message }) =>
    api.addMessage(conversationId, message)
  );
}

module.exports = { register, makeProjectChat };
