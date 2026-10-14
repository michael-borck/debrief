// Timestamped transcript exporters.
//
// WHY THIS EXISTS
// No export path read transcript_segments before, which meant NO export format
// carried timestamps — even though the data was in the database all along. It also
// means this is the first place the precision of those timestamps becomes
// user-visible, so it is the place that has to be honest about it.
//
// TWO KINDS OF TIME
//   - turn timestamps come from diarization_turns and are the diarizer's real
//     boundaries.
//   - sentence timestamps in transcript_segments are INTERPOLATED: electron.js
//     distributes each Whisper chunk's duration across its sentences by word
//     count. They are a reasonable guess, not a measurement.
//
// Every consumer states which it is using. An SRT built from interpolated
// sentence times is fine for reading along; it would be wrong to hand someone the
// same numbers as caption cues without telling them.

import type { SentenceSegment } from '../types';

export type TimePrecision = 'turn' | 'word' | 'interpolated';

export interface TimedLine {
  speaker?: string | null;
  text: string;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  precision: TimePrecision;
}

/** 1.234 -> "00:00:01,234" (SRT) or "00:00:01.234" (VTT). */
export function formatTimestamp(seconds: number, style: 'srt' | 'vtt'): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(clamped * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  const sep = style === 'srt' ? ',' : '.';
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

/** Seconds -> "1:23" (or "1:02:03" past an hour), for compact human reading. */
export function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Select segments for export.
 *
 * `speaker` filters to one speaker's lines. Blank/unknown text is dropped — a
 * segment with no content has nothing to say in any format.
 */
export function selectSegments(
  segments: Array<SentenceSegment | null | undefined> | null | undefined,
  speaker?: string | null
): SentenceSegment[] {
  const rows = segments ?? [];
  const want = speaker?.trim();
  return rows.filter(
    (segment): segment is SentenceSegment =>
      !!segment &&
      typeof segment.text === 'string' &&
      segment.text.trim().length > 0 &&
      (!want || segment.speaker === want)
  );
}

/**
 * Map stored segments to timed lines.
 *
 * Segments without timings (legacy rows can have null times) are skipped rather
 * than emitted at 00:00:00 — a wall of cues all stamped at zero is worse than a
 * shorter, honest file.
 */
export function toTimedLines(
  segments: SentenceSegment[],
  precision: TimePrecision
): TimedLine[] {
  const lines: TimedLine[] = [];
  for (const segment of segments) {
    const start = segment.start_time;
    const end = segment.end_time;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start)) {
      continue;
    }
    lines.push({
      speaker: segment.speaker ?? null,
      text: segment.text.trim(),
      start,
      end: typeof end === 'number' && end > start ? end : start,
      precision,
    });
  }
  return lines;
}

// --- Subtitle formats -------------------------------------------------------

/** WebVTT. Native format for HTML5 <track>; also accepted by most editors. */
export function toVtt(lines: TimedLine[]): string {
  const body = lines
    .map(
      (line, i) =>
        `${i + 1}\n` +
        `${formatTimestamp(line.start, 'vtt')} --> ${formatTimestamp(line.end, 'vtt')}\n` +
        (line.speaker ? `<v ${escapeVtt(line.speaker)}>${escapeVtt(line.text)}` : escapeVtt(line.text))
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** SubRip. The most widely recognised subtitle format. */
export function toSrt(lines: TimedLine[]): string {
  return (
    lines
      .map(
        (line, i) =>
          `${i + 1}\n` +
          `${formatTimestamp(line.start, 'srt')} --> ${formatTimestamp(line.end, 'srt')}\n` +
          (line.speaker ? `${line.speaker}: ${line.text}` : line.text)
      )
      .join('\n\n') + '\n'
  );
}

function escapeVtt(text: string): string {
  // Strip markup characters that a cue would interpret. Newlines inside a cue
  // are legal but would break the speaker prefix visually, so flatten them.
  return text.replace(/<[^>]*>/g, '').replace(/\s*\n\s*/g, ' ');
}

// --- Plain-text formats -----------------------------------------------------

/**
 * Readable speaker transcript with per-line timestamps.
 *
 * Groups consecutive lines by speaker so a monologue does not repeat the name on
 * every sentence; each group is stamped with its first line's start.
 */
export function toSpeakerText(lines: TimedLine[]): string {
  const blocks: string[] = [];
  let current: { speaker: string; start: number; parts: string[] } | null = null;

  const flush = () => {
    if (current) {
      blocks.push(`[${formatClock(current.start)}] ${current.speaker}:\n${current.parts.join(' ')}`);
      current = null;
    }
  };

  for (const line of lines) {
    const speaker = line.speaker?.trim() || 'Unknown';
    if (current && current.speaker === speaker) {
      current.parts.push(line.text);
    } else {
      flush();
      current = { speaker, start: line.start, parts: [line.text] };
    }
  }
  flush();

  return blocks.join('\n\n');
}

const PRECISION_NOTE: Record<TimePrecision, string> = {
  turn: 'Timestamps come from speaker diarization turns.',
  word:
    'Timestamps come from word-level alignment of the transcription, ' +
    'so sentence boundaries land on actual speech.',
  interpolated:
    'Timestamps are estimates: sentence positions are distributed within each ' +
    'transcribed chunk by word count, so they can drift by a second or two.',
};

/**
 * The header every timestamped export carries.
 *
 * Shipping interpolated timings unlabelled would invite someone to cut audio from
 * numbers that are a guess — the plan's item 5 acceptance criterion.
 */
export function precisionNote(precision: TimePrecision): string {
  return PRECISION_NOTE[precision];
}

/**
 * Derive the precision to advertise for a set of segments.
 *
 * Sentence segments NEVER carry turn precision: their times are either
 * word-aligned (`timing_source === 'word'`, schema v3+, from the sidecar's
 * /analyse-v2) or interpolated within each Whisper chunk. An earlier version
 * advertised 'turn' whenever diarization turns existed for the transcript,
 * while still emitting the interpolated numbers — a stronger claim than the
 * data supported. 'turn' remains in the type for genuinely turn-derived
 * exports, but segment-based exports must not claim it.
 *
 * The claim is 'word' only when every timed segment is word-aligned; a
 * mixed set gets the conservative label.
 */
export function precisionFor(segments: SentenceSegment[]): TimePrecision {
  const timed = (segments ?? []).filter(
    (s) => typeof s?.start_time === 'number' && typeof s?.end_time === 'number'
  );
  if (timed.length > 0 && timed.every((s) => s.timing_source === 'word')) {
    return 'word';
  }
  return 'interpolated';
}