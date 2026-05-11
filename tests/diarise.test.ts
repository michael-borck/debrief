import { describe, it, expect } from 'vitest';
import { alignSpeakersToChunks } from '../src/services/rediarisationService';

describe('alignSpeakersToChunks', () => {
  it('returns chunks unchanged when there are no turns', () => {
    const chunks = [{ start_time: 0, end_time: 1, text: 'hi' }];
    expect(alignSpeakersToChunks(chunks, [])).toEqual(chunks);
  });

  it('assigns the speaker with maximum overlap', () => {
    const chunks = [{ start_time: 0, end_time: 2, text: 'hello world' }];
    const turns = [
      { start: 0.0, end: 0.5, speaker: 'Speaker 1' },
      { start: 0.5, end: 2.0, speaker: 'Speaker 2' },
    ];
    const out = alignSpeakersToChunks(chunks, turns);
    expect(out[0].speaker).toBe('Speaker 2');
  });

  it('leaves speaker undefined when there is no overlap', () => {
    const chunks = [{ start_time: 10, end_time: 11, text: 'late' }];
    const turns = [{ start: 0, end: 1, speaker: 'Speaker 1' }];
    const out = alignSpeakersToChunks(chunks, turns);
    expect(out[0].speaker).toBeUndefined();
  });

  it('handles multiple chunks independently', () => {
    const chunks = [
      { start_time: 0, end_time: 1, text: 'a' },
      { start_time: 1, end_time: 2, text: 'b' },
      { start_time: 2, end_time: 3, text: 'c' },
    ];
    const turns = [
      { start: 0, end: 1, speaker: 'Speaker 1' },
      { start: 1, end: 3, speaker: 'Speaker 2' },
    ];
    const out = alignSpeakersToChunks(chunks, turns);
    expect(out.map((c) => c.speaker)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 2']);
  });
});
