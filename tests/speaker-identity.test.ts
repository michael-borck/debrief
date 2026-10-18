// Tests for voiceprint matching math (cosine/centroid/ranking).
// Storage is covered by tests/db-rpc-speaker-identities.test.ts.

import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  centroid,
  rankMatches,
  SUGGESTION_THRESHOLD,
} from '../src/services/speakerIdentityService';

describe('cosineSimilarity', () => {
  it('is 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('is 0 for degenerate input rather than NaN', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});

describe('centroid', () => {
  it('averages and normalises', () => {
    const c = centroid([[1, 0], [0, 1]])!;
    expect(Math.hypot(...c)).toBeCloseTo(1);
    expect(c[0]).toBeCloseTo(Math.SQRT1_2);
  });

  it('returns null with nothing usable', () => {
    expect(centroid([])).toBeNull();
    expect(centroid([[]])).toBeNull();
  });
});

describe('rankMatches', () => {
  const candidates = [
    { id: 'alice', name: 'Alice', centroid: [1, 0] },
    { id: 'bob', name: 'Bob', centroid: [0, 1] },
    { id: 'empty', name: 'NoVoiceprint', centroid: null },
  ];

  it('ranks the closest identity first and drops null centroids', () => {
    const matches = rankMatches([0.9, 0.1], candidates, 0.3);
    expect(matches[0].identityId).toBe('alice');
    expect(matches.map((m) => m.identityId)).not.toContain('empty');
  });

  it('applies the suggestion threshold', () => {
    expect(rankMatches([0.9, 0.1], candidates)).toHaveLength(1);
    expect(SUGGESTION_THRESHOLD).toBeGreaterThan(0.31); // above spike cross-voice max
  });
});
