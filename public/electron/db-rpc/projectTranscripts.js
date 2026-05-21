// Per-domain RPC for the `project_transcripts` junction table and the
// cross-table reads that join projects ⇄ transcripts.
//
// This is where the project list/detail aggregate reads live (the
// COUNT/SUM JOIN that powers the projects grid), plus the per-project
// transcript lists and the link/unlink writes. Keeping the JOIN SQL here
// means the renderer never builds it — it just names the read it wants.

function assertId(name, id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid ${name}: ${JSON.stringify(id)}`);
  }
}

// Whitelisted ORDER BY fragments. The renderer picks a key; it never sends
// raw SQL, so this can't be an injection vector even though the value is
// interpolated into the query string.
const ORDER_BY = {
  added_desc: 'pt.added_at DESC',
  created_desc: 't.created_at DESC',
  created_asc: 't.created_at ASC',
};

function makeProjectTranscripts(getDb) {
  return {
    // Projects grid: every live, non-archived project with rollup stats.
    // Returns raw rows (themes/key_insights/tags still JSON strings); the
    // renderer hydrates and derives date_range.
    listProjectsWithStats() {
      return getDb()
        .prepare(
          `SELECT
             p.*,
             COUNT(DISTINCT pt.transcript_id) AS transcript_count,
             SUM(t.duration) AS total_duration,
             MIN(t.created_at) AS earliest_transcript,
             MAX(t.created_at) AS latest_transcript
           FROM projects p
           LEFT JOIN project_transcripts pt ON p.id = pt.project_id
           LEFT JOIN transcripts t ON pt.transcript_id = t.id
             AND (t.is_deleted != 1 OR t.is_deleted IS NULL)
           WHERE (p.is_deleted != 1 OR p.is_deleted IS NULL)
             AND (p.is_archived != 1 OR p.is_archived IS NULL)
           GROUP BY p.id
           ORDER BY p.updated_at DESC`
        )
        .all();
    },

    // Single project + rollup stats (detail view). Includes archived/trashed
    // projects (no status filter) to match the original detail query.
    getProjectWithStats(id) {
      assertId('project id', id);
      return (
        getDb()
          .prepare(
            `SELECT
               p.*,
               COUNT(DISTINCT pt.transcript_id) AS transcript_count,
               SUM(t.duration) AS total_duration,
               MIN(t.created_at) AS earliest_transcript,
               MAX(t.created_at) AS latest_transcript
             FROM projects p
             LEFT JOIN project_transcripts pt ON p.id = pt.project_id
             LEFT JOIN transcripts t ON pt.transcript_id = t.id
             WHERE p.id = ?
             GROUP BY p.id`
          )
          .get(id) ?? null
      );
    },

    // Transcripts belonging to a project. options:
    //   includeDeleted: keep soft-deleted transcripts (default false)
    //   completedOnly:  only status='completed' (default false)
    //   orderBy:        one of ORDER_BY keys (default 'added_desc')
    // Raw rows are returned (with pt.added_at); the renderer hydrates.
    listTranscriptsForProject(projectId, options = {}) {
      assertId('project id', projectId);
      const includeDeleted = options.includeDeleted === true;
      const completedOnly = options.completedOnly === true;
      const order = ORDER_BY[options.orderBy] ?? ORDER_BY.added_desc;
      const where = ['pt.project_id = ?'];
      if (!includeDeleted) where.push('t.is_deleted = 0');
      if (completedOnly) where.push("t.status = 'completed'");
      return getDb()
        .prepare(
          `SELECT t.*, pt.added_at FROM transcripts t
           JOIN project_transcripts pt ON t.id = pt.transcript_id
           WHERE ${where.join(' AND ')}
           ORDER BY ${order}`
        )
        .all(projectId);
    },

    // Project ids a transcript is filed under (delete-modal / card chips).
    listProjectIdsForTranscript(transcriptId) {
      assertId('transcript id', transcriptId);
      return getDb()
        .prepare('SELECT project_id FROM project_transcripts WHERE transcript_id = ?')
        .all(transcriptId);
    },

    // Number of transcripts filed under a project (chat-stats badge).
    countForProject(projectId) {
      assertId('project id', projectId);
      const row = getDb()
        .prepare('SELECT COUNT(*) AS count FROM project_transcripts WHERE project_id = ?')
        .get(projectId);
      return row.count;
    },

    // Ids of a project's still-trashed transcripts (cascade-restore).
    listTrashedTranscriptIdsForProject(projectId) {
      assertId('project id', projectId);
      return getDb()
        .prepare(
          `SELECT DISTINCT t.id FROM transcripts t
           JOIN project_transcripts pt ON t.id = pt.transcript_id
           WHERE pt.project_id = ? AND t.is_deleted = 1`
        )
        .all(projectId);
    },

    link(projectId, transcriptId) {
      assertId('project id', projectId);
      assertId('transcript id', transcriptId);
      const info = getDb()
        .prepare(
          'INSERT OR IGNORE INTO project_transcripts (project_id, transcript_id) VALUES (?, ?)'
        )
        .run(projectId, transcriptId);
      return { changes: info.changes };
    },

    unlink(projectId, transcriptId) {
      assertId('project id', projectId);
      assertId('transcript id', transcriptId);
      const info = getDb()
        .prepare('DELETE FROM project_transcripts WHERE project_id = ? AND transcript_id = ?')
        .run(projectId, transcriptId);
      return { changes: info.changes };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeProjectTranscripts(getDb);
  ipcMain.handle('project-transcripts:list-projects-with-stats', () =>
    api.listProjectsWithStats()
  );
  ipcMain.handle('project-transcripts:get-project-with-stats', (_e, id) =>
    api.getProjectWithStats(id)
  );
  ipcMain.handle('project-transcripts:list-transcripts-for-project', (_e, { projectId, options }) =>
    api.listTranscriptsForProject(projectId, options)
  );
  ipcMain.handle('project-transcripts:list-project-ids-for-transcript', (_e, transcriptId) =>
    api.listProjectIdsForTranscript(transcriptId)
  );
  ipcMain.handle('project-transcripts:count-for-project', (_e, projectId) =>
    api.countForProject(projectId)
  );
  ipcMain.handle('project-transcripts:list-trashed-transcript-ids-for-project', (_e, projectId) =>
    api.listTrashedTranscriptIdsForProject(projectId)
  );
  ipcMain.handle('project-transcripts:link', (_e, { projectId, transcriptId }) =>
    api.link(projectId, transcriptId)
  );
  ipcMain.handle('project-transcripts:unlink', (_e, { projectId, transcriptId }) =>
    api.unlink(projectId, transcriptId)
  );
}

module.exports = { register, makeProjectTranscripts, ORDER_BY };
