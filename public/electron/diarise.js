// ============================================
// Local speaker diarisation (pyannote + wespeaker)
// ============================================
//
// Pipeline:
//   1. pyannote-segmentation-3.0 finds speech regions and local speaker
//      activity in 5-second windows. Each frame is classified into a
//      "powerset" of up to 3 simultaneous speakers.
//   2. wespeaker-voxceleb-resnet34-LM produces a 256-d voice embedding
//      for each turn.
//   3. Agglomerative clustering on cosine similarity assigns global
//      speaker IDs across the whole audio.
//
// All models cached locally. No external server, no LLM guessing from
// text — speakers come from the actual audio.

const SEGMENTATION_MODEL = 'onnx-community/pyannote-segmentation-3.0';
const EMBEDDING_MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const PA_WINDOW_SECONDS = 5;
const SAMPLE_RATE = 16000;

// Diarisation tunables — empirically validated on a 30s clean conversation,
// a 5-min noisy 5-speaker file, and a 14-min structured interview.
// These defaults are overridable per-install via the Settings page;
// loadDiarisationSettings() refreshes them from the DB before each run.
const DIA_DEFAULTS = {
  medianFilterFrames: 11,
  minDurationOn: 0.50,
  minDurationOff: 0.20,
  clusterThreshold: 0.50,
  noiseMinTotalSeconds: 3.0,
};
let DIA_MEDIAN_FILTER_FRAMES = DIA_DEFAULTS.medianFilterFrames;
let DIA_MIN_DURATION_ON = DIA_DEFAULTS.minDurationOn;
let DIA_MIN_DURATION_OFF = DIA_DEFAULTS.minDurationOff;
let DIA_CLUSTER_THRESHOLD = DIA_DEFAULTS.clusterThreshold;
let DIA_NOISE_MIN_TOTAL_SECONDS = DIA_DEFAULTS.noiseMinTotalSeconds;

// pyannote-segmentation-3.0 powerset → active speaker indices
const POWERSET = [
  [],         // 0: silence
  [0],        // 1: speaker 0 only
  [1],        // 2: speaker 1 only
  [2],        // 3: speaker 2 only
  [0, 1],     // 4: speakers 0 + 1
  [0, 2],     // 5: speakers 0 + 2
  [1, 2],     // 6: speakers 1 + 2
];

let segmentationModel = null;
let segmentationProcessor = null;
let embeddingModel = null;
let embeddingProcessor = null;

// Injected dependencies (set via init())
let _getTransformers = null;
let _getDb = null;

function init(deps) {
  _getTransformers = deps.getTransformers;
  _getDb = deps.getDb;
}

function loadDiarisationSettings() {
  try {
    const db = _getDb && _getDb();
    if (!db) return;
    const read = (key, fallback) => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      const n = row?.value != null ? Number(row.value) : NaN;
      return Number.isFinite(n) ? n : fallback;
    };
    DIA_MEDIAN_FILTER_FRAMES = Math.max(1, Math.round(read('diaMedianFilterFrames', DIA_DEFAULTS.medianFilterFrames)));
    DIA_MIN_DURATION_ON = read('diaMinDurationOn', DIA_DEFAULTS.minDurationOn);
    DIA_MIN_DURATION_OFF = read('diaMinDurationOff', DIA_DEFAULTS.minDurationOff);
    DIA_CLUSTER_THRESHOLD = read('diaClusterThreshold', DIA_DEFAULTS.clusterThreshold);
    DIA_NOISE_MIN_TOTAL_SECONDS = read('diaNoiseMinTotalSeconds', DIA_DEFAULTS.noiseMinTotalSeconds);
  } catch (err) {
    console.warn('[diarise] failed to load tunables, using defaults:', err.message);
  }
}

