// Build a speaker-attributed transcript for the LLM.
//
// WHY
// The research-analysis prompt asks the model to attribute quotes and Q&A pairs
// to a speaker, and the schema has `speaker?` fields to receive it — but it was
// being handed plain prose with every speaker label stripped out. The model could
// not possibly fill those fields in, which is why `qa_pairs[].speaker` has always
// been null.
//
// Diarisation already assigns a speaker to each Whisper chunk (see the `speaker`
// field on `chunkTimings`), so the attribution is available; it just was never
// put back into the text the model reads.
//
// Format: consecutive chunks from the same speaker are merged into one labelled
// paragraph, matching the `[Name]: sentence` convention the speaker-tagging UI
// already writes into `processed_text`. Consistent formatting matters — the model
// sees the same shape whichever way a transcript was labelled.

export interface ChunkTiming {
  startTime?: number;
  endTime?: number;
  text?: string;
  speaker?: string | null;
}

/** Separator between a speaker label and their text. */
const LABEL = (speaker: string) => `[${speaker}]:`;

/**
 * Produce speaker-labelled prose from chunk timings.
 *
 * Returns '' when there is no usable speaker information, so callers can fall
 * back to the plain transcript — an unattributed prompt is still better than a
 * malformed one.
 */
export function buildSpeakerAttributedText(
  chunks: Array<ChunkTiming | null | undefined> | undefined | null
): string {
  if (!Array.isArray(chunks) || chunks.length === 0) return '';

  // Merge consecutive same-speaker chunks so the model sees paragraphs, not
  // one line per 10-second Whisper window.
  const paragraphs: Array<{ speaker: string; parts: string[] }> = [];

  for (const chunk of chunks) {
    const text = (chunk?.text ?? '').trim();
    if (!text) continue;
    const speaker = (chunk?.speaker ?? '').trim();

    // No label for this chunk: keep it flowing under the previous speaker rather
    // than inventing an "Unknown" attribution the model might then repeat.
    if (!speaker) {
      if (paragraphs.length > 0) paragraphs[paragraphs.length - 1].parts.push(text);
      continue;
    }

    const current = paragraphs[paragraphs.length - 1];
    if (current && current.speaker === speaker) {
      current.parts.push(text);
    } else {
      paragraphs.push({ speaker, parts: [text] });
    }
  }

  if (paragraphs.length === 0) return '';

  return paragraphs
    .map((p) => `${LABEL(p.speaker)} ${p.parts.join(' ')}`)
    .join('\n\n');
}

/**
 * Per-speaker share of spoken words, largest first.
 *
 * Used for role inference: "one person holds the floor" is what distinguishes a
 * presentation with Q&A from a discussion, and it cannot be derived from the
 * speaker COUNT alone.
 */
export function talkShareBySpeaker(
  chunks: Array<ChunkTiming | null | undefined> | undefined | null
): Array<{ speaker: string; words: number; share: number }> {
  const counts = new Map<string, number>();
  let total = 0;

  for (const chunk of chunks ?? []) {
    const text = (chunk?.text ?? '').trim();
    const speaker = (chunk?.speaker ?? '').trim();
    if (!text || !speaker) continue;
    const words = text.split(/\s+/).filter(Boolean).length;
    counts.set(speaker, (counts.get(speaker) ?? 0) + words);
    total += words;
  }

  if (total === 0) return [];

  return [...counts.entries()]
    .map(([speaker, words]) => ({ speaker, words, share: words / total }))
    .sort((a, b) => b.words - a.words);
}

/**
 * Classify how a conversation was structured.
 *
 * Speaker COUNT is not enough, and was actively misleading: a talk followed by
 * six audience questions has seven speakers, so the old "more than two means
 * discussion" rule classified a presentation as a discussion. What separates
 * them is whether one person holds the floor — in a presentation a single
 * speaker dominates and everyone else contributes briefly; in a discussion the
 * speaking time is spread.
 *
 * `segments` (a speaker's share of the transcript's sentence count) is used as
 * the talk-time proxy. It is coarser than the word-count balance in
 * conversationMetricsService, but it is the per-speaker signal available at
 * project level, where segment text is no longer in hand.
 *
 * Returns null when there is nothing to go on, so the caller can leave the
 * pattern as 'unknown' rather than asserting something unsupported.
 */
export function inferInteractionPattern(
  speakers: Array<{ name: string; segments?: number }> | undefined | null
): 'interview' | 'discussion' | 'presentation' | null {
  const usable = (speakers ?? []).filter((s) => s?.name);
  if (usable.length === 0) return null;

  // A single voice cannot be a discussion or an interview, whatever it is about.
  if (usable.length === 1) return 'presentation';

  const total = usable.reduce((sum, s) => sum + (s.segments ?? 0), 0);
  if (total <= 0) return null;

  const dominantShare = Math.max(...usable.map((s) => (s.segments ?? 0) / total));

  // Overwhelmingly one speaker: a talk, however many people asked questions.
  if (dominantShare >= 0.75) return 'presentation';

  // Two people trading turns is a conversation regardless of the split — an
  // interviewer typically says more than the person being interviewed.
  if (usable.length === 2) return 'interview';

  // Several speakers but one still clearly leads: a presentation with Q&A.
  if (dominantShare >= 0.6) return 'presentation';

  // Otherwise the floor is genuinely shared.
  return 'discussion';
}