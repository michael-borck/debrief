// Per-domain RPC for the `projects` table.
//
// Replaces single-table projects reads/writes. The project list/detail
// reads that aggregate across project_transcripts + transcripts (the
// COUNT/SUM JOIN queries) belong in the project_transcripts domain, not
// here — they're migrated in a later phase.
//
// Renderer now calls electronAPI.db.projects.*. update() validates every
// column name against an allow-list before building the SET clause, so the
// renderer can't smuggle SQL through object keys.

// Columns the renderer may write via update(). Excludes id and created_at.
// Sourced from database/schema.sql.
const UPDATABLE_COLUMNS = new Set([
  'name', 'description', 'themes', 'key_insights', 'summary', 'last_analysis_at',
  'tags', 'color', 'icon', 'is_archived', 'archived_at', 'is_deleted', 'deleted_at',
  'updated_at',
]);

// TEXT columns holding JSON; serialized if given an object/array.
const JSON_COLUMNS = new Set(['themes', 'key_insights', 'tags']);

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid project id: ${JSON.stringify(id)}`);
  }
}

// SQLite binds only null/number/bigint/string/Buffer. Serialize JSON columns
// and coerce booleans to 0/1 (matches better-sqlite3 v11; node:sqlite, used
// in tests, rejects raw booleans).
function bindValue(key, value) {
  if (JSON_COLUMNS.has(key) && value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function makeProjects(getDb) {
  const nowIso = () => new Date().toISOString();

  return {
    // ---- reads ----
    get(id) {
      assertId(id);
      return (
        getDb()
          .prepare('SELECT * FROM projects WHERE id = ? AND is_deleted = 0')
          .get(id) ?? null
      );
    },

    listArchived() {
      return getDb()
        .prepare('SELECT * FROM projects WHERE is_archived = 1 ORDER BY archived_at DESC')
        .all();
    },

    listTrashed() {
      return getDb()
        .prepare('SELECT * FROM projects WHERE is_deleted = 1 ORDER BY deleted_at DESC')
        .all();
    },

    // ---- writes ----
    create(input) {
      if (input === null || typeof input !== 'object') {
        throw new Error('project create() requires an object');
      }
      const { id, name } = input;
      assertId(id);
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('project name must be a non-empty string');
      }
      const ts = nowIso();
      getDb()
        .prepare(
          'INSERT INTO projects (id, name, description, created_at, updated_at, themes, key_insights, tags, color, icon) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          id,
          name,
          input.description ?? null,
          ts,
          ts,
          bindValue('themes', input.themes ?? []),
          bindValue('key_insights', input.key_insights ?? []),
          bindValue('tags', input.tags ?? []),
          input.color ?? null,
          input.icon ?? null
        );
      return { id };
    },

    update(id, fields) {
      assertId(id);
      if (fields === null || typeof fields !== 'object') {
        throw new Error('project update() requires a fields object');
      }
      const keys = Object.keys(fields);
      if (keys.length === 0) return { changes: 0 };
      const sets = [];
      const values = [];
      for (const key of keys) {
        if (!UPDATABLE_COLUMNS.has(key)) {
          throw new Error(`invalid project column: ${JSON.stringify(key)}`);
        }
        sets.push(`${key} = ?`);
        values.push(bindValue(key, fields[key]));
      }
      values.push(id);
      const info = getDb()
        .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
        .run(...values);
      return { changes: info.changes };
    },

    archive(id) {
      assertId(id);
      getDb()
        .prepare('UPDATE projects SET is_archived = 1, archived_at = ? WHERE id = ?')
        .run(nowIso(), id);
      return { success: true };
    },

    unarchive(id) {
      assertId(id);
      getDb()
        .prepare('UPDATE projects SET is_archived = 0, archived_at = NULL WHERE id = ?')
        .run(id);
      return { success: true };
    },

    restore(id) {
      assertId(id);
      getDb()
        .prepare('UPDATE projects SET is_deleted = 0, deleted_at = NULL WHERE id = ?')
        .run(id);
      return { success: true };
    },

    remove(id) {
      assertId(id);
      const info = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
      return { changes: info.changes };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeProjects(getDb);
  ipcMain.handle('projects:get', (_e, id) => api.get(id));
  ipcMain.handle('projects:list-archived', () => api.listArchived());
  ipcMain.handle('projects:list-trashed', () => api.listTrashed());
  ipcMain.handle('projects:create', (_e, input) => api.create(input));
  ipcMain.handle('projects:update', (_e, { id, fields }) => api.update(id, fields));
  ipcMain.handle('projects:archive', (_e, id) => api.archive(id));
  ipcMain.handle('projects:unarchive', (_e, id) => api.unarchive(id));
  ipcMain.handle('projects:restore', (_e, id) => api.restore(id));
  ipcMain.handle('projects:remove', (_e, id) => api.remove(id));
}

module.exports = { register, makeProjects, UPDATABLE_COLUMNS, JSON_COLUMNS };