async function getDiarisationModels(progressCallback) {
  if (segmentationModel && embeddingModel) {
    return { segmentationModel, segmentationProcessor, embeddingModel, embeddingProcessor };
  }

  const { AutoProcessor, AutoModel } = await _getTransformers();

  if (!segmentationModel) {
    console.log(`[diarise] loading segmentation: ${SEGMENTATION_MODEL}`);
    const t0 = Date.now();
    segmentationProcessor = await AutoProcessor.from_pretrained(SEGMENTATION_MODEL, {
      progress_callback: progressCallback,
    });
    segmentationModel = await AutoModel.from_pretrained(SEGMENTATION_MODEL, {
      progress_callback: progressCallback,
    });
    console.log(`[diarise] segmentation ready in ${Date.now() - t0} ms`);
  }

  if (!embeddingModel) {
    console.log(`[diarise] loading embedding: ${EMBEDDING_MODEL}`);
    const t0 = Date.now();
    embeddingProcessor = await AutoProcessor.from_pretrained(EMBEDDING_MODEL, {
      progress_callback: progressCallback,
    });
    embeddingModel = await AutoModel.from_pretrained(EMBEDDING_MODEL, {
      progress_callback: progressCallback,
    });
    console.log(`[diarise] embedding ready in ${Date.now() - t0} ms`);
  }

  return { segmentationModel, segmentationProcessor, embeddingModel, embeddingProcessor };
}

function argmax(arr) {
  let bestIdx = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > bestVal) { bestVal = arr[i]; bestIdx = i; }
  }
  return bestIdx;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

async function segmentWindow(audio) {
  const inputs = await segmentationProcessor(audio);
  const outputs = await segmentationModel(inputs);
  const logits = outputs.logits;
  const [, F, C] = logits.dims;
  const data = logits.data;

  // Step 1: per-frame argmax → class indices
  // Step 2: convert each class to per-speaker activation booleans
  const channels = [new Array(F), new Array(F), new Array(F)];
  for (let f = 0; f < F; f++) {
    const start = f * C;
    const cls = argmax(data.subarray(start, start + C));
    const active = POWERSET[cls];
    for (let s = 0; s < 3; s++) {
      channels[s][f] = active.includes(s) ? 1 : 0;
    }
  }

  // Step 3: median filter each channel to kill single-frame jitter.
  // Without this, pyannote's frame-level flicker creates dozens of
  // micro-fragments per real turn, which destroys downstream clustering.
  const half = Math.floor(DIA_MEDIAN_FILTER_FRAMES / 2);
  for (let s = 0; s < 3; s++) {
    const smoothed = new Array(F);
    for (let f = 0; f < F; f++) {
      let sum = 0;
      let count = 0;
      for (let k = -half; k <= half; k++) {
        const idx = f + k;
        if (idx >= 0 && idx < F) {
          sum += channels[s][idx];
          count++;
        }
      }
      smoothed[f] = sum / count >= 0.5 ? 1 : 0;
    }
    channels[s] = smoothed;
  }

  return channels;
}

function channelsToTurns(channels, windowSeconds, windowStart) {
  const turns = [];
  const F = channels[0].length;
  const framesPerSecond = F / windowSeconds;

  for (let speaker = 0; speaker < 3; speaker++) {
    const ch = channels[speaker];
    let inTurn = false;
    let startFrame = 0;
    for (let f = 0; f < F; f++) {
      if (ch[f] && !inTurn) {
        inTurn = true;
        startFrame = f;
      } else if (!ch[f] && inTurn) {
        inTurn = false;
        turns.push({
          start: windowStart + startFrame / framesPerSecond,
          end: windowStart + f / framesPerSecond,
          localSpeaker: speaker,
        });
      }
    }
    if (inTurn) {
      turns.push({
        start: windowStart + startFrame / framesPerSecond,
        end: windowStart + F / framesPerSecond,
        localSpeaker: speaker,
      });
    }
  }
  return turns;
}

// Merge same-channel turns separated by gaps shorter than minDurationOff.
// Channel here is a stable per-window+local-speaker tag so we don't merge
// across different local speakers.
function mergeAdjacentTurns(turns, minDurationOff) {
  if (turns.length === 0) return turns;
  const sorted = turns.slice().sort((a, b) => a.start - b.start);
  const merged = [];
  for (const turn of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.channel === turn.channel &&
      turn.start - last.end <= minDurationOff
    ) {
      last.end = Math.max(last.end, turn.end);
    } else {
      merged.push({ ...turn });
    }
  }
  return merged;
}

async function embedTurn(audioSlice) {
  // wespeaker needs at least ~250 ms of audio for a stable embedding
  let input = audioSlice;
  const minSamples = Math.ceil(SAMPLE_RATE * 0.25);
  if (input.length < minSamples) {
    const padded = new Float32Array(minSamples);
    padded.set(input);
    input = padded;
  }
  const inputs = await embeddingProcessor(input);
  const outputs = await embeddingModel(inputs);
  const tensor = outputs.embeddings || outputs.last_hidden_state || Object.values(outputs)[0];
  return Array.from(tensor.data);
}

