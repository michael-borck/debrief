// Map-reduce scaffolding for the transcript analysis pipeline.
//
// WHY THIS EXISTS
// Until now every analysis stage (basic, sentiment, emotion, research) interpolated
// the ENTIRE transcript into a single prompt. A recording that overflows the
// model's context window produced a provider error, which the calling stage caught
// and converted into empty analysis — so the user got a transcript marked
// 'completed' with a blank summary, no topics and no insights, and no indication
// that anything had failed.
//
// Long-form recordings (presentations, webinars, panels) hit this reliably. This
// module splits oversized input into sentence-aligned chunks, analyses each, and
// merges the partial results.
//
// DESIGN RULES
// 1. Single chunk means single call. Behaviour for transcripts that already fit is
//    identical to before — no synthesis step, no merge, no extra cost.
// 2. Reduce is deterministic wherever it can be. Most stages merge lists, numbers
//    and objects arithmetically, which costs no extra LLM call and cannot fail.
//    Only `summary` needs a synthesis call, because concatenating ten chunk
//    summaries is not a summary.
// 3. Partial failure beats total failure. If one chunk fails, the others still
//    contribute; only an all-chunks-failed outcome propagates an error.
// 4. Sequential, not parallel. Local providers (Ollama) are typically single-slot;
//    firing eight concurrent requests just queues them and risks rate limits.
//    Cancellation is checked before every chunk.

import { checkCancelled } from '../utils/cancellation';

// Characters of transcript per request. Deliberately conservative: this has to fit
// inside the SMALLEST context window the app supports (a 2048-token phi model is in
// modelMetadataService's table), leaving room for the prompt wrapper and the JSON
// response. Chunks are also the unit of quality, not just size — a chunk that is a
// whole scene or section analyses better than an arbitrary slice.
//
// 6000 chars ≈ 1500 tokens, which leaves headroom on every supported model.
export const DEFAULT_CHUNK_CHARS = 6000;

// A chunk must contain at least this many characters to be analysed on its own.
// Below it, the text is folded into the previous chunk rather than sent alone —
// a two-word fragment produces a useless summary and wastes a round trip.
const MIN_CHUNK_CHARS = 400;

/** Cap on merged list sizes, so a 3-hour recording doesn't produce 400 topics. */
export const MERGE_LIMITS = {
  keyTopics: 12,
  actionItems: 20,
  notableQuotes: 10,
  researchThemes: 10,
  qaPairs: 25,
  examplesPerTheme: 4,
  contextsPerConcept: 4,
} as const;

/**
 * Split text into sentence-aligned chunks of at most `maxChars`.
 *
 * Splits at the last sentence terminator inside the window rather than at a fixed
 * offset, so a chunk never ends mid-sentence — which matters because the model is
 * asked to analyse a chunk as a coherent unit. Mirrors the proven approach in
 * transcriptValidationService.performChunkedValidation, extracted here so both
 * paths share one implementation.
 */
export function chunkTranscript(text: string, maxChars: number = DEFAULT_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let pos = 0;

  while (pos < trimmed.length) {
    const windowEnd = Math.min(pos + maxChars, trimmed.length);
    let end = windowEnd;

    if (windowEnd < trimmed.length) {
      const window = trimmed.substring(pos, windowEnd);
      const lastStop = Math.max(
        window.lastIndexOf('.'),
        window.lastIndexOf('!'),
        window.lastIndexOf('?'),
        // Newline paragraphs are also acceptable boundaries in a transcript.
        window.lastIndexOf('\n')
      );
      if (lastStop > 0) end = pos + lastStop + 1;
    }

    chunks.push(trimmed.substring(pos, end));
    pos = end;
  }

  // Fold a runt tail into its predecessor rather than sending it alone.
  if (chunks.length > 1) {
    const tail = chunks[chunks.length - 1];
    if (tail.length < MIN_CHUNK_CHARS) {
      chunks.pop();
      chunks[chunks.length - 1] += ' ' + tail;
    }
  }

  return chunks.filter((c) => c.trim().length > 0);
}

export interface MapReduceOptions {
  signal?: AbortSignal;
  /** Called after each chunk completes, for progress reporting. */
  onProgress?: (completed: number, total: number) => void;
}

export interface MapReduceOutcome<T> {
  /** Merged result. Meaningful only when at least one chunk succeeded. */
  value: T;
  /** How many chunks succeeded. Equals 1 when the input was a single chunk. */
  succeeded: number;
  /** How many chunks failed. 0 in the common case. */
  failed: number;
  /** True when the input fitted in one chunk and no merging occurred. */
  singlePass: boolean;
}

