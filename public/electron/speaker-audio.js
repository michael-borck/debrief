// Per-speaker audio extraction, driven by persisted diarization turns.
//
// WHY TURNS, NOT SEGMENTS
// transcript_segments sentence timings are interpolated — electron.js distributes
// each Whisper chunk's duration across its sentences by word count. Cutting on
// them clips mid-word and drifts audibly over a long file. diarization_turns are
// the diarizer's actual boundaries, so cuts land where the speaker actually
// stopped. See db-rpc/diarizationTurns.js.
//
// SECURITY POSTURE
// The IPC layer resolves everything from our own database: the input audio comes
// from transcripts.file_path and the output path comes from a save dialog shown
// by the main process. The renderer supplies only a transcript id and a speaker
// name — never a path. This is the same lesson as fs-get-file-stats and
// backup-database: renderer-supplied paths are an attack surface.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Turns per ffmpeg pass. The whole filter graph travels as ONE argv element, and
// Windows' CreateProcess limit is 32k characters for the entire command line —
// so this is capped well below that (~200 x ~60 chars ≈ 12k) rather than tuned to
// macOS's far larger limit. Batches are joined with the concat demuxer.
const MAX_TURNS_PER_PASS = 200;

// Breathing room at each turn boundary so the first/last phoneme is not clipped.
// pyannote boundaries are good but not sample-exact.
const DEFAULT_PADDING_SEC = 0.15;

/** Clamp a turn to the file, apply padding, and drop anything degenerate. */
function prepareTurns(turns, durationSec, paddingSec) {
  // A missing probe (null/undefined) means the duration is unknown and only the
  // start can be clamped. A duration of 0 is a real answer — an unreadable or
  // empty file — and must clamp everything away, not be mistaken for "unknown".
  const knownDuration =
    typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec >= 0;

  const usable = [];
  for (const turn of turns) {
    const start = Math.max(0, Number(turn.start) - paddingSec);
    const end = knownDuration
      ? Math.min(Number(turn.end) + paddingSec, durationSec)
      : Number(turn.end) + paddingSec;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      usable.push({ start, end });
    }
  }
  return usable;
}

/**
 * Build the filter_complex graph for one pass of at most MAX_TURNS_PER_PASS turns.
 *
 * Each turn is trimmed from input 0 and its timestamps reset, then all trims are
 * concatenated into a single audio stream. Kept as a pure function so the graph
 * can be asserted on without running ffmpeg.
 */
function buildFilterGraph(turns) {
  if (turns.length === 0) throw new Error('no usable turns');
  if (turns.length > MAX_TURNS_PER_PASS) {
    throw new Error(`pass too large: ${turns.length} > ${MAX_TURNS_PER_PASS}`);
  }

  const parts = [];
  const labels = [];
  turns.forEach((turn, i) => {
    const label = `a${i}`;
    parts.push(
      `[0:a]atrim=start=${turn.start.toFixed(3)}:end=${turn.end.toFixed(3)},` +
        `asetpts=PTS-STARTPTS[${label}]`
    );
    labels.push(`[${label}]`);
  });

  parts.push(
    `${labels.join('')}concat=n=${turns.length}:v=0:a=1[out]`
  );

  return { filterComplex: parts.join(';'), outputLabel: '[out]' };
}

/** Split turns into ffmpeg-sized passes. */
function batch(turns) {
  const out = [];
  for (let i = 0; i < turns.length; i += MAX_TURNS_PER_PASS) {
    out.push(turns.slice(i, i + MAX_TURNS_PER_PASS));
  }
  return out;
}

