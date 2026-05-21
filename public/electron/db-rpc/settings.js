// Per-domain RPC for the `settings` key/value table.
//
// Replaces 27 raw-SQL renderer call sites that all said one of:
//   - SELECT value FROM settings WHERE key = ?
//   - SELECT key, value FROM settings WHERE key IN (?, ?, ...)
//   - SELECT key, value FROM settings
//   - INSERT OR REPLACE INTO settings (key, value [, updated_at]) VALUES (...)
//
// Renderer now calls electronAPI.db.settings.{get|getMany|getAll|set|setMany}.
// No SQL crosses the IPC boundary — the renderer can't ATTACH databases,
// DROP tables, or read foreign tables via this surface.

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function assertKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error(`invalid settings key: ${JSON.stringify(key)}`);
  }
}

function assertValue(value) {
  // Settings values are stringly-typed in SQLite (TEXT NOT NULL). Callers
  // serialize JSON themselves where needed; we don't transparently
  // re-encode because then `get` would have ambiguous return semantics.
  if (typeof value !== 'string') {
    throw new Error(`settings value must be a string, got ${typeof value}`);
  }
}

// makeSettings takes a getDb getter rather than a db handle so the API
// keeps working after change-database-location closes and reopens the db.
// (Closures over the original handle would fire 'database is closed' on
// every call.) better-sqlite3 prepares are microsecond-cheap and cached
// internally, so re-preparing per call costs nothing.
function makeSettings(getDb) {
  return {
    get(key) {
      assertKey(key);
      const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? row.value : null;
    },

    getMany(keys) {
      if (!Array.isArray(keys)) throw new Error('keys must be an array');
      if (keys.length === 0) return {};
      keys.forEach(assertKey);
      // Build IN (?, ?, ...) dynamically. Keys are validated against
      // KEY_PATTERN so they cannot inject SQL into the placeholder list.
      const placeholders = keys.map(() => '?').join(', ');
      const rows = getDb()
        .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
        .all(...keys);
      const out = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },

    getAll() {
      const rows = getDb().prepare('SELECT key, value FROM settings').all();
      const out = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },

    set(key, value) {
      assertKey(key);
      assertValue(value);
      getDb()
        .prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
        )
        .run(key, value);
    },

    setMany(entries) {
      if (entries === null || typeof entries !== 'object') {
        throw new Error('entries must be an object');
      }
      const keys = Object.keys(entries);
      if (keys.length === 0) return;
      // Validate the whole batch up front so a bad key in position 5 doesn't
      // leave the first 4 partially applied.
      for (const k of keys) {
        assertKey(k);
        assertValue(entries[k]);
      }
      const db = getDb();
      const stmt = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
      );
      const tx = db.transaction((pairs) => {
        for (const [k, v] of pairs) stmt.run(k, v);
      });
      tx(Object.entries(entries));
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeSettings(getDb);
  ipcMain.handle('settings:get', (_e, key) => api.get(key));
  ipcMain.handle('settings:get-many', (_e, keys) => api.getMany(keys));
  ipcMain.handle('settings:get-all', () => api.getAll());
  ipcMain.handle('settings:set', (_e, { key, value }) => {
    api.set(key, value);
    return { success: true };
  });
  ipcMain.handle('settings:set-many', (_e, entries) => {
    api.setMany(entries);
    return { success: true };
  });
}

module.exports = { register, makeSettings, assertKey, assertValue };
