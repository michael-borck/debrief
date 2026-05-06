#!/usr/bin/env node
/**
 * Improved diarisation pipeline.
 *
 * Fixes the over-segmentation problem from earlier iterations:
 *   1. Median filter on per-frame predictions to kill single-frame jitter.
 *   2. min_duration_on (drop turns shorter than threshold) and
 *      min_duration_off (merge gaps shorter than threshold).
 *   3. Short turns (< 0.5s) get assigned to the nearest-neighbour cluster
 *      by time, instead of being clustered with their (noisy) embedding.
 *   4. Lower default cosine threshold (0.35).
 *
 * Usage: node scripts/spike-diarisation-v2.js <audio>
 */

const { spawn } = require('child_process');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const SR = 16000;
const PA_WINDOW_SECONDS = 5;

// Tunables
const MEDIAN_FILTER_FRAMES = 11;     // smooth ±5 frames around each frame (~80 ms each side)
const MIN_DURATION_ON = 0.50;        // turns under this are dropped (or assigned by neighbour)
const MIN_DURATION_OFF = 0.20;       // gaps shorter than this within a speaker get merged
const EMBED_MIN_DURATION = 0.5;      // turns shorter than this skip independent embedding
const CLUSTER_THRESHOLD = 0.50;      // cosine similarity merge threshold (lower = more merging)

const POWERSET = [
  [],         // 0: silence
  [0],        // 1: speaker 0
  [1],        // 2: speaker 1
  [2],        // 3: speaker 2
  [0, 1],     // 4: speakers 0+1
  [0, 2],     // 5: speakers 0+2
  [1, 2],     // 6: speakers 1+2
];

