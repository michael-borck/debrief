// Orchestrator for per-domain DB RPC modules.
//
// Each domain owns a file in this directory that exports a `register(ipcMain, db)`
// function. Add new domains here as they're migrated off the generic db-query IPC.
//
// Currently migrated:
//   - settings (was: 27 raw-SQL call sites)
//   - transcripts (single-table transcripts reads/writes)
//   - projects (single-table projects reads/writes)
//   - projectTranscripts (junction + project⇄transcript JOIN reads)
//
// Remaining (will be added as migrations land — see docs/AUDIT-2026-05-21.md
// Tier 0.6 entry for the full inventory):
//   - segments, topics
//   - chat (conversations + messages + memory)
//   - project_chat (conversations + messages)
//   - project_analysis
//   - model_metadata

const settings = require('./settings');
const transcripts = require('./transcripts');
const projects = require('./projects');
const projectTranscripts = require('./projectTranscripts');
const chat = require('./chat');
const projectChat = require('./projectChat');
const transcriptSegments = require('./transcriptSegments');

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
}

module.exports = { registerAll };
