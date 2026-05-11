// Thin HTTP client for the embedded speech-analyser sidecar.
// Initialised by electron.js with a reference to the SidecarManager so we
// always know the live port and can fail fast when the sidecar isn't ready.

const fs = require('fs');
const path = require('path');
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

// POST /analyse with the audio file. Returns the parsed JSON response from
// speech-analyser: { transcript, language, duration, segments[], speakers[],
// talk_time, speech_metrics, diarization_available, file_path, file_size }.
async function analyse({ audioPath, diarize = true, model = 'base' }) {
  ensureReady();
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const fileBuffer = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);

  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), filename);
  form.append('diarize', diarize ? 'true' : 'false');
  if (model) form.append('model', model);

  const res = await fetch(`${baseUrl()}/analyse`, {
    method: 'POST',
    body: form,
    dispatcher: localhostAgent,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/analyse returned ${res.status}: ${body || res.statusText}`);
  }
  return await res.json();
}

// Map speech-analyser segments to the ChunkTimingInfo shape the renderer
// expects (sentenceSegmentsService.createSegmentsFromChunks consumes this).
function segmentsToChunkTimings(segments) {
  return (segments || []).map((s, i) => ({
    chunkIndex: i,
    startTime: s.start ?? 0,
    endTime: s.end ?? 0,
    duration: Math.max(0, (s.end ?? 0) - (s.start ?? 0)),
    text: (s.text || '').trim(),
    speaker: s.speaker || undefined,
  }));
}

// Collapse consecutive same-speaker segments into speaker turns. Threshold
// of 1.0s of silence between segments before we split into a new turn.
function segmentsToSpeakerTurns(segments) {
  const turns = [];
  for (const seg of segments || []) {
    if (!seg.speaker) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === seg.speaker && seg.start - last.end < 1.0) {
      last.end = seg.end;
    } else {
      turns.push({ start: seg.start, end: seg.end, speaker: seg.speaker });
    }
  }
  return turns;
}

module.exports = {
  init,
  analyse,
  segmentsToChunkTimings,
  segmentsToSpeakerTurns,
};
