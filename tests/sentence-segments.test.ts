// @vitest-environment node
//
// Tests for sentence-segment construction (public/electron/sentence-segments.js).
//
// This module decides what a segment's start/end MEAN. The two behaviours
// pinned here are the 2026-10-14 audit fixes:
//  - word-aligned chunks produce exact sentence times and split at speaker
//    changes mid-chunk (P1-6), with real confidence (mean word probability);
//  - the legacy splitter keeps terminal punctuation and one-word sentences
//    instead of deleting backchannels, and reports timing honestly (P1-8).

import { describe, it, expect } from 'vitest';
import {
  createSentenceSegmentsFromChunks,
  splitIntoSentences,
  confidenceFromLogprob,
} from '../public/electron/sentence-segments.js';

const word = (w: string, start: number, end: number, speaker: string, probability = 0.9) => ({
  word: w, start, end, probability, speaker,
});

describe('splitIntoSentences', () => {
  it('keeps terminal punctuation', () => {
    expect(splitIntoSentences('Hello there. How are you? Fine!')).toEqual([
      'Hello there.', 'How are you?', 'Fine!',
    ]);
  });

  it('keeps one-word sentences and backchannels', () => {
    expect(splitIntoSentences('Yes. No. Absolutely.')).toEqual(['Yes.', 'No.', 'Absolutely.']);
  });

  it('returns [] for blank input', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences(undefined as unknown as string)).toEqual([]);
  });
});

describe('confidenceFromLogprob', () => {
  it('maps logprob into [0,1]', () => {
    expect(confidenceFromLogprob(0)).toBe(1);
    expect(confidenceFromLogprob(-Math.LN2)).toBeCloseTo(0.5, 5);
  });

  it('is null when Whisper gave no signal (no fabricated confidence)', () => {
    expect(confidenceFromLogprob(undefined)).toBeNull();
    expect(confidenceFromLogprob(NaN)).toBeNull();
  });
});

describe('createSentenceSegmentsFromChunks — interpolated mode', () => {
  it('distributes chunk time by word count and labels timing honestly', () => {
    const segments = createSentenceSegmentsFromChunks('t1', [
      {
        chunkIndex: 0, startTime: 0, endTime: 10, duration: 10,
        text: 'One two three four. Five six.', speaker: 'SPEAKER_00', avgLogprob: -0.2,
      },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('One two three four.');
    expect(segments[0].startTime).toBe(0);
    expect(segments[0].endTime).toBeCloseTo((4 / 6) * 10, 3);
    expect(segments[1].startTime).toBeCloseTo((4 / 6) * 10, 3);
    expect(segments[0].timingSource).toBe('interpolated');
    expect(segments[0].confidence).toBeCloseTo(Math.exp(-0.2), 5);
    expect(segments[0].words).toBeNull();
  });

  it('keeps a one-word answer as its own segment', () => {
    const segments = createSentenceSegmentsFromChunks('t1', [
      { chunkIndex: 0, startTime: 0, endTime: 4, duration: 4, text: 'Do you agree? Yes.' },
    ]);
    expect(segments.map((s) => s.text)).toEqual(['Do you agree?', 'Yes.']);
    expect(segments[1].confidence).toBeNull(); // no avgLogprob supplied
  });
});

describe('createSentenceSegmentsFromChunks — word mode', () => {
  it('uses exact word times for sentence boundaries', () => {
    const segments = createSentenceSegmentsFromChunks('t1', [
      {
        chunkIndex: 0, startTime: 0, endTime: 10, duration: 10,
        text: 'Hello there. General Kenobi.', speaker: 'SPEAKER_00',
        words: [
          word(' Hello', 1.2, 1.6, 'SPEAKER_00', 0.9),
          word(' there.', 1.6, 2.1, 'SPEAKER_00', 0.8),
          word(' General', 3.0, 3.5, 'SPEAKER_00', 1.0),
          word(' Kenobi.', 3.5, 4.2, 'SPEAKER_00', 0.7),
        ],
      },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      text: 'Hello there.', startTime: 1.2, endTime: 2.1, timingSource: 'word',
    });
    expect(segments[0].confidence).toBeCloseTo(0.85, 5); // mean word probability
    expect(segments[1]).toMatchObject({ startTime: 3.0, endTime: 4.2 });
    expect(JSON.parse(segments[0].words as string)).toHaveLength(2);
  });

  it('splits at a speaker change even without sentence punctuation', () => {
    // One Whisper chunk, two voices, no full stop between them: the old
    // code credited the whole thing to one speaker.
    const segments = createSentenceSegmentsFromChunks('t1', [
      {
        chunkIndex: 0, startTime: 0, endTime: 6, duration: 6,
        text: 'and then we— sorry go ahead', speaker: 'SPEAKER_00',
        words: [
          word(' and', 0.1, 0.3, 'SPEAKER_00'),
          word(' then', 0.3, 0.5, 'SPEAKER_00'),
          word(' we—', 0.5, 0.8, 'SPEAKER_00'),
          word(' sorry', 1.0, 1.4, 'SPEAKER_01'),
          word(' go', 1.4, 1.6, 'SPEAKER_01'),
          word(' ahead', 1.6, 2.0, 'SPEAKER_01'),
        ],
      },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ text: 'and then we—', speaker: 'SPEAKER_00' });
    expect(segments[1]).toMatchObject({ text: 'sorry go ahead', speaker: 'SPEAKER_01' });
    expect(segments[1].startTime).toBe(1.0);
  });

  it('assigns increasing sentence indexes across chunks', () => {
    const chunks = [0, 1].map((i) => ({
      chunkIndex: i, startTime: i * 10, endTime: i * 10 + 5, duration: 5,
      text: 'Hi.', speaker: 'SPEAKER_00',
      words: [word(' Hi.', i * 10 + 1, i * 10 + 2, 'SPEAKER_00')],
    }));
    const segments = createSentenceSegmentsFromChunks('t1', chunks, 'speaker_tagged');
    expect(segments.map((s) => s.sentenceIndex)).toEqual([0, 1]);
    expect(segments[0].version).toBe('speaker_tagged');
  });

  it('returns [] for unusable input', () => {
    expect(createSentenceSegmentsFromChunks('', [])).toEqual([]);
    expect(createSentenceSegmentsFromChunks('t1', [])).toEqual([]);
    expect(createSentenceSegmentsFromChunks('t1', null as never)).toEqual([]);
  });
});
