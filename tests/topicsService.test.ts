// @vitest-environment jsdom
//
// Tests for the pure clustering helpers behind the Topics tab. squaredDistance
// and mean are deterministic; kmeans uses k-means++ seeding (randomised), so we
// assert convergence invariants on well-separated data rather than exact output.

import { describe, it, expect } from 'vitest';
import { squaredDistance, mean, kmeans } from '../src/services/topicsService';

describe('topicsService clustering helpers', () => {
  it('squaredDistance computes squared euclidean distance', () => {
    expect(squaredDistance([0, 0], [3, 4])).toBe(25);
    expect(squaredDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('mean averages componentwise; empty -> []', () => {
    expect(mean([[0, 0], [2, 2], [4, 4]])).toEqual([2, 2]);
    expect(mean([])).toEqual([]);
  });

  it('kmeans separates two well-separated clusters', () => {
    const lo = [
      [0, 0],
      [0.1, 0.1],
      [0.2, 0],
    ];
    const hi = [
      [10, 10],
      [10.1, 9.9],
      [9.9, 10.2],
    ];
    const { assignments, centroids } = kmeans([...lo, ...hi], 2);
    expect(centroids).toHaveLength(2);
    expect(assignments).toHaveLength(6);
    // the three low points share one label, the three high points the other
    const loLabels = new Set(assignments.slice(0, 3));
    const hiLabels = new Set(assignments.slice(3));
    expect(loLabels.size).toBe(1);
    expect(hiLabels.size).toBe(1);
    expect([...loLabels][0]).not.toBe([...hiLabels][0]);
  });

  it('kmeans returns k centroids and labels every point in range', () => {
    const pts = Array.from({ length: 12 }, (_, i) => [i, i * 2]);
    const k = 3;
    const { assignments, centroids } = kmeans(pts, k);
    expect(centroids).toHaveLength(k);
    expect(assignments).toHaveLength(pts.length);
    expect(assignments.every((a) => a >= 0 && a < k)).toBe(true);
  });
});
