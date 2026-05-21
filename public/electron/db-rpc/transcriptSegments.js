// Per-domain RPC for the raw-SQL `transcript_segments` reads/deletes that
// used the generic db-query IPC.
//
// NOTE: a separate, older `segments:` IPC (segments-create / -get-by-transcript
// / -update / -delete-by-transcript) also touches this table — that one is
// version-aware and is the path the editing UI uses. This module only covers
// the two operations the db-query callers needed: an all-versions read in
// start_time order (fed to the chat indexer) and an all-versions delete
// (transcript cleanup on cancel/error). Named transcriptSegments to avoid
// colliding with the legacy electronAPI.segments surface.

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid transcript id: ${JSON.stringify(id)}`);
  }
}

function makeTranscriptSegments(getDb) {
  return {
    // All segments for a transcript (every version), ordered by start_time.
    listByTranscript(transcriptId) {
      assertId(transcriptId);
      return getDb()
        .prepare('SELECT * FROM transcript_segments WHERE transcript_id = ? ORDER BY start_time')
        .all(transcriptId);
    },

    // Deletes every segment for a transcript (all versions).
    deleteByTranscript(transcriptId) {
      assertId(transcriptId);
      const info = getDb()
        .prepare('DELETE FROM transcript_segments WHERE transcript_id = ?')
        .run(transcriptId);
      return { changes: info.changes };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeTranscriptSegments(getDb);
  ipcMain.handle('transcript-segments:list-by-transcript', (_e, transcriptId) =>
    api.listByTranscript(transcriptId)
  );
  ipcMain.handle('transcript-segments:delete-by-transcript', (_e, transcriptId) =>
    api.deleteByTranscript(transcriptId)
  );
}

module.exports = { register, makeTranscriptSegments };
