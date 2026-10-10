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
    // deleted_at is normally written as an ISO-8601 string by softDelete, which
    // makes a lexicographic `<` compare chronological. That invariant held only
    // because of the current writer: the column's SQL default is
    // CURRENT_TIMESTAMP, which SQLite fills as 'YYYY-MM-DD HH:MM:SS' (space
    // separator, no Z). Any row written that way — a raw insert, an import, a
    // restored backup — compares against an ISO string on the separator byte
    // (' ' = 0x20 < 'T' = 0x54) and gets mis-bucketed near the cutoff.
    //
    // datetime() normalises both representations to the same form, so the
    // comparison is genuinely chronological regardless of how a row was written.
    // Returns how many of each were purged.
    //
    // Returns the deleted transcript ids as well: the caller owns vector-store
    // cleanup (purge-service) and needs to know WHICH transcripts went, because
    // LanceDB rows outlive the SQLite row and would otherwise keep a
    // "permanently deleted" transcript's full text searchable forever.
    sweepExpiredTrash({ now = Date.now(), retentionDays = 30 } = {}) {
      const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const db = getDb();

      // Collect ids BEFORE deleting: afterwards the rows no longer exist.
      const expiredTranscriptIds = db
        .prepare(
          `SELECT id FROM transcripts
           WHERE is_deleted = 1 AND deleted_at IS NOT NULL
             AND datetime(deleted_at) < datetime(?)`
        )
        .all(cutoff)
        .map((row) => row.id);

      const t = db
        .prepare(
          `DELETE FROM transcripts
           WHERE is_deleted = 1 AND deleted_at IS NOT NULL
             AND datetime(deleted_at) < datetime(?)`
        )
        .run(cutoff);
      const p = db
        .prepare(
          `DELETE FROM projects
           WHERE is_deleted = 1 AND deleted_at IS NOT NULL
             AND datetime(deleted_at) < datetime(?)`
        )
        .run(cutoff);
      return {
        transcripts: t.changes,
        projects: p.changes,
        transcriptIds: expiredTranscriptIds,
        cutoff,
      };
    },
  };
}

module.exports = { makeMaintenance };
