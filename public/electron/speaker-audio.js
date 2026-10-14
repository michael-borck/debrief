// Per-speaker audio extraction, driven by persisted diarization turns.
//
// WHY TURNS, NOT SEGMENTS
// transcript_segments sentence timings were interpolated historically
// (word-aligned since schema v3 where available) — cutting on interpolated
// times clips mid-word and drifts audibly over a long file.
// diarization_turns are the diarizer's actual boundaries, so cuts land where
// the speaker actually stopped. See db-rpc/diarizationTurns.js.
//
// SPEAKER IDENTITY
// diarization_turns.speaker is the DISPLAY name and follows renames (see
// diarizationTurns.rename). Rows stored before renames reached the turns
// table may still hold a raw cluster id, so reads here heal: the transcript's
// `speakers` rename map (cluster id -> display name) is applied over both
// `speaker` and `speaker_id`, and clusters that resolve to one display name
// (a user merge) are combined into a single clip. Text and audio therefore
// always agree on who "Alice" is.
//
// SECURITY POSTURE
// The IPC layer resolves everything from our own database: the input audio
// comes from transcripts.file_path and the output location from a dialog
// shown by the main process. The renderer supplies only a transcript id and
// a speaker name — never a path.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Turns per ffmpeg pass. The whole filter graph travels as ONE argv element,
// and Windows' CreateProcess limit is 32k characters for the entire command
// line — so this is capped well below that rather than tuned to macOS's far
// larger limit. Batches are joined with the concat demuxer.
const MAX_TURNS_PER_PASS = 200;

// Breathing room at each turn boundary so the first/last phoneme is not
// clipped. pyannote boundaries are good but not sample-exact.
const DEFAULT_PADDING_SEC = 0.15;

// Turns separated by less than this after padding are merged into one cut:
// the gap is breath/pause within one utterance more often than a real
// interjection, and merging both sounds natural and avoids doubled
// audio where padded neighbours would overlap.
const MERGE_GAP_SEC = 0.3;

// Click suppression at every cut point.
const FADE_SEC = 0.01;

/** Clamp turns to the file, apply padding, sort, and merge close turns. */
function prepareTurns(turns, durationSec, paddingSec) {
  // A missing probe (null/undefined) means the duration is unknown and only
  // the start can be clamped. A duration of 0 is a real answer — an
  // unreadable or empty file — and must clamp everything away, not be
  // mistaken for "unknown".
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
  usable.sort((a, b) => a.start - b.start || a.end - b.end);

  // Merge overlaps and sub-MERGE_GAP gaps. Merged-away turns (a user merge
  // of two clusters, or padded neighbours) would otherwise be cut twice.
  const merged = [];
  for (const turn of usable) {
    const last = merged[merged.length - 1];
    if (last && turn.start - last.end <= MERGE_GAP_SEC) {
      last.end = Math.max(last.end, turn.end);
    } else {
      merged.push({ ...turn });
    }
  }
  return merged;
}

/**
 * Build the filter_complex graph for one pass of at most MAX_TURNS_PER_PASS
 * turns. Each turn is trimmed, timestamp-reset and micro-faded, then all
 * trims are concatenated. Pure, so the graph can be asserted on without
 * running ffmpeg.
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
    const duration = turn.end - turn.start;
    const fades =
      duration > FADE_SEC * 4
        ? `,afade=t=in:st=0:d=${FADE_SEC},afade=t=out:st=${(duration - FADE_SEC).toFixed(3)}:d=${FADE_SEC}`
        : '';
    parts.push(
      `[0:a]atrim=start=${turn.start.toFixed(3)}:end=${turn.end.toFixed(3)},` +
        `asetpts=PTS-STARTPTS${fades}[${label}]`
    );
    labels.push(`[${label}]`);
  });

  parts.push(`${labels.join('')}concat=n=${turns.length}:v=0:a=1[out]`);

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

/** ffmpeg audio codec matching the chosen output container. */
function codecForPath(outPath) {
  return path.extname(String(outPath)).toLowerCase() === '.m4a' ? 'aac' : 'pcm_s16le';
}

function formatSrtTime(seconds) {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(clamped * 1000);
  const pad = (n, w = 2) => n.toString().padStart(w, '0');
  return (
    `${pad(Math.floor(totalMs / 3_600_000))}:${pad(Math.floor((totalMs % 3_600_000) / 60_000))}:` +
    `${pad(Math.floor((totalMs % 60_000) / 1000))},${pad(totalMs % 1000, 3)}`
  );
}

