// Orchestrator for per-domain DB RPC modules.
//
// Each domain owns a file in this directory that exports a `register(ipcMain, db)`
// function. Add new domains here as they're migrated off the generic db-query IPC.
//
// Currently migrated:
//   - settings (was: 27 raw-SQL call sites)
//
// Remaining (will be added as migrations land — see docs/AUDIT-2026-05-21.md
// Tier 0.6 entry for the full inventory):
//   - transcripts, projects, project_transcripts
//   - segments, topics
//   - chat (conversations + messages + memory)
//   - project_chat (conversations + messages)
//   - project_analysis
//   - ai_prompts, model_metadata

const settings = require('./settings');

// getDb is a function returning the current db handle. We pass a getter
// (not the handle directly) because change-database-location closes and
// reopens the db; closures over the original handle would error.
function registerAll(ipcMain, getDb) {
  settings.register(ipcMain, getDb);
}

module.exports = { registerAll };
