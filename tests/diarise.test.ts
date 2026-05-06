import { describe, it, expect } from 'vitest';

// @ts-expect-error - main-process JS module without type declarations
import diarise from '../public/electron/diarise.js';

const { alignSpeakersToChunks } = diarise as {
  alignSpeakersToChunks: (
    chunks: Array<{ startTime: number; endTime: number; [k: string]: unknown }>,
    turns: Array<{ start: number; end: number; speaker: string }>,
  ) => Array<{ startTime: number; endTime: number; speaker?: string }>;
};

describe('alignSpeakersToChunks', () => {
  it('returns chunks unchanged when there are no turns', () => {
    const chunks = [{ startTime: 0, endTime: 1, text: 'hi' }];
    expect(alignSpeakersToChunks(chunks, [])).toEqual(chunks);
  });

  it('assigns the speaker with maximum overlap', () => {
    const chunks = [{ startTime: 0, endTime: 2, text: 'hello world' }];
    const turns = [
      { start: 0.0, end: 0.5, speaker: 'Speaker 1' },
      { start: 0.5, end: 2.0, speaker: 'Speaker 2' },
    ];
    const out = alignSpeakersToChunks(chunks, turns);
    expect(out[0].speaker).toBe('Speaker 2');
  });

  it('leaves speaker undefined when there is no overlap', () => {
    const chunks = [{ startTime: 10, endTime: 11, text: 'late' }];
    const turns = [{ start: 0, end: 1, speaker: 'Speaker 1' }];
    const out = alignSpeakersToChunks(chunks, turns);
    expect(out[0].speaker).toBeUndefined();
  });

  it('handles multiple chunks independently', () => {
    const chunks = [
      { startTime: 0, endTime: 1, text: 'a' },
      { startTime: 1, endTime: 2, text: 'b' },
      { startTime: 2, endTime: 3, text: 'c' },
    ];
    const turns = [
      { start: 0, end: 1, speaker: 'Speaker 1' },
      { start: 1, end: 3, speaker: 'Speaker 2' },
    ];
    const out = alignSpeakersToChunks(chunks, turns);
    expect(out.map((c) => c.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 2']);
  });
});