function formatClock(seconds) {
  const clamped = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n) => n.toString().padStart(2, '0');
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function makeSpeakerAudio({
  getDb,
  ffmpegPath,
  runFfmpeg, // (args: string[]) => Promise<void>, injected for tests
  getMediaDuration, // (path: string) => Promise<number | null>
  showSaveDialog, // (defaultName: string) => Promise<string | null>
  showFolderDialog = null, // () => Promise<string | null>, for export-all
  tmpDir = os.tmpdir(),
}) {
  /** Resolve the transcript row; throws when the audio is gone. */
  function loadTranscript(transcriptId) {
    if (typeof transcriptId !== 'string' || transcriptId.length === 0) {
      throw new Error('invalid transcript id');
    }
    const row = getDb()
      .prepare('SELECT id, title, file_path, speakers FROM transcripts WHERE id = ?')
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

  /** cluster id -> display name, from transcripts.speakers (renames only). */
  function renameMapFor(transcriptId) {
    const map = new Map();
    try {
      const row = getDb()
        .prepare('SELECT speakers FROM transcripts WHERE id = ?')
        .get(transcriptId);
      const raw = row?.speakers;
      const speakers = typeof raw === 'string' ? JSON.parse(raw) : raw;
      for (const s of Array.isArray(speakers) ? speakers : []) {
        if (s?.id && s?.name && s.id !== s.name) map.set(String(s.id), String(s.name));
      }
    } catch {
      // A corrupt speakers blob must not sink audio export; raw labels are
      // still better than failure.
    }
    return map;
  }

  /** Display name for a turn row, healing pre-rename rows via the map. */
  function displayName(row, renames) {
    return (
      (row.speaker_id && renames.get(row.speaker_id)) ||
      renames.get(row.speaker) ||
      row.speaker
    );
  }

  /** Sentence segments for the sidecar transcript (one version, resolved). */
  function segmentsForSpeaker(transcriptId, displaySpeaker, renames) {
    for (const version of ['speaker_tagged', 'original', 'corrected']) {
      let rows = [];
      try {
        rows = getDb()
          .prepare(
            `SELECT text, start_time, end_time, speaker FROM transcript_segments
             WHERE transcript_id = ? AND version = ? ORDER BY sentence_index`
          )
          .all(transcriptId, version);
      } catch {
        return [];
      }
      if (!rows.length) continue;
      const mine = rows.filter((r) => {
        const name = (r.speaker && renames.get(r.speaker)) || r.speaker;
        return name === displaySpeaker && r.text && r.text.trim().length > 0;
      });
      if (mine.length) return mine;
      // Keep looking in earlier versions only if this one has NO speaker
      // data at all; if it has speakers but not ours, it is authoritative.
      if (rows.some((r) => r.speaker)) return [];
    }
    return [];
  }

  /** Write `<base>.txt` + `<base>.srt` next to the clip. Best-effort. */
  function writeSidecars(outPath, transcript, displaySpeaker, segments) {
    if (!segments.length) return null;
    const base = String(outPath).replace(/\.[^.]+$/, '');
    try {
      const txt =
        `Transcript: ${transcript.title || transcript.id}\nSpeaker: ${displaySpeaker}\n\n` +
        segments
          .map((s) => `[${formatClock(s.start_time ?? 0)}] ${s.text.trim()}`)
          .join('\n') +
        '\n';
      fs.writeFileSync(`${base}.txt`, txt);
      const srt =
        segments
          .filter((s) => typeof s.start_time === 'number' && typeof s.end_time === 'number')
          .map(
            (s, i) =>
              `${i + 1}\n${formatSrtTime(s.start_time)} --> ${formatSrtTime(s.end_time)}\n${displaySpeaker}: ${s.text.trim()}`
          )
          .join('\n\n') + '\n';
      fs.writeFileSync(`${base}.srt`, srt);
      return `${base}.txt`;
    } catch {
      return null;
    }
  }

  /** Cut `turns` of `transcript` into `outPath`. Returns usable turn count. */
  async function extractTo(transcript, turns, outPath) {
    const duration = await getMediaDuration(transcript.file_path);
    const usable = prepareTurns(turns, duration, DEFAULT_PADDING_SEC);
    if (usable.length === 0) {
      throw new Error('No usable turns after clamping to the audio duration.');
    }
    const workDir = fs.mkdtempSync(path.join(tmpDir, 'debrief-clip-'));
    try {
      const batches = batch(usable);
      const codec = codecForPath(outPath);
      if (batches.length === 1) {
        const { filterComplex, outputLabel } = buildFilterGraph(batches[0]);
        await runFfmpeg([
          '-y', '-i', transcript.file_path,
          '-filter_complex', filterComplex,
          '-map', outputLabel,
          '-c:a', codec,
          outPath,
        ]);
      } else {
        // Extract each pass to the work dir, then join with the concat
        // demuxer. The join is a plain copy only when the target container
        // matches the .wav parts; for .m4a it must re-encode, or the file
        // is WAV-in-M4A and players reject it.
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
        fs.writeFileSync(
          listFile,
          batchFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
        );
        const isWavTarget =
          path.extname(String(outPath)).toLowerCase() === '.wav' || codec === 'pcm_s16le';
        await runFfmpeg(
          isWavTarget
            ? ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath]
            : ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', codec, outPath]
        );
      }
      return usable.length;
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  function safeBaseName(transcript, speaker) {
    return `${transcript.title || 'transcript'} - ${speaker}`
      .replace(/[/\\:*?"<>|]/g, '_')
      .slice(0, 120);
  }

  return {
    MAX_TURNS_PER_PASS,
    DEFAULT_PADDING_SEC,
    MERGE_GAP_SEC,

    /**
     * What can be exported right now, so the UI can enable/disable per
     * speaker and explain why. Grouped by DISPLAY name.
     */
    speakers(transcriptId) {
      const turnsBySpeaker = this.turnsBySpeaker(transcriptId);
      return Object.entries(turnsBySpeaker).map(([speaker, turns]) => ({
        speaker,
        turns: turns.length,
        seconds: Math.round(turns.reduce((sum, t) => sum + (t.end - t.start), 0)),
      }));
    },

    /** Turns grouped by resolved display name, each group time-ordered. */
    turnsBySpeaker(transcriptId) {
      const renames = renameMapFor(transcriptId);
      const rows = getDb()
        .prepare(
          `SELECT speaker, speaker_id, start_time, end_time FROM diarization_turns
           WHERE transcript_id = ? ORDER BY turn_index`
        )
        .all(transcriptId);
      const bySpeaker = new Map();
      for (const row of rows) {
        const name = displayName(row, renames);
        const bucket = bySpeaker.get(name);
        const range = { start: row.start_time, end: row.end_time };
        if (bucket) bucket.push(range);
        else bySpeaker.set(name, [range]);
      }
      for (const ranges of bySpeaker.values()) ranges.sort((a, b) => a.start - b.start);
      return Object.fromEntries(bySpeaker);
    },

    /**
     * Ask the user where to put the clip (dialog in MAIN, never a renderer
     * path), extract it, and write the matching transcript beside it.
     */
    async exportSpeaker({ transcriptId, speaker }) {
      const cleanSpeaker = typeof speaker === 'string' ? speaker.trim() : '';
      if (!cleanSpeaker) throw new Error('invalid speaker');

      const transcript = loadTranscript(transcriptId);
      const turnsBySpeaker = this.turnsBySpeaker(transcriptId);
      const turns = turnsBySpeaker[cleanSpeaker];
      if (!Array.isArray(turns) || turns.length === 0) {
        throw new Error(
          `No diarization turns stored for "${cleanSpeaker}". Re-run diarisation on this ` +
            'transcript first (older imports did not keep turns).'
        );
      }

      const target = await showSaveDialog(safeBaseName(transcript, cleanSpeaker));
      if (!target) return { cancelled: true };

      const outPath = String(target);
      const count = await extractTo(transcript, turns, outPath);
      const renames = renameMapFor(transcriptId);
      const transcriptPath = writeSidecars(
        outPath,
        transcript,
        cleanSpeaker,
        segmentsForSpeaker(transcriptId, cleanSpeaker, renames)
      );
      return { cancelled: false, path: outPath, transcriptPath, turns: count, speaker };
    },

    /**
     * Export every speaker (audio + sidecar transcript) into one folder
     * chosen via a main-process dialog. One speaker failing does not abort
     * the rest; failures are reported per speaker.
     */
    async exportAllSpeakers({ transcriptId }) {
      if (typeof showFolderDialog !== 'function') {
        throw new Error('export-all is not available in this build');
      }
      const transcript = loadTranscript(transcriptId);
      const turnsBySpeaker = this.turnsBySpeaker(transcriptId);
      const names = Object.keys(turnsBySpeaker);
      if (names.length === 0) {
        throw new Error(
          'No diarization turns stored for this transcript. ' +
            'Re-run diarisation first (older imports did not keep turns).'
        );
      }
      const folder = await showFolderDialog();
      if (!folder) return { cancelled: true };

      const renames = renameMapFor(transcriptId);
      const results = [];
      for (const name of names) {
        const outPath = path.join(String(folder), `${safeBaseName(transcript, name)}.wav`);
        try {
          const count = await extractTo(transcript, turnsBySpeaker[name], outPath);
          const transcriptPath = writeSidecars(
            outPath,
            transcript,
            name,
            segmentsForSpeaker(transcriptId, name, renames)
          );
          results.push({ speaker: name, path: outPath, transcriptPath, turns: count });
        } catch (error) {
          results.push({ speaker: name, error: error.message });
        }
      }
      return { cancelled: false, folder: String(folder), results };
    },

    // Exposed for tests.
    prepareTurns,
    buildFilterGraph,
    batch,
    codecForPath,
  };
}

module.exports = {
  makeSpeakerAudio,
  prepareTurns,
  buildFilterGraph,
  batch,
  codecForPath,
  MAX_TURNS_PER_PASS,
  MERGE_GAP_SEC,
};
