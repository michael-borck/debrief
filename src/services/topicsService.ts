// Per-transcript topic clustering for the Topics tab.
//
// Pipeline: pull chunks (with embeddings) from the vector store → k-means
// over the 384-dim normalised vectors → silhouette-score the best k unless
// the user pinned a count → one LLM call per cluster to produce a 3-5 word
// label → persist to transcript_topics so the next tab-open is free.

import { vectorStoreService, VectorChunk } from './vectorStoreService';

export interface Topic {
  id: string;
  transcriptId: string;
  topicIndex: number;
  label: string;
  summary: string;
  chunkIds: string[];
  // Derived from chunkIds at load time — not stored.
  chunks?: VectorChunk[];
  startTime?: number;
  endTime?: number;
  modelUsed?: string;
  createdAt?: string;
}

const MIN_K = 2;
const MAX_K = 6;
const KMEANS_MAX_ITERS = 50;
const REP_CHUNKS_PER_TOPIC = 3;

// Vectors come in pre-normalised (sentence-transformers normalize_embeddings=true),
// so dot product == cosine similarity. Squared euclidean distance over unit
// vectors is a strict monotone of cosine distance, so k-means clustering is
// equivalent — keep the simpler distance metric.
function squaredDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function mean(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

// k-means++ seeding so we don't degenerate to two clusters in the same spot
// on the first iteration. Deterministic given a seeded Math.random caller
// (we don't seed here; runs are stable-ish for a fixed dataset).
function seed(vectors: number[][], k: number): number[][] {
  const centroids: number[][] = [vectors[Math.floor(Math.random() * vectors.length)]];
  while (centroids.length < k) {
    const distances = vectors.map(v =>
      Math.min(...centroids.map(c => squaredDistance(v, c)))
    );
    const sum = distances.reduce((a, b) => a + b, 0);
    if (sum === 0) {
      centroids.push(vectors[Math.floor(Math.random() * vectors.length)]);
      continue;
    }
    let r = Math.random() * sum;
    for (let i = 0; i < vectors.length; i++) {
      r -= distances[i];
      if (r <= 0) {
        centroids.push(vectors[i]);
        break;
      }
    }
  }
  return centroids.map(c => [...c]);
}

interface KMeansResult {
  assignments: number[];
  centroids: number[][];
}

function kmeans(vectors: number[][], k: number): KMeansResult {
  let centroids = seed(vectors, k);
  let assignments = new Array(vectors.length).fill(0);

  for (let iter = 0; iter < KMEANS_MAX_ITERS; iter++) {
    let changed = false;
    for (let i = 0; i < vectors.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = squaredDistance(vectors[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    if (!changed) break;

    for (let c = 0; c < k; c++) {
      const cluster = vectors.filter((_, i) => assignments[i] === c);
      if (cluster.length > 0) centroids[c] = mean(cluster);
    }
  }
  return { assignments, centroids };
}

// Silhouette score: average over all points of (b - a) / max(a, b), where
// a = mean intra-cluster distance, b = mean nearest-other-cluster distance.
// Higher is better; range is [-1, 1]. We use it to pick k in [MIN_K, MAX_K].
function silhouette(vectors: number[][], assignments: number[], k: number): number {
  if (k < 2) return -1;
  const byCluster: number[][] = Array.from({ length: k }, () => []);
  assignments.forEach((c, i) => byCluster[c].push(i));

  let total = 0;
  let counted = 0;
  for (let i = 0; i < vectors.length; i++) {
    const ownCluster = assignments[i];
    const ownPeers = byCluster[ownCluster].filter(j => j !== i);
    if (ownPeers.length === 0) continue;

    const a = ownPeers.reduce((s, j) => s + Math.sqrt(squaredDistance(vectors[i], vectors[j])), 0) / ownPeers.length;

    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === ownCluster) continue;
      const peers = byCluster[c];
      if (peers.length === 0) continue;
      const d = peers.reduce((s, j) => s + Math.sqrt(squaredDistance(vectors[i], vectors[j])), 0) / peers.length;
      if (d < b) b = d;
    }
    if (b === Infinity) continue;

    total += (b - a) / Math.max(a, b);
    counted++;
  }
  return counted > 0 ? total / counted : -1;
}

function pickBestK(vectors: number[][]): { k: number; result: KMeansResult } {
  let bestK = MIN_K;
  let bestScore = -Infinity;
  let bestResult: KMeansResult = kmeans(vectors, MIN_K);

  for (let k = MIN_K; k <= Math.min(MAX_K, vectors.length - 1); k++) {
    const result = kmeans(vectors, k);
    const score = silhouette(vectors, result.assignments, k);
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
      bestResult = result;
    }
  }
  return { k: bestK, result: bestResult };
}

async function labelTopic(
  chunks: VectorChunk[],
  centroid: number[]
): Promise<{ label: string; summary: string; modelUsed: string }> {
  // Pick the N chunks closest to the centroid as representative samples.
  const ranked = chunks
    .map(c => ({ c, dist: squaredDistance(c.vector, centroid) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, REP_CHUNKS_PER_TOPIC)
    .map(r => r.c);

  const excerpts = ranked
    .map(c => `[${formatTime(c.startTime)}] ${c.text.trim()}`)
    .join('\n\n---\n\n');

  const prompt =
    'You are labelling a topic cluster from a conversation transcript. ' +
    'Look at the excerpts below and respond with TWO lines:\n' +
    'Line 1: a 3-5 word label (no quotes, no punctuation at the end).\n' +
    'Line 2: a single sentence (max 20 words) describing what this topic covers.\n' +
    'Do not mention "topic", "cluster", "excerpt", or yourself.';

  try {
    const response = await window.electronAPI.services.chatWithOllama({
      prompt,
      message: 'Label this cluster.',
      context: excerpts,
    });
    if (response.success && response.response) {
      const lines = response.response.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const label = (lines[0] || 'Untitled topic').replace(/^["']|["']$/g, '').slice(0, 80);
      const summary = (lines.slice(1).join(' ') || '').slice(0, 280);
      return { label, summary, modelUsed: (response as any).model || 'unknown' };
    }
  } catch (e) {
    console.error('Topic labelling failed:', e);
  }
  // Fallback: keyword from the centroid-closest chunk.
  const fallback = ranked[0]?.text?.split(/\s+/).slice(0, 5).join(' ') || 'Untitled topic';
  return { label: fallback, summary: '', modelUsed: 'fallback' };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface ComputeOptions {
  // Override the auto-pick. null/undefined = auto.
  numTopics?: number | null;
  onProgress?: (stage: string) => void;
}

export class TopicsService {
  // Compute topics from scratch. Persists to transcript_topics. Returns the
  // computed topics ready for display.
  async compute(transcriptId: string, opts: ComputeOptions = {}): Promise<Topic[]> {
    const { numTopics, onProgress } = opts;

    onProgress?.('Loading chunks');
    const chunks = await vectorStoreService.getTranscriptChunks(transcriptId);
    if (!chunks || chunks.length === 0) {
      throw new Error('No chunks found for this transcript. Open the chat tab once to index it, then retry.');
    }
    if (chunks.length < MIN_K) {
      throw new Error(`Only ${chunks.length} chunk(s) available — need at least ${MIN_K} to form topics. The transcript may be very short.`);
    }

    const vectors = chunks.map(c => c.vector);

    onProgress?.('Clustering');
    let kResult: KMeansResult;
    let k: number;
    if (numTopics && Number.isFinite(numTopics)) {
      k = Math.min(Math.max(numTopics, MIN_K), Math.min(MAX_K, chunks.length - 1));
      kResult = kmeans(vectors, k);
    } else {
      const picked = pickBestK(vectors);
      k = picked.k;
      kResult = picked.result;
    }

    // Group chunks by cluster.
    const clusters: VectorChunk[][] = Array.from({ length: k }, () => []);
    kResult.assignments.forEach((c, i) => clusters[c].push(chunks[i]));

    onProgress?.('Labelling topics');
    const topics: Topic[] = [];
    for (let i = 0; i < k; i++) {
      const clusterChunks = clusters[i];
      if (clusterChunks.length === 0) continue;
      onProgress?.(`Labelling topic ${i + 1} of ${k}`);
      const { label, summary, modelUsed } = await labelTopic(clusterChunks, kResult.centroids[i]);
      topics.push({
        id: `topic_${transcriptId}_${Date.now()}_${i}`,
        transcriptId,
        topicIndex: i,
        label,
        summary,
        chunkIds: clusterChunks.map(c => c.id),
        chunks: clusterChunks.sort((a, b) => a.startTime - b.startTime),
        startTime: Math.min(...clusterChunks.map(c => c.startTime)),
        endTime: Math.max(...clusterChunks.map(c => c.endTime)),
        modelUsed,
      });
    }

    // Sort topics by first appearance — so the panel reads roughly in
    // narrative order rather than k-means index order.
    topics.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    topics.forEach((t, i) => { t.topicIndex = i; });

    onProgress?.('Saving');
    await this.save(transcriptId, topics, kResult.centroids);
    return topics;
  }

  // Load topics for a transcript. Returns empty array if none cached.
  async load(transcriptId: string): Promise<Topic[]> {
    const rows = await window.electronAPI.database.all(
      'SELECT * FROM transcript_topics WHERE transcript_id = ? ORDER BY topic_index',
      [transcriptId]
    );
    if (!rows || rows.length === 0) return [];

    // Hydrate chunks for each topic.
    const allChunks = await vectorStoreService.getTranscriptChunks(transcriptId);
    const byId = new Map(allChunks.map(c => [c.id, c]));

    return rows.map((row: any) => {
      const chunkIds: string[] = JSON.parse(row.chunk_ids || '[]');
      const chunks = chunkIds.map(id => byId.get(id)).filter(Boolean) as VectorChunk[];
      chunks.sort((a, b) => a.startTime - b.startTime);
      return {
        id: row.id,
        transcriptId: row.transcript_id,
        topicIndex: row.topic_index,
        label: row.label,
        summary: row.summary || '',
        chunkIds,
        chunks,
        startTime: chunks[0]?.startTime,
        endTime: chunks[chunks.length - 1]?.endTime,
        modelUsed: row.model_used,
        createdAt: row.created_at,
      };
    });
  }

  // Wipe and rewrite topics for a transcript. Centroids are stored against
  // the first topic row (lazy — we only need them if we ever do online
  // re-assignment, which we don't yet).
  async save(transcriptId: string, topics: Topic[], centroids: number[][]): Promise<void> {
    await window.electronAPI.database.run(
      'DELETE FROM transcript_topics WHERE transcript_id = ?',
      [transcriptId]
    );
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i];
      await window.electronAPI.database.run(
        `INSERT INTO transcript_topics
         (id, transcript_id, topic_index, label, summary, chunk_ids, centroid, model_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          transcriptId,
          i,
          t.label,
          t.summary,
          JSON.stringify(t.chunkIds),
          JSON.stringify(centroids[t.topicIndex] || []),
          t.modelUsed || null,
        ]
      );
    }
  }

  async clear(transcriptId: string): Promise<void> {
    await window.electronAPI.database.run(
      'DELETE FROM transcript_topics WHERE transcript_id = ?',
      [transcriptId]
    );
  }
}

export const topicsService = new TopicsService();
