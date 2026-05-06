import { describe, it, expect } from 'vitest';
import { alignSpeakersToChunks } from '../src/services/rediarisationService';

describe('alignSpeakersToChunks (renderer mirror)', () => {
  it('returns chunks unchanged when there are no turns', () => {
    const chunks = [{ start_time: 0, end_time: 1, text: 'hi' }];
    expect(alignSpeakersToChunks(chunks, [])).toEqual([{ start_time: 0, end_time: 1, text: 'hi' }]);
  });

  it('assigns the speaker with maximum overlap', () => {
    const chunks = [{ start_time: 0, end_time: 2 }];
    const turns = [
      { start: 0, end: 0.4, speaker: 'Speaker 1' },
      { start: 0.5, end: 1.9, speaker: 'Speaker 2' },
    ];
    const result = alignSpeakersToChunks(chunks, turns);
    expect(result[0].speaker).toBe('Speaker 2');
  });

  it('leaves speaker undefined when no turn overlaps', () => {
    const chunks = [{ start_time: 5, end_time: 6 }];
    const turns = [{ start: 0, end: 1, speaker: 'Speaker 1' }];
    const result = alignSpeakersToChunks(chunks, turns);
    expect(result[0].speaker).toBeUndefined();
  });

  it('handles partial overlap correctly when turn boundary is inside chunk', () => {
    const chunks = [{ start_time: 0, end_time: 10 }];
    const turns = [
      { start: 0, end: 4, speaker: 'A' },
      { start: 4, end: 10, speaker: 'B' },
    ];
    expect(alignSpeakersToChunks(chunks, turns)[0].speaker).toBe('B');
  });

  it('preserves extra chunk fields', () => {
    const chunks = [{ start_time: 0, end_time: 1, text: 'hi', sentence_index: 7 }];
    const turns = [{ start: 0, end: 1, speaker: 'A' }];
    const out = alignSpeakersToChunks(chunks, turns);
    expect(out[0]).toEqual({ start_time: 0, end_time: 1, text: 'hi', sentence_index: 7, speaker: 'A' });
  });
});
