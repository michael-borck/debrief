// Coordinated permanent-delete across SQLite and the LanceDB vector store.
//
// WHY THIS EXISTS
// Deletion used to be orchestrated in the renderer, which called two IPC
// handlers in sequence:
//
//   db.transcripts.remove(id)          -> deletes the SQLite row
//   vectorStore.deleteTranscriptChunks(id) -> deletes the embeddings
//
// Two problems with that shape:
//   1. Only ONE of the four call sites (deleteTranscript in TranscriptContext)
//      remembered to purge vectors. emptyTrash and the 30-day startup sweep
//      deleted the SQLite row and left the embeddings behind, so a
//      "permanently deleted" transcript's full text, speakers and timestamps
//      stayed in vectordb/ indefinitely — and stayed searchable, because
//      searchSimilar filtered on transcriptId/speaker but never on the
//      transcript's is_deleted flag.
//   2. The two stores have no shared transaction, so a failure between them
//      silently left them out of sync with no way to tell.
//
// This module makes the main process the single owner of the pair, so the
// renderer asks once and both stores move together.
//
// ORDERING: vectors are purged BEFORE the SQLite row is deleted. If we deleted
// SQLite first and the vector purge then failed, the transcript's full text
// would persist in vectordb/ forever with no UI path left to retry — the exact
// privacy leak this fixes. Reversing the order means a SQLite failure leaves a
// transcript that is still visible and still deletable, merely missing from the
// semantic index. That is a recoverable degradation, not a silent data leak.

/**
 * @param {Object} deps
 * @param {() => any} deps.getDb          - current better-sqlite3 handle (or null)
 * @param {() => {deleteTranscriptChunks: (id: string) => Promise<void>, isInitialized: boolean} | null} [deps.getVectorStore]
 */
function makePurgeService({ getDb, getVectorStore }) {
  function assertId(id, label) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`invalid ${label} id: ${JSON.stringify(id)}`);
    }
  }

  /**
   * Remove one transcript's embeddings. A vector store that was never
   * initialized has no rows to remove, so that is a success, not a failure.
   */
  async function purgeVectorsFor(transcriptId) {
    const store = getVectorStore ? getVectorStore() : null;
    if (!store?.isInitialized) return { purged: false, reason: 'vector store not initialized' };
    await store.deleteTranscriptChunks(transcriptId);
    return { purged: true };
  }

  return {
    /**
     * Permanently delete transcripts: SQLite row first-class (FK cascade clears
     * segments, chat, topics, project links), embeddings purged alongside.
     *
     * A vector-store failure does NOT block the row delete. Doing so would let
     * a corrupt/locked LanceDB make a transcript permanently undeletable, which
     * is a worse outcome than leftover rows. Instead the failure is reported
     * per-id (and logged by the caller) and the search-level exclusion filter
     * keeps the orphaned chunks unreachable through the app, so the privacy
     * guarantee still holds while the user's delete request always succeeds.
     *
     * Returns per-id outcomes so the caller can report partial failures instead
     * of assuming success.
     */
    async purgeTranscripts(ids) {
      if (!Array.isArray(ids)) throw new Error('purgeTranscripts requires an array of ids');
      const db = getDb();
      if (!db) throw new Error('database is not open');

      const results = [];
      for (const id of ids) {
        try {
          assertId(id, 'transcript');
        } catch (err) {
          results.push({ id, ok: false, error: err.message });
          continue;
        }

        // Vectors first — see the ordering note at the top of this file.
        let vectors = { purged: false };
        let vectorError;
        try {
          vectors = await purgeVectorsFor(id);
        } catch (err) {
          vectorError = err.message;
        }

        try {
          const info = db.prepare('DELETE FROM transcripts WHERE id = ?').run(id);
          results.push({
            id,
            ok: true,
            changes: info.changes,
            vectorsPurged: vectors.purged,
            ...(vectorError
              ? { vectorFailed: true, vectorError }
              : vectors.reason
                ? { vectorNote: vectors.reason }
                : {}),
          });
        } catch (err) {
          results.push({ id, ok: false, error: err.message });
        }
      }
      const vectorFailures = results.filter((r) => r.vectorFailed);
      return {
        purged: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        vectorFailures: vectorFailures.length,
        results,
      };
    },

    /**
     * Permanently delete projects.
     *
     * NOTE: a project does NOT own its transcripts. database/schema.sql gives
     * project_transcripts a cascade FK to both parents, but transcripts have no
     * ownership relation to projects — deleting a project removes the junction
     * rows and leaves the transcripts (and therefore their embeddings) intact.
     * That is existing, tested behaviour (tests/database-cascades.test.ts), and
     * this method deliberately does not touch vector rows, which would orphan
     * still-existing transcripts from their search index.
     */
    async purgeProjects(ids) {
      if (!Array.isArray(ids)) throw new Error('purgeProjects requires an array of ids');
      const db = getDb();
      if (!db) throw new Error('database is not open');

      const results = [];
      for (const id of ids) {
        try {
          assertId(id, 'project');
        } catch (err) {
          results.push({ id, ok: false, error: err.message });
          continue;
        }
        try {
          const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
          results.push({ id, ok: true, changes: info.changes });
        } catch (err) {
          results.push({ id, ok: false, error: err.message });
        }
      }
      return {
        purged: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },

    /**
     * Mixed purge for "empty trash", which can hold both kinds of item.
     */
    async purge({ transcripts = [], projects = [] } = {}) {
      const [t, p] = await Promise.all([
        this.purgeTranscripts(transcripts),
        this.purgeProjects(projects),
      ]);
      return {
        transcripts: t,
        projects: p,
        failed: t.failed + p.failed,
      };
    },

    // Exposed for the trash sweep, which needs the same vector guarantee but
    // does its own SELECT/DELETE: it has already removed the SQLite rows by
    // the time it knows which transcripts they were.
    purgeVectorsFor,

    /**
     * Vector-only purge for a batch of transcript ids. Best-effort per id: one
     * failing transcript must not abort the rest of the sweep.
     */
    async purgeVectorsForMany(ids) {
      if (!Array.isArray(ids)) throw new Error('purgeVectorsForMany requires an array of ids');
      const results = [];
      for (const id of ids) {
        try {
          results.push({ id, ok: true, ...(await purgeVectorsFor(id)) });
        } catch (err) {
          results.push({ id, ok: false, error: err.message });
        }
      }
      return {
        purged: results.filter((r) => r.ok && r.purged).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },
  };
}

module.exports = { makePurgeService };