/**
 * Analyse each chunk, then merge.
 *
 * @param map      Runs one analysis pass over a chunk. May throw; a throwing chunk
 *                 is recorded as failed and does not abort the others.
 * @param reduce   Merges the successful per-chunk values. Only called when there is
 *                 more than one successful value, so a single-chunk input never
 *                 pays for a merge it doesn't need. May be async (summary
 *                 synthesis issues one extra completion).
 * @param fallback Returned when every chunk fails.
 */
export async function mapReduce<T, R>(
  chunks: string[],
  map: (chunk: string, index: number) => Promise<T>,
  reduce: (values: T[]) => R | Promise<R>,
  fallback: R,
  options: MapReduceOptions = {}
): Promise<MapReduceOutcome<R>> {
  const { signal, onProgress } = options;
  const total = chunks.length;

  if (total === 0) {
    return { value: fallback, succeeded: 0, failed: 0, singlePass: true };
  }

  const values: T[] = [];
  let failed = 0;

  for (let i = 0; i < total; i++) {
    checkCancelled(signal);
    try {
      values.push(await map(chunks[i], i));
    } catch (err) {
      // Deliberately swallow per-chunk errors: a 3-hour recording with one bad
      // chunk should still get analysis from the other 29.
      failed++;
      console.error(
        `[map-reduce] chunk ${i + 1}/${total} failed, continuing:`,
        err instanceof Error ? err.message : err
      );
    }
    onProgress?.(i + 1, total);
  }

  // All chunks failed — the caller decides whether that is fatal. Returning the
  // fallback keeps each stage's existing "degrade to empty, don't fail the import"
  // contract.
  if (values.length === 0) {
    return { value: fallback, succeeded: 0, failed, singlePass: total === 1 };
  }

  const value = values.length === 1 ? (values[0] as unknown as R) : await reduce(values);
  return { value, succeeded: values.length, failed, singlePass: total === 1 };
}

// --- Deterministic merge helpers ------------------------------------------
// Shared by the per-stage reducers. All of these are pure and total: no LLM call,
// no chance of throwing, and no dependence on provider behaviour.

/** Case- and whitespace-insensitive key, so "Scope" and "scope" dedupe. */
function dedupeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Concatenate string lists across chunks, dropping near-duplicates, capped.
 *
 * Sorts by a hit count rather than first-seen order, because a topic that the
 * model independently named in four chunks is more representative of a long
 * recording than one it mentioned once in whichever chunk came first.
 */
export function mergeStringLists(lists: string[][], cap: number): string[] {
  const tally = new Map<string, { value: string; hits: number; firstIndex: number }>();
  let order = 0;

  for (const list of lists) {
    for (const raw of list) {
      const item = (raw ?? '').trim();
      if (!item) continue;
      const key = dedupeKey(item);
      const existing = tally.get(key);
      if (existing) {
        existing.hits++;
      } else {
        tally.set(key, { value: item, hits: 1, firstIndex: order++ });
      }
    }
  }

  return [...tally.values()]
    .sort((a, b) => (b.hits - a.hits) || (a.firstIndex - b.firstIndex))
    .slice(0, cap)
    .map((e) => e.value);
}

/** Mean of numeric values, rounded to 3dp. Returns `fallback` when empty. */
export function mergeNumbers(values: number[], fallback: number): number {
  const nums = values.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (nums.length === 0) return fallback;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(mean * 1000) / 1000;
}

/**
 * Merge per-axis emotion scores by averaging each axis independently.
 *
 * Keys are the union across chunks: an axis a chunk didn't report simply doesn't
 * contribute to its mean, rather than being coerced to zero (which would drag the
 * average down and read as "less emotion").
 */
export function mergeNumberMaps(maps: Record<string, number>[]): Record<string, number> {
  const byAxis = new Map<string, number[]>();
  for (const map of maps) {
    for (const [axis, score] of Object.entries(map)) {
      if (typeof score !== 'number' || !Number.isFinite(score)) continue;
      const bucket = byAxis.get(axis);
      if (bucket) bucket.push(score);
      else byAxis.set(axis, [score]);
    }
  }

  const out: Record<string, number> = {};
  for (const [axis, scores] of byAxis) {
    out[axis] = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;
  }
  return out;
}

/**
 * Turn a mean sentiment score back into a label.
 *
 * The prompt asks for both a label and a score independently, so a merged score
 * needs a consistent label. Thresholds are symmetric around neutral.
 */
export function sentimentLabelFor(score: number): 'positive' | 'negative' | 'neutral' {
  if (score > 0.15) return 'positive';
  if (score < -0.15) return 'negative';
  return 'neutral';
}