function makeSpeakerAudio({
  getDb,
  ffmpegPath,
  runFfmpeg, // (args: string[]) => Promise<void>, injected for tests
  getMediaDuration, // (path: string) => Promise<number | null>
  showSaveDialog, // (defaultName: string) => Promise<string | null>
  tmpDir = os.tmpdir(),
}) {
  /** Resolve the transcript row; throws when the audio is gone. */
  function loadTranscript(transcriptId) {
    if (typeof transcriptId !== 'string' || transcriptId.length === 0) {
      throw new Error('invalid transcript id');
    }
    const row = getDb()
      .prepare('SELECT id, title, file_path FROM transcripts WHERE id = ?')
      .get(transcriptId);
    if (!row) throw new Error('transcript not found');
    if (!row.file_path || !fs.existsSync(row.file_path)) {
      throw new Error(
        'The original audio file for this transcript could not be found on disk. ' +
          'It may have been moved or deleted.'
      );
    }
    return row;
  }

  return {
    MAX_TURNS_PER_PASS,
    DEFAULT_PADDING_SEC,

    /**
     * What can be exported right now, so the UI can enable/disable per speaker
     * and explain why. Cheap: one indexed query.
     */
    speakers(transcriptId) {
      const turnsBySpeaker = this.turnsBySpeaker(transcriptId);
      return Object.entries(turnsBySpeaker).map(([speaker, turns]) => ({
        speaker,
        turns: turns.length,
        seconds: Math.round(turns.reduce((sum, t) => sum + (t.end - t.start), 0)),
      }));
    },

    turnsBySpeaker(transcriptId) {
      const rows = getDb()
        .prepare(
          `SELECT speaker, start_time, end_time FROM diarization_turns
           WHERE transcript_id = ? ORDER BY turn_index`
        )
        .all(transcriptId);
      const bySpeaker = new Map();
      for (const row of rows) {
        const bucket = bySpeaker.get(row.speaker);
        const range = { start: row.start_time, end: row.end_time };
        if (bucket) bucket.push(range);
        else bySpeaker.set(row.speaker, [range]);
      }
      return Object.fromEntries(bySpeaker);
    },

    /**
     * Ask the user where to put the clip (dialog in MAIN, never a renderer path),
     * then extract.
     */
    async exportSpeaker({ transcriptId, speaker }) {
      // Trim before validating: a whitespace-only name would pass a length check
      // and then be looked up as if it were real.
      const cleanSpeaker = typeof speaker === 'string' ? speaker.trim() : '';
      if (!cleanSpeaker) {
        throw new Error('invalid speaker');
      }

      const transcript = loadTranscript(transcriptId);
      const turnsBySpeaker = this.turnsBySpeaker(transcriptId);
      const turns = turnsBySpeaker[cleanSpeaker];
      if (!Array.isArray(turns) || turns.length === 0) {
        throw new Error(
          `No diarization turns stored for "${cleanSpeaker}". Re-run diarisation on this ` +
            'transcript first (older imports did not keep turns).'
        );
      }

      // Sanitised file name; the dialog adds the extension if the user omits it.
      const safeName = `${transcript.title || 'transcript'} - ${speaker}`
        .replace(/[/\\:*?"<>|]/g, '_')
        .slice(0, 120);
      const target = await showSaveDialog(safeName);
      if (!target) return { cancelled: true };

      const duration = await getMediaDuration(transcript.file_path);
      const usable = prepareTurns(turns, duration, DEFAULT_PADDING_SEC);
      if (usable.length === 0) {
        throw new Error('No usable turns after clamping to the audio duration.');
      }

      const outPath = String(target);
      const workDir = fs.mkdtempSync(path.join(tmpDir, 'debrief-clip-'));

      try {
        const batches = batch(usable);

        if (batches.length === 1) {
          const { filterComplex, outputLabel } = buildFilterGraph(batches[0]);
          await runFfmpeg([
            '-y', '-i', transcript.file_path,
            '-filter_complex', filterComplex,
            '-map', outputLabel,
            outPath,
          ]);
        } else {
          // Extract each pass to the work dir, then join with the concat
          // demuxer, which is a plain copy for identical codecs.
          const batchFiles = [];
          for (let i = 0; i < batches.length; i++) {
            const part = path.join(workDir, `part_${i}.wav`);
            const { filterComplex, outputLabel } = buildFilterGraph(batches[i]);
            await runFfmpeg([
              '-y', '-i', transcript.file_path,
              '-filter_complex', filterComplex,
              '-map', outputLabel,
              part,
            ]);
            batchFiles.push(part);
          }

          const listFile = path.join(workDir, 'concat.txt');
          // The concat demuxer treats the list as trusted input, so quote every
          // path — a temp dir under the user's name could contain a quote.
          fs.writeFileSync(
            listFile,
            batchFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
          );
          await runFfmpeg([
            '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
            '-c', 'copy', outPath,
          ]);
        }

        return {
          cancelled: false,
          path: outPath,
          turns: usable.length,
          speaker,
        };
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    },

    // Exposed for tests.
    prepareTurns,
    buildFilterGraph,
    batch,
  };
}

module.exports = { makeSpeakerAudio, prepareTurns, buildFilterGraph, batch, MAX_TURNS_PER_PASS };