function clusterTurns(turns, embeddings, threshold = 0.5) {
  if (turns.length === 0) return [];
  if (turns.length === 1) return [0];

  const clusters = turns.map((_, i) => [i]);
  const centroids = embeddings.map((e) => e.slice());

  while (clusters.length > 1) {
    let bestI = -1, bestJ = -1, bestSim = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = cosineSimilarity(centroids[i], centroids[j]);
        if (sim > bestSim) { bestSim = sim; bestI = i; bestJ = j; }
      }
    }
    if (bestSim < threshold) break;

    const merged = clusters[bestI].concat(clusters[bestJ]);
    const newCentroid = new Array(centroids[bestI].length).fill(0);
    for (const turnIdx of merged) {
      for (let k = 0; k < newCentroid.length; k++) {
        newCentroid[k] += embeddings[turnIdx][k];
      }
    }
    for (let k = 0; k < newCentroid.length; k++) {
      newCentroid[k] /= merged.length;
    }
    clusters[bestI] = merged;
    centroids[bestI] = newCentroid;
    clusters.splice(bestJ, 1);
    centroids.splice(bestJ, 1);
  }

  const labels = new Array(turns.length);
  for (let c = 0; c < clusters.length; c++) {
    for (const turnIdx of clusters[c]) {
      labels[turnIdx] = c;
    }
  }
  return labels;
}

/**
 * Run the full diarisation pipeline on already-decoded audio.
 * Returns an array of { start, end, speaker } turns where `speaker` is
 * a string label like "Speaker 1", "Speaker 2", ...
 *
 * Pipeline:
 *   1. Segment audio in 5s windows with median filtering
 *   2. Merge brief gaps within the same channel
 *   3. Drop turns shorter than min_duration_on (reassigned later by neighbour)
 *   4. Embed each long-enough turn with wespeaker
 *   5. Agglomerative cosine clustering
 *   6. Reassign noise clusters (< 3s total) to nearest substantial cluster
 *   7. Reassign dropped short turns to nearest substantial cluster
 */
