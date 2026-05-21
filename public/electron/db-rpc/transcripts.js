// Per-domain RPC for the `transcripts` table.
//
// Replaces the raw-SQL renderer call sites that read/write a single
// transcripts row. Cross-table reads (transcripts JOIN project_transcripts)
// live in the project_transcripts domain, not here.
//
// Renderer now calls electronAPI.db.transcripts.*. No SQL crosses the IPC
// boundary, and update() validates every column name against an allow-list,
// closing the H-1 column-injection hole (the old renderer built
// `UPDATE transcripts SET ${Object.keys(updates)} ...` from arbitrary keys).

// Columns the renderer is allowed to write via update(). Deliberately
// excludes `id` and `created_at` — those are never user-updatable. Sourced
// from database/schema.sql.
const UPDATABLE_COLUMNS = new Set([
  'title', 'filename', 'file_path', 'duration', 'file_size', 'status',
  'full_text', 'validated_text', 'processed_text', 'validation_changes', 'summary',
  'action_items', 'key_topics', 'sentiment_overall', 'sentiment_score', 'emotions',
  'speaker_count', 'speakers', 'notable_quotes', 'research_themes', 'qa_pairs',
  'concept_frequency', 'personal_notes', 'tags', 'starred', 'rating', 'error_message',
  'processing_started_at', 'processing_completed_at',
  'is_archived', 'archived_at', 'is_deleted', 'deleted_at', 'updated_at',
]);

