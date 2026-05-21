// Orchestrator for per-domain DB RPC modules.
//
// Each domain owns a file in this directory that exports a `register(ipcMain, db)`
// function. Add new domains here as they're migrated off the generic db-query IPC.
//
// Migrated domains (every renderer DB read/write now goes through one of
// these — the generic db-query IPC has no remaining callers in src/):
//   - settings (key/value table)
//   - transcripts (single-table reads/writes)
//   - projects (single-table reads/writes)
//   - projectTranscripts (junction + project⇄transcript JOIN reads)
//   - chat (chat_conversations + chat_messages + conversation_memory)
//   - projectChat (project_chat_conversations + project_chat_messages)
//   - transcriptSegments (all-versions segment read/delete)
//   - topics (transcript_topics cache)
//   - projectAnalysis (project_analysis cache)
//   - modelMetadata (model_metadata cache)

const settings = require('./settings');
const transcripts = require('./transcripts');
const projects = require('./projects');
const projectTranscripts = require('./projectTranscripts');
const chat = require('./chat');
const projectChat = require('./projectChat');
const transcriptSegments = require('./transcriptSegments');
const topics = require('./topics');
const projectAnalysis = require('./projectAnalysis');
const modelMetadata = require('./modelMetadata');

// getDb is a function returning the current db handle. We pass a getter
// (not the handle directly) because change-database-location closes and
// reopens the db; closures over the original handle would error.
function registerAll(ipcMain, getDb) {
  settings.register(ipcMain, getDb);
  transcripts.register(ipcMain, getDb);
  projects.register(ipcMain, getDb);
  projectTranscripts.register(ipcMain, getDb);
  chat.register(ipcMain, getDb);
  projectChat.register(ipcMain, getDb);
  transcriptSegments.register(ipcMain, getDb);
  topics.register(ipcMain, getDb);
  projectAnalysis.register(ipcMain, getDb);
  modelMetadata.register(ipcMain, getDb);
}

module.exports = { registerAll };