async function diariseAudio(audio, progressCallback) {
  await getDiarisationModels(progressCallback);

  const audioSeconds = audio.length / SAMPLE_RATE;
  let allTurns = [];
  const windowSamples = PA_WINDOW_SECONDS * SAMPLE_RATE;
  let windowIdx = 0;

  // ----- Stage 1: window-by-window segmentation -----
  for (let start = 0; start < audio.length; start += windowSamples) {
    const slice = audio.subarray(start, Math.min(start + windowSamples, audio.length));
    let windowAudio = slice;
    if (slice.length < windowSamples) {
      windowAudio = new Float32Array(windowSamples);
      windowAudio.set(slice);
    }
    const channels = await segmentWindow(windowAudio);
    const windowTurns = channelsToTurns(channels, PA_WINDOW_SECONDS, start / SAMPLE_RATE);
    for (const t of windowTurns) {
      if (t.start < audioSeconds) {
        t.end = Math.min(t.end, audioSeconds);
        t.channel = `w${windowIdx}_s${t.localSpeaker}`;
        allTurns.push(t);
      }
    }
    windowIdx++;
  }
  console.log(`[diarise] raw turns from segmentation: ${allTurns.length}`);

  if (allTurns.length === 0) return [];

  // ----- Stage 2: merge brief gaps within each channel -----
  allTurns = mergeAdjacentTurns(allTurns, DIA_MIN_DURATION_OFF);

  // ----- Stage 3: split into long-enough turns and short turns -----
  const longEnough = allTurns.filter((t) => t.end - t.start >= DIA_MIN_DURATION_ON);
  const tooShort = allTurns.filter((t) => t.end - t.start < DIA_MIN_DURATION_ON);
  console.log(`[diarise] long-enough turns: ${longEnough.length}, dropped short: ${tooShort.length}`);

  if (longEnough.length === 0) {
    return [];
  }

  // ----- Stage 4: embed each long-enough turn -----
  console.log(`[diarise] computing ${longEnough.length} embeddings...`);
  const embeddings = [];
  for (const turn of longEnough) {
    const startSample = Math.floor(turn.start * SAMPLE_RATE);
    const endSample = Math.floor(turn.end * SAMPLE_RATE);
    embeddings.push(await embedTurn(audio.subarray(startSample, endSample)));
  }

  // ----- Stage 5: agglomerative cosine clustering -----
  let labels = clusterTurns(longEnough, embeddings, DIA_CLUSTER_THRESHOLD);
  console.log(`[diarise] initial cluster count: ${new Set(labels).size}`);

  // ----- Stage 6: reassign noise clusters to nearest substantial cluster -----
  // Tiny clusters (< 3s of total audio across their turns) are unreliable
  // outliers. Move their turns to the temporally-nearest substantial cluster.
  const clusterDuration = new Map();
  for (let i = 0; i < longEnough.length; i++) {
    const dur = longEnough[i].end - longEnough[i].start;
    clusterDuration.set(labels[i], (clusterDuration.get(labels[i]) || 0) + dur);
  }
  const substantialClusters = new Set(
    Array.from(clusterDuration.entries())
      .filter(([_, total]) => total >= DIA_NOISE_MIN_TOTAL_SECONDS)
      .map(([cluster, _]) => cluster)
  );
  console.log(`[diarise] substantial clusters: ${substantialClusters.size}`);

  if (substantialClusters.size > 0) {
    for (let i = 0; i < longEnough.length; i++) {
      if (!substantialClusters.has(labels[i])) {
        const turnMid = (longEnough[i].start + longEnough[i].end) / 2;
        let bestDist = Infinity;
        let bestCluster = labels[i];
        for (let j = 0; j < longEnough.length; j++) {
          if (i === j || !substantialClusters.has(labels[j])) continue;
          const otherMid = (longEnough[j].start + longEnough[j].end) / 2;
          const dist = Math.abs(turnMid - otherMid);
          if (dist < bestDist) {
            bestDist = dist;
            bestCluster = labels[j];
          }
        }
        labels[i] = bestCluster;
      }
    }
  }

  // Renumber clusters from 0 contiguously
  const oldToNew = new Map();
  let nextId = 0;
  labels = labels.map((l) => {
    if (!oldToNew.has(l)) oldToNew.set(l, nextId++);
    return oldToNew.get(l);
  });
  console.log(`[diarise] final speaker count: ${new Set(labels).size}`);

  // ----- Stage 7: build final turn list, including reassigned short turns -----
  const finalTurns = longEnough.map((t, i) => ({
    start: t.start,
    end: t.end,
    speakerId: labels[i],
  }));

  for (const shortTurn of tooShort) {
    const mid = (shortTurn.start + shortTurn.end) / 2;
    let bestDist = Infinity;
    let bestSpeaker = 0;
    for (const t of finalTurns) {
      const tMid = (t.start + t.end) / 2;
      const dist = Math.abs(mid - tMid);
      if (dist < bestDist) {
        bestDist = dist;
        bestSpeaker = t.speakerId;
      }
    }
    finalTurns.push({
      start: shortTurn.start,
      end: shortTurn.end,
      speakerId: bestSpeaker,
    });
  }
  finalTurns.sort((a, b) => a.start - b.start);

  return finalTurns.map((t) => ({
    start: t.start,
    end: t.end,
    speaker: `Speaker ${t.speakerId + 1}`,
  }));
}

/**
 * Assign a speaker to each whisper text segment by finding the
 * diarisation turn it overlaps with most. Returns the same chunkTimings
 * array with `speaker` populated.
 */
function alignSpeakersToChunks(chunkTimings, diarisationTurns) {
  if (!diarisationTurns || diarisationTurns.length === 0) {
    return chunkTimings;
  }
  return chunkTimings.map((chunk) => {
    let bestSpeaker = null;
    let bestOverlap = 0;
    for (const turn of diarisationTurns) {
      const overlapStart = Math.max(chunk.startTime, turn.start);
      const overlapEnd = Math.min(chunk.endTime, turn.end);
      const overlap = overlapEnd - overlapStart;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = turn.speaker;
      }
    }
    return { ...chunk, speaker: bestSpeaker || undefined };
  });
}

module.exports = {
  init,
  loadDiarisationSettings,
  diariseAudio,
  alignSpeakersToChunks,
};