// JSON-typed columns: stored as TEXT containing JSON. If a caller passes an
// object/array we serialize it; if it already passed a string we leave it
// (mirrors the old renderer, where some call sites JSON.stringify'd first).
const JSON_COLUMNS = new Set([
  'action_items', 'key_topics', 'tags', 'speakers', 'emotions',
  'notable_quotes', 'research_themes', 'qa_pairs', 'concept_frequency',
  'validation_changes',
]);

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid transcript id: ${JSON.stringify(id)}`);
  }
}

// SQLite (via better-sqlite3 / node:sqlite) binds only null, number, bigint,
// string and Buffer. Coerce booleans to 0/1 the way better-sqlite3 v11 does
// internally, so behavior is identical and the module is testable under
// node:sqlite (which rejects raw booleans).
function bindValue(key, value) {
  if (JSON_COLUMNS.has(key) && value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function makeTranscripts(getDb) {
  const nowIso = () => new Date().toISOString();

  return {
    // ---- reads ----
    list() {
      return getDb()
        .prepare(
          'SELECT * FROM transcripts WHERE is_deleted != 1 OR is_deleted IS NULL ORDER BY created_at DESC'
        )
        .all();
    },

    listArchived() {
      return getDb()
        .prepare('SELECT * FROM transcripts WHERE is_archived = 1 ORDER BY archived_at DESC')
        .all();
    },

    listTrashed() {
      return getDb()
        .prepare('SELECT * FROM transcripts WHERE is_deleted = 1 ORDER BY deleted_at DESC')
        .all();
    },

    get(id) {
      assertId(id);
      return getDb().prepare('SELECT * FROM transcripts WHERE id = ?').get(id) ?? null;
    },

    // Speaker-tagged/full text for direct-LLM chat mode.
    getForChat(id) {
      assertId(id);
      return (
        getDb()
          .prepare('SELECT title, full_text, processed_text FROM transcripts WHERE id = ?')
          .get(id) ?? null
      );
    },

    // Lightweight metadata for chat context sizing.
    getMetadata(id) {
      assertId(id);
      return (
        getDb()
          .prepare('SELECT title, duration, speaker_count FROM transcripts WHERE id = ?')
          .get(id) ?? null
      );
    },

    // Name/title collision check used by the upload dedup prompt.
    findDuplicates(filename, title) {
      return getDb()
        .prepare('SELECT id, title, created_at FROM transcripts WHERE filename = ? OR title = ?')
        .all(filename ?? null, title ?? null);
    },

    // Completed transcripts that have no 'original' segments yet — used by the
    // one-off segment back-fill migration.
    listNeedingSegmentMigration() {
      return getDb()
        .prepare(
          "SELECT id, full_text FROM transcripts " +
            "WHERE status = 'completed' AND full_text IS NOT NULL " +
            "AND id NOT IN (SELECT DISTINCT transcript_id FROM transcript_segments WHERE version = 'original')"
        )
        .all();
    },

    searchByText(query) {
      const like = `%${typeof query === 'string' ? query : ''}%`;
      return getDb()
        .prepare(
          'SELECT * FROM transcripts ' +
            'WHERE title LIKE ? OR full_text LIKE ? OR summary LIKE ? ' +
            'ORDER BY created_at DESC'
        )
        .all(like, like, like);
    },

    // ---- writes ----
    create(input) {
      if (input === null || typeof input !== 'object') {
        throw new Error('transcript create() requires an object');
      }
      const { id, title, filename } = input;
      assertId(id);
      if (typeof title !== 'string') throw new Error('transcript title must be a string');
      if (typeof filename !== 'string') throw new Error('transcript filename must be a string');
      const ts = nowIso();
      getDb()
        .prepare(
          'INSERT INTO transcripts (id, title, filename, file_path, file_size, created_at, updated_at, status, starred) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          id,
          title,
          filename,
          input.file_path ?? null,
          input.file_size ?? null,
          ts,
          ts,
          input.status ?? 'processing',
          bindValue('starred', input.starred ?? 0)
        );
      return { id };
    },

    // H-1: validate every column name before building the SET clause.
    update(id, fields) {
      assertId(id);
      if (fields === null || typeof fields !== 'object') {
        throw new Error('transcript update() requires a fields object');
      }
      const keys = Object.keys(fields);
      if (keys.length === 0) return { changes: 0 };
      const sets = [];
      const values = [];
      for (const key of keys) {
        if (!UPDATABLE_COLUMNS.has(key)) {
          throw new Error(`invalid transcript column: ${JSON.stringify(key)}`);
        }
        sets.push(`${key} = ?`);
        values.push(bindValue(key, fields[key]));
      }
      values.push(id);
      const info = getDb()
        .prepare(`UPDATE transcripts SET ${sets.join(', ')} WHERE id = ?`)
        .run(...values);
      return { changes: info.changes };
    },

    archive(id) {
      assertId(id);
      getDb()
        .prepare('UPDATE transcripts SET is_archived = 1, archived_at = ? WHERE id = ?')
        .run(nowIso(), id);
      return { success: true };
    },

    unarchive(id) {
      assertId(id);
      getDb()
        .prepare('UPDATE transcripts SET is_archived = 0, archived_at = NULL WHERE id = ?')
        .run(id);
      return { success: true };
    },

    softDelete(id) {
      assertId(id);
      getDb()
        .prepare('UPDATE transcripts SET is_deleted = 1, deleted_at = ? WHERE id = ?')
        .run(nowIso(), id);
      return { success: true };
    },

    restore(id) {
      assertId(id);
      getDb()
        .prepare('UPDATE transcripts SET is_deleted = 0, deleted_at = NULL WHERE id = ?')
        .run(id);
      return { success: true };
    },

    remove(id) {
      assertId(id);
      const info = getDb().prepare('DELETE FROM transcripts WHERE id = ?').run(id);
      return { changes: info.changes };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeTranscripts(getDb);
  ipcMain.handle('transcripts:list', () => api.list());
  ipcMain.handle('transcripts:list-archived', () => api.listArchived());
  ipcMain.handle('transcripts:list-trashed', () => api.listTrashed());
  ipcMain.handle('transcripts:get', (_e, id) => api.get(id));
  ipcMain.handle('transcripts:get-for-chat', (_e, id) => api.getForChat(id));
  ipcMain.handle('transcripts:get-metadata', (_e, id) => api.getMetadata(id));
  ipcMain.handle('transcripts:find-duplicates', (_e, { filename, title }) =>
    api.findDuplicates(filename, title)
  );
  ipcMain.handle('transcripts:list-needing-segment-migration', () =>
    api.listNeedingSegmentMigration()
  );
  ipcMain.handle('transcripts:search-by-text', (_e, query) => api.searchByText(query));
  ipcMain.handle('transcripts:create', (_e, input) => api.create(input));
  ipcMain.handle('transcripts:update', (_e, { id, fields }) => api.update(id, fields));
  ipcMain.handle('transcripts:archive', (_e, id) => api.archive(id));
  ipcMain.handle('transcripts:unarchive', (_e, id) => api.unarchive(id));
  ipcMain.handle('transcripts:soft-delete', (_e, id) => api.softDelete(id));
  ipcMain.handle('transcripts:restore', (_e, id) => api.restore(id));
  ipcMain.handle('transcripts:remove', (_e, id) => api.remove(id));
}

module.exports = { register, makeTranscripts, UPDATABLE_COLUMNS, JSON_COLUMNS };
