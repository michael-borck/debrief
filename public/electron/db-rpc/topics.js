// Per-domain RPC for the `transcript_topics` table (the Topics tab's cached
// topic clusters). The table is created at runtime in electron.js, not in
// schema.sql.
//
// save() in the renderer was a DELETE + N sequential INSERTs on the generic
// IPC; here it's a single atomic replaceForTranscript so a half-written
// recompute can't leave a transcript with a partial topic set.

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid transcript id: ${JSON.stringify(id)}`);
  }
}

// chunk_ids / centroid are TEXT columns holding JSON. Serialize arrays/objects;
// pass strings through; null stays null.
function toJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function makeTopics(getDb) {
  return {
    // Cached topics for a transcript, ordered by topic_index. Raw rows
    // (chunk_ids/centroid still JSON strings) — the renderer hydrates.
    listByTranscript(transcriptId) {
      assertId(transcriptId);
      return getDb()
        .prepare('SELECT * FROM transcript_topics WHERE transcript_id = ? ORDER BY topic_index')
        .all(transcriptId);
    },

    // Atomically wipe and rewrite a transcript's topics. `rows` is the full
    // ordered set; topic_index defaults to array position.
    replaceForTranscript(transcriptId, rows) {
      assertId(transcriptId);
      if (!Array.isArray(rows)) {
        throw new Error('topics replaceForTranscript() requires an array of rows');
      }
      const db = getDb();
      const del = db.prepare('DELETE FROM transcript_topics WHERE transcript_id = ?');
      const insert = db.prepare(
        `INSERT INTO transcript_topics
           (id, transcript_id, topic_index, label, summary, chunk_ids, centroid, model_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const tx = db.transaction((items) => {
        del.run(transcriptId);
        items.forEach((r, i) => {
          if (typeof r.id !== 'string' || r.id.length === 0) {
            throw new Error('topic row requires a string id');
          }
          insert.run(
            r.id,
            transcriptId,
            r.topic_index ?? i,
            r.label ?? '',
            r.summary ?? null,
            toJson(r.chunk_ids ?? []),
            toJson(r.centroid ?? null),
            r.model_used ?? null
          );
        });
      });
      tx(rows);
      return { count: rows.length };
    },

    deleteByTranscript(transcriptId) {
      assertId(transcriptId);
      const info = getDb()
        .prepare('DELETE FROM transcript_topics WHERE transcript_id = ?')
        .run(transcriptId);
      return { changes: info.changes };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeTopics(getDb);
  ipcMain.handle('topics:list-by-transcript', (_e, transcriptId) =>
    api.listByTranscript(transcriptId)
  );
  ipcMain.handle('topics:replace-for-transcript', (_e, { transcriptId, rows }) =>
    api.replaceForTranscript(transcriptId, rows)
  );
  ipcMain.handle('topics:delete-by-transcript', (_e, transcriptId) =>
    api.deleteByTranscript(transcriptId)
  );
}

module.exports = { register, makeTopics };
