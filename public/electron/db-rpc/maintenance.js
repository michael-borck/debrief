// Main-process startup maintenance against the live DB. Not exposed over IPC —
// the renderer never triggers these. Lives alongside the db-rpc modules so it
// shares the same getDb pattern and is unit-testable under node:sqlite.

function makeMaintenance(getDb) {
  return {
    // Permanently delete trashed transcripts/projects whose deleted_at is older
    // than retentionDays. This is what makes the UI's "items are automatically
    // deleted after 30 days" promise actually true. FK ON DELETE CASCADE
    // removes each row's segments, chat, topics, and project links.
    //
    // deleted_at is always written as an ISO-8601 string (db.transcripts/
    // projects softDelete), so a lexicographic `< cutoff` compare is also a
    // chronological one. Returns how many of each were purged.
    sweepExpiredTrash({ now = Date.now(), retentionDays = 30 } = {}) {
      const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const db = getDb();
      const t = db
        .prepare(
          'DELETE FROM transcripts WHERE is_deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < ?'
        )
        .run(cutoff);
      const p = db
        .prepare(
          'DELETE FROM projects WHERE is_deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < ?'
        )
        .run(cutoff);
      return { transcripts: t.changes, projects: p.changes, cutoff };
    },
  };
}

module.exports = { makeMaintenance };
