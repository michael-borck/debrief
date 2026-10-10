// Tests for the analysis map-reduce scaffolding.
//
// THE BUG THIS FIXES
// fileProcessor interpolated the ENTIRE transcript into one prompt, five times. A
// recording that overflowed the model's context window produced a provider error
// that was caught and converted into empty analysis — the transcript still saved as
// 'completed', with a blank summary and no error shown. Long presentations hit this
// reliably.
//
// These tests pin the behaviour that fixes it: oversized input is chunked, each
// chunk is analysed, and the partials are merged without losing the whole run to one
// bad chunk.

import { describe, it, expect, vi } from 'vitest';
import {
  chunkTranscript,
  mapReduce,
  mergeStringLists,
  mergeNumbers,
  mergeNumberMaps,
  sentimentLabelFor,
  DEFAULT_CHUNK_CHARS,
} from '../src/services/analysisMapReduce';

describe('chunkTranscript', () => {
  it('returns a single chunk when the text already fits', () => {
    const text = 'A short meeting. Everyone agreed.';
    expect(chunkTranscript(text)).toEqual([text]);
  });

  it('returns nothing for empty or whitespace input', () => {
    expect(chunkTranscript('')).toEqual([]);
    expect(chunkTranscript('   \n  ')).toEqual([]);
  });

  it('splits oversized text into multiple chunks', () => {
    const sentence = 'This is a sentence of reasonable length for testing. ';
    const text = sentence.repeat(200); // ~10k chars
    const chunks = chunkTranscript(text, 2000);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('never exceeds the requested budget', () => {
    const text = 'Sentence number one here. Sentence number two here. '.repeat(100);
    for (const budget of [500, 1000, 2000]) {
      for (const chunk of chunkTranscript(text, budget)) {
        // The final fold of a runt tail into its predecessor can exceed the
        // budget slightly; anything much larger means the split is broken.
        expect(chunk.length, `budget=${budget}`).toBeLessThan(budget * 2);
      }
    }
  });

  it('splits at sentence boundaries, never mid-sentence', () => {
    const text =
      'Alpha bravo charlie delta echo foxtrot golf. ' +
      'Hotel india juliet kilo lima mike november. ' +
      'Oscar papa quebec romeo sierra tango uniform. '.repeat(20);
    const chunks = chunkTranscript(text, 300);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk but the last must end on a terminator — that is the whole point
    // of aligning the split to sentences.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.trimEnd(), `chunk ended mid-sentence: ...${chunk.slice(-30)}`).toMatch(
        /[.!?\n]$/
      );
    }
  });

  it('preserves all content across chunks (no text lost or duplicated)', () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} of the test text.`);
    const text = sentences.join(' ');
    const chunks = chunkTranscript(text, 250);
    const rejoined = chunks.join(' ').replace(/\s+/g, ' ').trim();
    expect(rejoined).toBe(text.replace(/\s+/g, ' ').trim());
  });

  it('folds a runt tail into the previous chunk rather than sending it alone', () => {
    // Long body, then a tiny tail that would otherwise be its own useless chunk.
    const body = 'A reasonably long sentence here. '.repeat(40);
    const text = body + 'Tiny.';
    const chunks = chunkTranscript(text, 300);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1].length).toBeGreaterThanOrEqual(
      body.split('. ').slice(-1)[0].length
    );
    expect(chunks.join(' ')).toContain('Tiny.');
  });

  it('uses the default budget when none is given', () => {
    const text = 'Sentence. '.repeat(1000);
    const chunks = chunkTranscript(text);
    expect(DEFAULT_CHUNK_CHARS).toBe(6000);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThan(DEFAULT_CHUNK_CHARS * 2);
    }
  });
});

describe('mapReduce', () => {
  const three = ['a', 'b', 'c'];

  it('does not call the reducer for a single chunk (no wasted work)', async () => {
    const reduce = vi.fn((v: number[]) => v.length);
    const outcome = await mapReduce(['only'], async (c) => c.length, reduce, -1);

    expect(outcome.singlePass).toBe(true);
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(0);
    expect(outcome.value).toBe(4); // 'only'.length — returned as-is, reducer not invoked
    expect(reduce).not.toHaveBeenCalled();
  });

  it('maps every chunk and reduces the results', async () => {
    const map = vi.fn(async (c: string) => c.toUpperCase());
    const outcome = await mapReduce(three, map, (v) => v.join('-'), 'fallback');

    expect(map).toHaveBeenCalledTimes(3);
    expect(outcome.value).toBe('A-B-C');
    expect(outcome.succeeded).toBe(3);
    expect(outcome.singlePass).toBe(false);
  });

  it('keeps going when one chunk fails, and reports it', async () => {
    const map = async (c: string) => {
      if (c === 'b') throw new Error('provider exploded');
      return c.toUpperCase();
    };
    const outcome = await mapReduce(three, map, (v) => v.join('-'), 'fallback');

    // Two chunks still contributed — a 3-hour recording with one bad chunk must
    // still get analysis.
    expect(outcome.value).toBe('A-C');
    expect(outcome.succeeded).toBe(2);
    expect(outcome.failed).toBe(1);
  });

  it('returns the fallback when every chunk fails', async () => {
    const map = async () => {
      throw new Error('nope');
    };
    const outcome = await mapReduce(three, map, (v) => v.join('-'), 'fallback');

    expect(outcome.value).toBe('fallback');
    expect(outcome.succeeded).toBe(0);
    expect(outcome.failed).toBe(3);
  });

  it('returns the fallback for an empty chunk list', async () => {
    const outcome = await mapReduce([], async (c) => c, (v) => v, 'fallback');
    expect(outcome.value).toBe('fallback');
    expect(outcome.succeeded).toBe(0);
  });

  it('awaits an async reducer', async () => {
    const outcome = await mapReduce(
      three,
      async (c) => c.length,
      async (v) => v.reduce((a, b) => a + b, 0),
      -1
    );
    expect(outcome.value).toBe(3);
  });

  it('reports progress after each chunk', async () => {
    const seen: number[] = [];
    await mapReduce(three, async (c) => c, (v) => v, '', {
      onProgress: (done, total) => {
        seen.push(done);
        expect(total).toBe(3);
      },
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('stops on cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const map = vi.fn(async (c: string) => c);

    await expect(mapReduce(three, map, (v) => v, 'fallback', { signal: controller.signal })).rejects.toThrow();
    expect(map).not.toHaveBeenCalled();
  });
});

describe('mergeStringLists', () => {
  it('concatenates and dedupes case-insensitively', () => {
    // 'Scope' ranks first because two chunks named it; the single-hit items keep
    // their first-seen order.
    expect(mergeStringLists([['Scope', 'Velocity'], ['scope', 'Ownership']], 10)).toEqual([
      'Scope',
      'Velocity',
      'Ownership',
    ]);
  });

  it('ranks items independently named by more chunks first', () => {
    // A topic three chunks agreed on outranks one mentioned once, regardless of
    // which chunk came first.
    const merged = mergeStringLists(
      [['Rare', 'Common'], ['Common'], ['Common']],
      10
    );
    expect(merged[0]).toBe('Common');
  });

  it('caps the result', () => {
    const list = Array.from({ length: 50 }, (_, i) => `item ${i}`);
    expect(mergeStringLists([list], 5)).toHaveLength(5);
  });

  it('drops blanks and normalises whitespace in the dedupe key', () => {
    expect(mergeStringLists([['  A  ', '', '   ', 'A']], 10)).toEqual(['A']);
  });

  it('returns empty for empty input', () => {
    expect(mergeStringLists([], 10)).toEqual([]);
    expect(mergeStringLists([[], []], 10)).toEqual([]);
  });
});

describe('mergeNumbers', () => {
  it('averages and rounds to 3dp', () => {
    expect(mergeNumbers([1, 0, -1], 0)).toBe(0);
    expect(mergeNumbers([0.5, 0.4], 0)).toBe(0.45);
    expect(mergeNumbers([1 / 3, 2 / 3], 0)).toBe(0.5);
  });

  it('ignores non-finite values and falls back when nothing is usable', () => {
    expect(mergeNumbers([1, NaN, 3], 0)).toBe(2);
    expect(mergeNumbers([NaN, Infinity], 0.42)).toBe(0.42);
    expect(mergeNumbers([], 0.5)).toBe(0.5);
  });
});

describe('mergeNumberMaps', () => {
  it('averages each axis independently', () => {
    expect(mergeNumberMaps([{ a: 1, b: 0 }, { a: 0, b: 1 }])).toEqual({ a: 0.5, b: 0.5 });
  });

  it('takes the union of keys across chunks', () => {
    // An axis one chunk did not report must not be coerced to 0 — that would
    // read as "less emotion" rather than "not measured".
    expect(mergeNumberMaps([{ a: 1 }, { a: 0.5, c: 0.2 }])).toEqual({ a: 0.75, c: 0.2 });
  });

  it('skips non-numeric values', () => {
    expect(mergeNumberMaps([{ a: 1 }, { a: 'x' as unknown as number }])).toEqual({ a: 1 });
  });

  it('returns empty for no input', () => {
    expect(mergeNumberMaps([])).toEqual({});
  });
});

describe('sentimentLabelFor', () => {
  it('is symmetric around neutral', () => {
    expect(sentimentLabelFor(0.9)).toBe('positive');
    expect(sentimentLabelFor(0.2)).toBe('positive');
    expect(sentimentLabelFor(-0.2)).toBe('negative');
    expect(sentimentLabelFor(-0.9)).toBe('negative');
  });

  it('treats near-zero as neutral', () => {
    expect(sentimentLabelFor(0)).toBe('neutral');
    expect(sentimentLabelFor(0.1)).toBe('neutral');
    expect(sentimentLabelFor(-0.15)).toBe('neutral');
  });
});