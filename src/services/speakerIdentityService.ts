// Cross-recording speaker identity ("voiceprints").
//
// speech-analyser's diarization produces one 256-dim wespeaker embedding
// per speaker cluster. When the user opts in (Settings > voiceprint
// recognition, default off — embeddings are biometric data), embeddings are
// stored locally against named identities. On later imports this service
// compares a new cluster's embedding against each identity's centroid and
// SUGGESTS a match. Nothing is ever auto-assigned: accepting a suggestion
// goes through the normal rename path, and enrolment happens when the user
// names a speaker.

import { logger } from '../utils/logger';

/** Cosine at/above which a match is suggested. Calibrated on synthetic
 *  voices (same-voice 0.62–0.83 vs cross-voice ≤0.31 in the 2026-10-16
 *  spike); shown in the UI next to the score so users can judge. */
export const SUGGESTION_THRESHOLD = 0.5;

/** Clusters with less speech than this produce unreliable voiceprints and
 *  are neither enrolled nor matched. */
export const MIN_TALK_SECONDS = 3;

export interface IdentityMatch {
  identityId: string;
  name: string;
  score: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mean of vectors, L2-normalised. Empty input -> null. */
export function centroid(vectors: number[][]): number[] | null {
  const usable = (vectors || []).filter((v) => Array.isArray(v) && v.length > 0);
  if (usable.length === 0) return null;
  const dim = usable[0].length;
  const mean = new Array<number>(dim).fill(0);
  for (const v of usable) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) mean[i] += v[i] / usable.length;
  }
  const norm = Math.sqrt(mean.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? null : mean.map((x) => x / norm);
}

/** Rank identities by cosine to `embedding`, best first, threshold applied. */
export function rankMatches(
  embedding: number[],
  candidates: Array<{ id: string; name: string; centroid: number[] | null }>,
  threshold: number = SUGGESTION_THRESHOLD
): IdentityMatch[] {
  return candidates
    .filter((c) => c.centroid)
    .map((c) => ({
      identityId: c.id,
      name: c.name,
      score: cosineSimilarity(embedding, c.centroid as number[]),
    }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

function parseEmbedding(raw: string): number[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'number')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Identity centroids from every enrolled embedding in the database. */
export async function loadIdentityCandidates(): Promise<
  Array<{ id: string; name: string; centroid: number[] | null }>
> {
  const [identities, embeddings] = await Promise.all([
    window.electronAPI.db.speakerIdentities.list(),
    window.electronAPI.db.speakerIdentities.listEmbeddings(),
  ]);
  const byIdentity = new Map<string, number[][]>();
  for (const row of embeddings) {
    if (!row.identity_id) continue;
    const vec = parseEmbedding(row.embedding);
    if (!vec) continue;
    const list = byIdentity.get(row.identity_id) || [];
    list.push(vec);
    byIdentity.set(row.identity_id, list);
  }
  return identities.map((i) => ({
    id: i.id,
    name: i.name,
    centroid: centroid(byIdentity.get(i.id) || []),
  }));
}

/** Whether voiceprint storage/matching is switched on (default off). */
export async function voiceprintsEnabled(): Promise<boolean> {
  try {
    return (await window.electronAPI.db.settings.get('enableVoiceprints')) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persist cluster embeddings from an analyse/rediarise result, when the
 * user has opted in. Returns how many were stored. Clusters under
 * MIN_TALK_SECONDS are skipped (unreliable voiceprints).
 */
export async function persistSpeakerEmbeddings(
  transcriptId: string,
  speakerEmbeddings: Record<string, number[]> | undefined,
  turns: Array<{ speaker: string; speakerId?: string; start: number; end: number }>
): Promise<number> {
  if (!speakerEmbeddings || Object.keys(speakerEmbeddings).length === 0) return 0;
  if (!(await voiceprintsEnabled())) return 0;

  const talkByCluster = new Map<string, number>();
  for (const t of turns || []) {
    const cluster = t.speakerId || t.speaker;
    talkByCluster.set(cluster, (talkByCluster.get(cluster) || 0) + Math.max(0, t.end - t.start));
  }

  let saved = 0;
  for (const [clusterId, embedding] of Object.entries(speakerEmbeddings)) {
    const talkSeconds = talkByCluster.get(clusterId) || 0;
    if (talkSeconds < MIN_TALK_SECONDS) continue;
    try {
      await window.electronAPI.db.speakerIdentities.saveEmbedding({
        transcriptId,
        clusterId,
        embedding,
        talkSeconds,
      });
      saved++;
    } catch (err) {
      logger.warn('Failed to store speaker embedding:', err);
    }
  }
  return saved;
}

/**
 * Enrol/assign identities after a rename: for each renamed speaker with a
 * stored embedding, link it to the identity with that name, creating the
 * identity when the name looks like a real name (not a raw cluster id).
 * Only runs when voiceprints are enabled.
 */
export async function enrolNamedSpeakers(
  transcriptId: string,
  speakers: Array<{ id: string; name: string }>
): Promise<void> {
  if (!(await voiceprintsEnabled())) return;
  try {
    const rows = await window.electronAPI.db.speakerIdentities.listEmbeddingsByTranscript(
      transcriptId
    );
    if (rows.length === 0) return;
    const identities = await window.electronAPI.db.speakerIdentities.list();

    for (const speaker of speakers) {
      const name = speaker.name?.trim();
      if (!name || /^SPEAKER[_ ]?\d+$/i.test(name) || /^Speaker \d+$/i.test(name)) continue;
      const row = rows.find((r) => r.cluster_id === speaker.id);
      if (!row) continue;

      let identity = identities.find(
        (i) => i.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (!identity) {
        const created = await window.electronAPI.db.speakerIdentities.create(name);
        identity = { ...created, created_at: '', updated_at: '', embedding_count: 0 };
        identities.push(identity);
      }
      if (row.identity_id !== identity.id) {
        await window.electronAPI.db.speakerIdentities.assign({
          transcriptId,
          clusterId: speaker.id,
          identityId: identity.id,
        });
      }
    }
  } catch (err) {
    logger.warn('Failed to enrol named speakers as identities:', err);
  }
}

/**
 * Best identity suggestion per cluster for one transcript, for the rename
 * UI. Returns {} when voiceprints are disabled or nothing clears the bar.
 */
export async function suggestIdentitiesForTranscript(
  transcriptId: string
): Promise<Record<string, IdentityMatch>> {
  if (!(await voiceprintsEnabled())) return {};
  try {
    const [rows, candidates] = await Promise.all([
      window.electronAPI.db.speakerIdentities.listEmbeddingsByTranscript(transcriptId),
      loadIdentityCandidates(),
    ]);
    const named = new Set(
      (await window.electronAPI.db.speakerIdentities.list()).map((i) => i.id)
    );
    const out: Record<string, IdentityMatch> = {};
    for (const row of rows) {
      if (row.identity_id && named.has(row.identity_id)) continue;
      if (row.talk_seconds < MIN_TALK_SECONDS) continue;
      const vec = parseEmbedding(row.embedding);
      if (!vec) continue;
      const [best] = rankMatches(vec, candidates);
      if (best) out[row.cluster_id] = best;
    }
    return out;
  } catch (err) {
    logger.warn('Failed to compute identity suggestions:', err);
    return {};
  }
}