function decodeAudioToFloat32(audioPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', audioPath,
      '-f', 'f32le', '-acodec', 'pcm_f32le',
      '-ac', '1', '-ar', String(SR),
      'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    ffmpeg.stdout.on('data', (c) => chunks.push(c));
    ffmpeg.stderr.on('data', (c) => { stderr += c.toString(); });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${stderr}`));
      const buf = Buffer.concat(chunks);
      const float32 = new Float32Array(
        buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)
      );
      resolve(float32);
    });
  });
}

function argmax(arr) {
  let bestIdx = 0;
  let bestVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > bestVal) { bestVal = arr[i]; bestIdx = i; }
  }
  return bestIdx;
}

async function segmentWindow(model, processor, audio) {
  const inputs = await processor(audio);
  const outputs = await model(inputs);
  const logits = outputs.logits;
  const [, F, C] = logits.dims;
  const data = logits.data;

  // Step 1: per-frame argmax → array of class indices
  const frameClasses = new Array(F);
  for (let f = 0; f < F; f++) {
    const start = f * C;
    frameClasses[f] = argmax(data.subarray(start, start + C));
  }

  // Step 2: convert each class to per-speaker activation booleans
  // (3 binary channels — one per local speaker)
  const channels = [new Array(F), new Array(F), new Array(F)];
  for (let f = 0; f < F; f++) {
    const active = POWERSET[frameClasses[f]];
    for (let s = 0; s < 3; s++) {
      channels[s][f] = active.includes(s) ? 1 : 0;
    }
  }

  // Step 3: median filter each channel independently to kill jitter
  const half = Math.floor(MEDIAN_FILTER_FRAMES / 2);
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

// Merge turns from the same speaker channel that are separated by less
// than minDurationOff seconds. Operates on already-globally-stitched turns
// keyed by some tag (we use windowIndex+localSpeaker as the key).
function mergeAdjacentTurns(turns, minDurationOff) {
  if (turns.length === 0) return turns;
  // Sort by start time, then merge consecutive same-channel turns with
  // a small gap
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

async function embedTurn(model, processor, audio) {
  const inputs = await processor(audio);
  const outputs = await model(inputs);
  const tensor = outputs.embeddings || outputs.last_hidden_state || Object.values(outputs)[0];
  return Array.from(tensor.data);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function clusterTurns(turns, embeddings, threshold) {
  if (turns.length === 0) return [];
  if (turns.length === 1) return [0];

  const clusters = turns.map((_, i) => [i]);
  const centroids = embeddings.map((e) => e.slice());

  while (clusters.length > 1) {
    let bestI = -1, bestJ = -1, bestSim = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = cosine(centroids[i], centroids[j]);
        if (sim > bestSim) { bestSim = sim; bestI = i; bestJ = j; }
      }
    }
    if (bestSim < threshold) break;

    const merged = clusters[bestI].concat(clusters[bestJ]);
    const newCentroid = new Array(centroids[bestI].length).fill(0);
    for (const idx of merged) {
      for (let k = 0; k < newCentroid.length; k++) {
        newCentroid[k] += embeddings[idx][k];
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
    for (const idx of clusters[c]) {
      labels[idx] = c;
    }
  }
  return labels;
}

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error('Usage: node scripts/spike-diarisation-v2.js <audio>');
    process.exit(1);
  }

  console.log('[diarise v2] decoding...');
  const audio = await decodeAudioToFloat32(path.resolve(audioPath));
  const audioSeconds = audio.length / SR;
  console.log(`[diarise v2] decoded ${audio.length} samples (${audioSeconds.toFixed(2)}s)`);

  console.log('[diarise v2] loading models...');
  const tx = await import('@huggingface/transformers');
  const { AutoProcessor, AutoModel, env } = tx;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;

  const segProcessor = await AutoProcessor.from_pretrained('onnx-community/pyannote-segmentation-3.0');
  const segModel = await AutoModel.from_pretrained('onnx-community/pyannote-segmentation-3.0');
  const embProcessor = await AutoProcessor.from_pretrained('onnx-community/wespeaker-voxceleb-resnet34-LM');
  const embModel = await AutoModel.from_pretrained('onnx-community/wespeaker-voxceleb-resnet34-LM');

  // ----- Segment windows -----
  console.log('\n[diarise v2] running segmentation...');
  let allTurns = [];
  const windowSamples = PA_WINDOW_SECONDS * SR;
  let windowIdx = 0;
  const t0 = Date.now();
  for (let start = 0; start < audio.length; start += windowSamples) {
    const slice = audio.subarray(start, Math.min(start + windowSamples, audio.length));
    let windowAudio = slice;
    if (slice.length < windowSamples) {
      windowAudio = new Float32Array(windowSamples);
      windowAudio.set(slice);
    }
    const channels = await segmentWindow(segModel, segProcessor, windowAudio);
    const windowTurns = channelsToTurns(channels, PA_WINDOW_SECONDS, start / SR);
    // Tag each turn with a stable channel key so adjacent merge can use it
    for (const t of windowTurns) {
      if (t.start < audioSeconds) {
        t.end = Math.min(t.end, audioSeconds);
        t.channel = `w${windowIdx}_s${t.localSpeaker}`;
        allTurns.push(t);
      }
    }
    windowIdx++;
  }
  console.log(`[diarise v2] segmentation done in ${Date.now() - t0} ms, ${allTurns.length} raw turns`);

  // ----- Merge brief gaps within same channel -----
  allTurns = mergeAdjacentTurns(allTurns, MIN_DURATION_OFF);
  console.log(`[diarise v2] after gap merge: ${allTurns.length} turns`);

  // ----- Drop turns shorter than min_duration_on -----
  // (we'll assign them later by neighbour)
  const longEnough = allTurns.filter((t) => t.end - t.start >= MIN_DURATION_ON);
  const tooShort = allTurns.filter((t) => t.end - t.start < MIN_DURATION_ON);
  console.log(`[diarise v2] long-enough turns: ${longEnough.length}, dropped short: ${tooShort.length}`);

  if (longEnough.length === 0) {
    console.log('[diarise v2] no turns long enough — try lowering MIN_DURATION_ON');
    return;
  }

  // ----- Embed each long-enough turn -----
  console.log('\n[diarise v2] computing embeddings...');
  const tEmb = Date.now();
  const embeddings = [];
  for (const turn of longEnough) {
    const startSample = Math.floor(turn.start * SR);
    const endSample = Math.floor(turn.end * SR);
    const slice = audio.subarray(startSample, endSample);
    let input = slice;
    if (slice.length < SR * 0.5) {
      const padded = new Float32Array(Math.ceil(SR * 0.5));
      padded.set(slice);
      input = padded;
    }
    embeddings.push(await embedTurn(embModel, embProcessor, input));
  }
  console.log(`[diarise v2] embeddings done in ${Date.now() - tEmb} ms`);

  // ----- Cluster -----
  console.log('\n[diarise v2] clustering...');
  let labels = clusterTurns(longEnough, embeddings, CLUSTER_THRESHOLD);
  console.log(`[diarise v2] initial cluster count: ${new Set(labels).size}`);

  // ----- Reassign noise clusters to the nearest substantial cluster -----
  // After agglomerative clustering, some short turns end up in tiny clusters
  // (1-3 turns, < 1% of audio). Their embeddings were unreliable. Move them
  // to the temporally-nearest substantial cluster instead.
  const NOISE_MIN_TOTAL_SECONDS = 3.0;
  const clusterDuration = new Map();
  for (let i = 0; i < longEnough.length; i++) {
    const dur = longEnough[i].end - longEnough[i].start;
    clusterDuration.set(labels[i], (clusterDuration.get(labels[i]) || 0) + dur);
  }
  const substantialClusters = new Set(
    Array.from(clusterDuration.entries())
      .filter(([_, total]) => total >= NOISE_MIN_TOTAL_SECONDS)
      .map(([cluster, _]) => cluster)
  );
  console.log(`[diarise v2] substantial clusters: ${substantialClusters.size}`);

  // Reassign each turn in a noise cluster to the nearest substantial cluster
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

  // Renumber clusters from 0 contiguously after the noise pass
  const oldToNew = new Map();
  let nextId = 0;
  const renumbered = labels.map((l) => {
    if (!oldToNew.has(l)) {
      oldToNew.set(l, nextId++);
    }
    return oldToNew.get(l);
  });
  labels = renumbered;
  const speakerCount = new Set(labels).size;
  console.log(`[diarise v2] final speaker count: ${speakerCount}`);

  // Build the final assignment for the long-enough turns
  const finalTurns = longEnough.map((t, i) => ({
    start: t.start,
    end: t.end,
    speaker: labels[i],
  }));

  // ----- Assign dropped short turns to nearest neighbour -----
  for (const shortTurn of tooShort) {
    const mid = (shortTurn.start + shortTurn.end) / 2;
    let bestDist = Infinity;
    let bestSpeaker = 0;
    for (const t of finalTurns) {
      const tMid = (t.start + t.end) / 2;
      const dist = Math.abs(mid - tMid);
      if (dist < bestDist) {
        bestDist = dist;
        bestSpeaker = t.speaker;
      }
    }
    finalTurns.push({ start: shortTurn.start, end: shortTurn.end, speaker: bestSpeaker });
  }
  finalTurns.sort((a, b) => a.start - b.start);

  // Print speaker histogram
  console.log('\n========== SPEAKER SUMMARY ==========');
  const speakerSeconds = new Map();
  const speakerTurnCount = new Map();
  for (const t of finalTurns) {
    speakerSeconds.set(t.speaker, (speakerSeconds.get(t.speaker) || 0) + (t.end - t.start));
    speakerTurnCount.set(t.speaker, (speakerTurnCount.get(t.speaker) || 0) + 1);
  }
  const sortedSpeakers = Array.from(speakerSeconds.keys()).sort((a, b) => speakerSeconds.get(b) - speakerSeconds.get(a));
  for (const s of sortedSpeakers) {
    const seconds = speakerSeconds.get(s);
    const pct = (seconds / audioSeconds * 100).toFixed(1);
    const count = speakerTurnCount.get(s);
    console.log(`  Speaker ${s}: ${seconds.toFixed(1)}s in ${count} turns (${pct}% of audio)`);
  }
  console.log('======================================\n');

  // Print first 30 turns
  console.log('First 30 turns:');
  for (const t of finalTurns.slice(0, 30)) {
    console.log(`  [${t.start.toFixed(2)}s → ${t.end.toFixed(2)}s] Speaker ${t.speaker}`);
  }
  if (finalTurns.length > 30) {
    console.log(`  ... ${finalTurns.length - 30} more turns`);
  }
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
