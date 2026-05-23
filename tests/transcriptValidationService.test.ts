// Tests for transcriptValidationService. The pure helpers (duplicate removal +
// similarity) carry the real algorithmic logic and are tested directly; the
// validate() orchestration is covered for its settings-gated early return with
// a minimal window.electronAPI stub (no AI call should happen).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  transcriptValidationService,
  removeDuplicateSentences,
  calculateSimilarity,
} from '../src/services/transcriptValidationService';

describe('calculateSimilarity', () => {
  it('is 1.0 for identical strings', () => {
    expect(calculateSimilarity('hello world', 'hello world')).toBe(1.0);
  });
  it('is 1.0 for two empty strings', () => {
    expect(calculateSimilarity('', '')).toBe(1.0);
  });
  it('is 0 for fully different equal-length strings', () => {
    expect(calculateSimilarity('abcdefgh', '12345678')).toBe(0);
  });
  it('is high for near-identical strings', () => {
    expect(calculateSimilarity('the lazy dog', 'the lazy dogs')).toBeGreaterThan(0.85);
  });
});

describe('removeDuplicateSentences', () => {
  it('returns input unchanged for empty or single-sentence text', () => {
    expect(removeDuplicateSentences('')).toEqual({
      cleanedText: '',
      removedCount: 0,
      removedSentences: [],
    });
    const single = removeDuplicateSentences('Just one sentence here.');
    expect(single.removedCount).toBe(0);
  });

  it('removes an exact duplicate sentence', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.';
    const result = removeDuplicateSentences(text);
    expect(result.removedCount).toBe(1);
    expect(result.cleanedText).toBe('The quick brown fox jumps over the lazy dog.');
  });

  it('removes a near-duplicate (>85% similar) sentence', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dogs.';
    expect(removeDuplicateSentences(text).removedCount).toBe(1);
  });

  it('keeps genuinely distinct sentences', () => {
    const text =
      'The committee approved the annual budget today. Rainfall across the valley broke local records.';
    const result = removeDuplicateSentences(text);
    expect(result.removedCount).toBe(0);
  });

  it('keeps very short fragments rather than treating them as duplicates', () => {
    const text = 'Yes. Yes. Yes.';
    const result = removeDuplicateSentences(text);
    // each "Yes" normalises to <10 chars, so none are removed
    expect(result.removedCount).toBe(0);
  });
});

describe('validate — settings gate', () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      db: { settings: { getMany: vi.fn(async () => ({})) } },
      ai: {
        complete: vi.fn(async () => {
          throw new Error('ai.complete should not be called when validation is disabled');
        }),
        cancel: vi.fn(),
      },
    };
  });

  it('returns the original text without an AI call when validation is not enabled', async () => {
    const res = await transcriptValidationService.validate('some transcript text');
    expect(res).toEqual({ validatedText: 'some transcript text', changes: [] });
    expect((window as any).electronAPI.ai.complete).not.toHaveBeenCalled();
  });
});
