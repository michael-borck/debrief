// Per-domain RPC for speaker identities + voiceprint embeddings (schema v4).
//
// A speaker identity is a person the user has named. Each diarized
// transcript contributes one voiceprint embedding per cluster
// (transcript_speaker_embeddings); once the user confirms a match — or
// names the speaker — the row links to an identity, and future imports
// can suggest that identity by cosine similarity (matching itself lives
// in the renderer's speakerIdentityService; this module only stores).
//
// Embeddings are biometric data. They are written only when the user has
// opted in (the renderer checks the enableVoiceprints setting before
// calling saveEmbedding), stay in the local database, and are deleted
// with their transcript (FK cascade) or unlinked when an identity is
// deleted. deleteAllEmbeddings supports turning the feature off cleanly.
//
// All values are bound; ids and embeddings are validated at the door.

const crypto = require('node:crypto');

const MAX_EMBEDDING_DIM = 4096;

function assertId(id, what = 'id') {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid ${what}: ${JSON.stringify(id)}`);
  }
}

function assertEmbedding(embedding) {
  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    embedding.length > MAX_EMBEDDING_DIM ||
    !embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    throw new Error('embedding must be a non-empty array of finite numbers');
  }
  return embedding;
}

function makeSpeakerIdentities(getDb) {
  return {
    listIdentities() {
      return getDb()
        .prepare(
          `SELECT i.id, i.name, i.created_at, i.updated_at,
                  COUNT(e.transcript_id) AS embedding_count
           FROM speaker_identities i
           LEFT JOIN transcript_speaker_embeddings e ON e.identity_id = i.id
           GROUP BY i.id ORDER BY i.name COLLATE NOCASE`
        )
        .all();
    },

    createIdentity(name) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('identity name must be a non-empty string');
      }
      const id = crypto.randomUUID();
      getDb()
        .prepare('INSERT INTO speaker_identities (id, name) VALUES (?, ?)')
        .run(id, name.trim());
      return { id, name: name.trim() };
    },

    renameIdentity(id, name) {
      assertId(id, 'identity id');
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('identity name must be a non-empty string');
      }
      const info = getDb()
        .prepare(
          "UPDATE speaker_identities SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(name.trim(), id);
      return { changes: info.changes };
    },

    deleteIdentity(id) {
      assertId(id, 'identity id');
      const info = getDb()
        .prepare('DELETE FROM speaker_identities WHERE id = ?')
        .run(id);
      return { changes: info.changes };
    },

    /** Upsert one cluster voiceprint. Re-diarisation replaces the vector
     *  and clears any identity link (cluster ids are reassigned per run,
     *  so a stale link would point at a different voice). */
    saveEmbedding({ transcriptId, clusterId, embedding, talkSeconds }) {
      assertId(transcriptId, 'transcript id');
      assertId(clusterId, 'cluster id');
      assertEmbedding(embedding);
      const talk = Number.isFinite(talkSeconds) ? Math.max(0, talkSeconds) : 0;
      getDb()
        .prepare(
          `INSERT INTO transcript_speaker_embeddings
             (transcript_id, cluster_id, identity_id, embedding, talk_seconds)
           VALUES (?, ?, NULL, ?, ?)
           ON CONFLICT(transcript_id, cluster_id) DO UPDATE SET
             identity_id = NULL,
             embedding = excluded.embedding,
             talk_seconds = excluded.talk_seconds,
             updated_at = CURRENT_TIMESTAMP`
        )
        .run(transcriptId, clusterId, JSON.stringify(embedding), talk);
      return { saved: true };
    },

    listEmbeddings() {
      return getDb()
        .prepare(
          `SELECT transcript_id, cluster_id, identity_id, embedding, talk_seconds
           FROM transcript_speaker_embeddings
           ORDER BY transcript_id, cluster_id`
        )
        .all();
    },

    listEmbeddingsByTranscript(transcriptId) {
      assertId(transcriptId, 'transcript id');
      return getDb()
        .prepare(
          `SELECT transcript_id, cluster_id, identity_id, embedding, talk_seconds
           FROM transcript_speaker_embeddings
           WHERE transcript_id = ? ORDER BY cluster_id`
        )
        .all(transcriptId);
    },

    assignIdentity({ transcriptId, clusterId, identityId }) {
      assertId(transcriptId, 'transcript id');
      assertId(clusterId, 'cluster id');
      if (identityId !== null) assertId(identityId, 'identity id');
      const info = getDb()
        .prepare(
          `UPDATE transcript_speaker_embeddings
           SET identity_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE transcript_id = ? AND cluster_id = ?`
        )
        .run(identityId, transcriptId, clusterId);
      return { changes: info.changes };
    },

    /** Remove every stored voiceprint (feature switched off). Identities
     *  are removed too: with no embeddings they name nobody. */
    deleteAllVoiceprints() {
      const db = getDb();
      const wipe = db.transaction(() => {
        const embeddings = db
          .prepare('DELETE FROM transcript_speaker_embeddings')
          .run().changes;
        const identities = db
          .prepare('DELETE FROM speaker_identities')
          .run().changes;
        return { embeddings, identities };
      });
      return wipe();
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeSpeakerIdentities(getDb);
  ipcMain.handle('speaker-identities:list', () => api.listIdentities());
  ipcMain.handle('speaker-identities:create', (_e, name) => api.createIdentity(name));
  ipcMain.handle('speaker-identities:rename', (_e, id, name) => api.renameIdentity(id, name));
  ipcMain.handle('speaker-identities:delete', (_e, id) => api.deleteIdentity(id));
  ipcMain.handle('speaker-identities:save-embedding', (_e, payload) => api.saveEmbedding(payload));
  ipcMain.handle('speaker-identities:list-embeddings', () => api.listEmbeddings());
  ipcMain.handle('speaker-identities:list-embeddings-by-transcript', (_e, transcriptId) =>
    api.listEmbeddingsByTranscript(transcriptId)
  );
  ipcMain.handle('speaker-identities:assign', (_e, payload) => api.assignIdentity(payload));
  ipcMain.handle('speaker-identities:delete-all-voiceprints', () => api.deleteAllVoiceprints());
}

module.exports = { register, makeSpeakerIdentities };
