// Conversation dynamics ("prosody phase 1") computed from stored
// diarization turns + sentence segments — pure arithmetic, no audio access
// and no ML. Every measure is a heuristic over turn boundaries and is
// labelled as such in the UI; definitions live next to the code so the
// numbers are reproducible from diarization_turns + transcript_segments.

export interface DynamicsTurn {
  speaker: string;
  start: number;
  end: number;
}

export interface SpeakerDynamics {
  speaker: string;
  talkSeconds: number;
  talkShare: number; // 0..1 of total speech time (union of all turns)
  turns: number;
  avgTurnSeconds: number;
  wordsPerMinute: number | null; // null when no segment word data
  interruptionsMade: number; // turns starting during another speaker's turn
  timesInterrupted: number; // own turns another speaker started during
  backchannels: number; // short turns inside another speaker's stretch
}

export interface ConversationDynamics {
  speechSeconds: number; // union of all turn time
  overlapSeconds: number; // time covered by >= 2 speakers at once
  overlapShare: number; // overlapSeconds / durationSeconds (or speech)
  pauseCount: number; // gaps between consecutive turns (any speaker)
  avgPauseSeconds: number;
  medianPauseSeconds: number;
  longPauses: number; // gaps >= 1s
  speakers: SpeakerDynamics[];
}

/** Turn at most this long counts as a backchannel candidate. */
export const BACKCHANNEL_MAX_SECONDS = 1.0;
/** …and with segment data, at most this many words inside its window. */
export const BACKCHANNEL_MAX_WORDS = 3;

interface SegmentWords {
  speaker?: string | null;
  start_time?: number;
  end_time?: number;
  word_count?: number;
  words?: string | Array<unknown> | null;
}

function segmentWordCount(seg: SegmentWords): number {
  if (typeof seg.word_count === 'number') return seg.word_count;
  if (Array.isArray(seg.words)) return seg.words.length;
  if (typeof seg.words === 'string') {
    try {
      const parsed = JSON.parse(seg.words);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Total time covered by at least `minSpeakers` simultaneous turns. */
function coveredSeconds(turns: DynamicsTurn[], minSpeakers: number): number {
  const events: Array<{ t: number; delta: number }> = [];
  for (const turn of turns) {
    events.push({ t: turn.start, delta: 1 }, { t: turn.end, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || b.delta - a.delta);
  let active = 0;
  let covered = 0;
  let prev: number | null = null;
  for (const e of events) {
    if (prev !== null && active >= minSpeakers) covered += Math.max(0, e.t - prev);
    active += e.delta;
    prev = e.t;
  }
  return covered;
}

export function computeDynamics(
  turnsIn: DynamicsTurn[],
  segments: SegmentWords[] = [],
  durationSeconds?: number
): ConversationDynamics | null {
  const turns = (turnsIn || [])
    .filter((t) => t && t.speaker && Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (turns.length === 0) return null;

  const speechSeconds = coveredSeconds(turns, 1);
  const overlapSeconds = coveredSeconds(turns, 2);
  const total = durationSeconds && durationSeconds > 0 ? durationSeconds : speechSeconds;

  // Pauses: silence between one turn's end and the next turn's start,
  // measured against the latest end seen so overlaps don't create
  // negative or phantom gaps.
  const pauses: number[] = [];
  let latestEnd = turns[0].end;
  for (let i = 1; i < turns.length; i++) {
    const gap = turns[i].start - latestEnd;
    if (gap > 0) pauses.push(gap);
    latestEnd = Math.max(latestEnd, turns[i].end);
  }

  const bySpeaker = new Map<string, DynamicsTurn[]>();
  for (const t of turns) {
    const list = bySpeaker.get(t.speaker) || [];
    list.push(t);
    bySpeaker.set(t.speaker, list);
  }

  const wordsBySpeaker = new Map<string, number>();
  for (const seg of segments || []) {
    if (!seg.speaker) continue;
    wordsBySpeaker.set(seg.speaker, (wordsBySpeaker.get(seg.speaker) || 0) + segmentWordCount(seg));
  }
  const wordsInWindow = (start: number, end: number): number =>
    (segments || [])
      .filter(
        (s) =>
          typeof s.start_time === 'number' &&
          typeof s.end_time === 'number' &&
          s.start_time < end &&
          s.end_time > start
      )
      .reduce((sum, s) => sum + segmentWordCount(s), 0);

  const speakers: SpeakerDynamics[] = [...bySpeaker.entries()].map(([speaker, own]) => {
    const talkSeconds = own.reduce((s, t) => s + (t.end - t.start), 0);
    const others = turns.filter((t) => t.speaker !== speaker);

    // Interruption candidate: my turn starts while another speaker's
    // turn is still running (started during their speech).
    let interruptionsMade = 0;
    let backchannels = 0;
    for (const t of own) {
      const during = others.some((o) => t.start > o.start && t.start < o.end);
      if (during) interruptionsMade++;
      const short = t.end - t.start <= BACKCHANNEL_MAX_SECONDS;
      const fewWords =
        segments.length === 0 || wordsInWindow(t.start, t.end) <= BACKCHANNEL_MAX_WORDS;
      const insideOtherStretch = others.some(
        (o) => t.start >= o.start - 0.3 && t.end <= o.end + 0.3 && (o.end - o.start) > (t.end - t.start)
      );
      if (short && fewWords && (during || insideOtherStretch)) backchannels++;
    }
    const timesInterrupted = own.filter((t) =>
      others.some((o) => o.start > t.start && o.start < t.end)
    ).length;

    const words = wordsBySpeaker.get(speaker) || 0;
    return {
      speaker,
      talkSeconds,
      talkShare: speechSeconds > 0 ? talkSeconds / speechSeconds : 0,
      turns: own.length,
      avgTurnSeconds: own.length > 0 ? talkSeconds / own.length : 0,
      wordsPerMinute:
        words > 0 && talkSeconds > 0 ? Math.round(words / (talkSeconds / 60)) : null,
      interruptionsMade,
      timesInterrupted,
      backchannels,
    };
  });
  speakers.sort((a, b) => b.talkSeconds - a.talkSeconds);

  return {
    speechSeconds,
    overlapSeconds,
    overlapShare: total > 0 ? overlapSeconds / total : 0,
    pauseCount: pauses.length,
    avgPauseSeconds: pauses.length
      ? pauses.reduce((s, p) => s + p, 0) / pauses.length
      : 0,
    medianPauseSeconds: median(pauses),
    longPauses: pauses.filter((p) => p >= 1).length,
    speakers,
  };
}
