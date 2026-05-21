// Per-domain RPC for the `project_analysis` table — cached cross-transcript
// analysis results (the project insights/export read the latest one).
//
// Two writers exist: the comprehensive-analysis path passes an explicit
// created_at; the per-type cache path lets the column default fire. We keep
// both code paths so created_at formatting (and therefore the "latest"
// ordering) is byte-for-byte what it was before the migration.

function assertId(name, id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid ${name}: ${JSON.stringify(id)}`);
  }
}

function makeProjectAnalysis(getDb) {
  return {
    // Inserts one analysis row. `results` may be an object (serialized here)
    // or a pre-stringified JSON string. `createdAt` is optional — omit it to
    // use the schema's CURRENT_TIMESTAMP default.
    insert(input) {
      if (input === null || typeof input !== 'object') {
        throw new Error('project analysis insert() requires an object');
      }
      const { id, projectId, analysisType } = input;
      assertId('analysis id', id);
      assertId('project id', projectId);
      if (typeof analysisType !== 'string' || analysisType.length === 0) {
        throw new Error('analysisType must be a non-empty string');
      }
      const results =
        typeof input.results === 'string' ? input.results : JSON.stringify(input.results ?? null);
      const db = getDb();
      if (input.createdAt !== undefined) {
        db.prepare(
          'INSERT INTO project_analysis (id, project_id, analysis_type, results, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(id, projectId, analysisType, results, input.createdAt);
      } else {
        db.prepare(
          'INSERT INTO project_analysis (id, project_id, analysis_type, results) VALUES (?, ?, ?, ?)'
        ).run(id, projectId, analysisType, results);
      }
      return { id };
    },

    // Most recent analysis row for a project as { results } (JSON string), or
    // null. The renderer JSON.parses it.
    getLatestResults(projectId) {
      assertId('project id', projectId);
      return (
        getDb()
          .prepare(
            'SELECT results FROM project_analysis WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
          )
          .get(projectId) ?? null
      );
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeProjectAnalysis(getDb);
  ipcMain.handle('project-analysis:insert', (_e, input) => api.insert(input));
  ipcMain.handle('project-analysis:get-latest-results', (_e, projectId) =>
    api.getLatestResults(projectId)
  );
}

module.exports = { register, makeProjectAnalysis };
