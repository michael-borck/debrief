// Thin HTTP client for the embedded speech-analyser sidecar.
// Initialised by electron.js with a reference to the SidecarManager so we
// always know the live port and can fail fast when the sidecar isn't ready.

const fs = require('node:fs');
const path = require('node:path');
const { Agent } = require('undici');

// Long-running localhost dispatcher. Node's undici has a default 5-minute
// headers timeout — a queued /analyse behind another in-flight request can
// blow past that without ever seeing a response byte and surface as
// HeadersTimeoutError. Sidecar is local and we trust it to either finish
// or crash visibly, so we disable both timeouts here.
const localhostAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connectTimeout: 30_000,
});

let sidecar = null;

function init(opts) {
  sidecar = opts.sidecar;
}

function ensureReady() {
  if (!sidecar) throw new Error('Sidecar client not initialised');
  if (sidecar.state !== 'ready') {
    const reason = sidecar.lastError || `state=${sidecar.state}; wait for first-launch setup to complete`;
    throw new Error(`Sidecar not ready (${reason})`);
  }
}

function baseUrl() {
  return `http://127.0.0.1:${sidecar.port}`;
}

// Per-launch Bearer token the sidecar requires on every request (see
// SidecarManager.token). Read live so it tracks the current manager instance.
function authHeader() {
  return { Authorization: `Bearer ${sidecar.token}` };
}

// POST the audio file to the sidecar's analyse endpoint.
//
// Prefers Debrief's own /analyse-v2 (server.py): word-level timestamps with
// per-word speaker attribution, plus the diarizer's RAW turns, which the
// upstream /analyse computes and then discards. Falls back to upstream
// /analyse ({ transcript, language, duration, segments[], speakers[], … })
// when talking to an older sidecar build, or when v2 declares itself
// unavailable (501: upstream private-API drift). Both shapes feed
// segmentsToChunkTimings; v2 additionally carries `words` and `turns`.
async function analyse({ audioPath, diarize = true, model = 'base' }) {
  ensureReady();
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const fileBuffer = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);
  const makeForm = () => {
    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('diarize', diarize ? 'true' : 'false');
    if (model) form.append('model', model);
    return form;
  };
  const post = (route) =>
    fetch(`${baseUrl()}${route}`, {
      method: 'POST',
      headers: authHeader(),
      body: makeForm(),
      dispatcher: localhostAgent,
    });

  let res = await post('/analyse-v2');
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    res = await post('/analyse');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`analyse returned ${res.status}: ${body || res.statusText}`);
  }
  return await res.json();
}

// POST /rediarise — debrief-specific diarisation-only endpoint. Skips
// transcription (returns just speaker turns) and honours the num_speakers
// hint from the per-transcript slider.
async function rediarise({ audioPath, numSpeakers = null }) {
  ensureReady();
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }
  const fileBuffer = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), filename);
  if (numSpeakers != null) form.append('num_speakers', String(numSpeakers));
  const res = await fetch(`${baseUrl()}/rediarise`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
    dispatcher: localhostAgent,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/rediarise returned ${res.status}: ${body || res.statusText}`);
  }
  return await res.json();
}

// POST /embed for batch sentence embeddings. Returns 384-dim L2-normalised
// vectors via all-MiniLM-L6-v2. First call per sidecar lifetime pays the
// ~80MB model-load cost (~2-3s on Apple Silicon); subsequent calls are
// effectively instant.
async function embed(texts, { normalize = true } = {}) {
  ensureReady();
  if (!Array.isArray(texts)) {
    throw new Error('embed() expects an array of strings');
  }
  if (texts.length === 0) {
    return { embeddings: [], model: '', dim: 0 };
  }
  const res = await fetch(`${baseUrl()}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ texts, normalize }),
    dispatcher: localhostAgent,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/embed returned ${res.status}: ${body || res.statusText}`);
  }
  return await res.json();
}

// Map speech-analyser segments to the ChunkTimingInfo shape the renderer
// expects (sentenceSegmentsService.createSegmentsFromChunks consumes this).
// `words`/`avgLogprob` are present only from /analyse-v2; they pass through
// untouched so segment construction can use exact word times when available
// and interpolate otherwise.
function segmentsToChunkTimings(segments) {
  return (segments || []).map((s, i) => ({
    chunkIndex: i,
    startTime: s.start ?? 0,
    endTime: s.end ?? 0,
    duration: Math.max(0, (s.end ?? 0) - (s.start ?? 0)),
    text: (s.text || '').trim(),
    speaker: s.speaker || undefined,
    avgLogprob: typeof s.avg_logprob === 'number' ? s.avg_logprob : undefined,
    words: Array.isArray(s.words) && s.words.length > 0 ? s.words : undefined,
  }));
}

// The speaker turns to persist for a result. /analyse-v2 returns pyannote's
// raw turns — always prefer those. The legacy path derives turns by
// collapsing Whisper segments, which quantizes boundaries to segment edges;
// such turns are labelled 'segment-derived' so downstream consumers know
// their precision (they were previously stored as if they were the real
// thing).
function resultToSpeakerTurns(result) {
  if (result?.turns?.length > 0) {
    const raw = result.turns;
    return raw
      .filter((t) => t?.speaker && Number.isFinite(t.start) && Number.isFinite(t.end))
      .map((t) => ({
        start: t.start,
        end: t.end,
        speaker: t.speaker,
        speakerId: t.speaker,
        source: 'pyannote',
      }));
  }
  return segmentsToSpeakerTurns(result?.segments);
}

// Collapse consecutive same-speaker segments into speaker turns. Threshold
// of 1.0s of silence between segments before we split into a new turn.
// Fallback only — see resultToSpeakerTurns.
function segmentsToSpeakerTurns(segments) {
  const turns = [];
  for (const seg of segments || []) {
    if (!seg.speaker) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === seg.speaker && seg.start - last.end < 1.0) {
      last.end = seg.end;
    } else {
      turns.push({
        start: seg.start,
        end: seg.end,
        speaker: seg.speaker,
        speakerId: seg.speaker,
        source: 'segment-derived',
      });
    }
  }
  return turns;
}

module.exports = {
  init,
  analyse,
  rediarise,
  embed,
  segmentsToChunkTimings,
  segmentsToSpeakerTurns,
  resultToSpeakerTurns,
};
