// Per-domain RPC for the `model_metadata` table — cached per-model context
// limits / capabilities used for dynamic context sizing.
//
// get returns the raw row (capabilities/parameters still JSON strings, the
// boolean flags still 0/1) so the renderer keeps owning the field mapping.
// upsert serializes the JSON columns and coerces the booleans in main.

function assertName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`invalid model name: ${JSON.stringify(name)}`);
  }
}

function toJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function makeModelMetadata(getDb) {
  return {
    get(modelName) {
      assertName(modelName);
      return (
        getDb().prepare('SELECT * FROM model_metadata WHERE model_name = ?').get(modelName) ?? null
      );
    },

    upsert(input) {
      if (input === null || typeof input !== 'object') {
        throw new Error('model metadata upsert() requires an object');
      }
      const { modelName, provider } = input;
      assertName(modelName);
      if (typeof provider !== 'string' || provider.length === 0) {
        throw new Error('model metadata provider must be a non-empty string');
      }
      getDb()
        .prepare(
          `INSERT OR REPLACE INTO model_metadata
             (model_name, provider, context_limit, capabilities, parameters, last_updated, user_override, is_available)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          modelName,
          provider,
          input.contextLimit ?? null,
          toJson(input.capabilities),
          toJson(input.parameters),
          input.lastUpdated ?? new Date().toISOString(),
          input.userOverride ? 1 : 0,
          input.isAvailable ? 1 : 0
        );
      return { success: true };
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeModelMetadata(getDb);
  ipcMain.handle('model-metadata:get', (_e, modelName) => api.get(modelName));
  ipcMain.handle('model-metadata:upsert', (_e, input) => api.upsert(input));
}

module.exports = { register, makeModelMetadata };
