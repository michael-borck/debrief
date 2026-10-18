// Tests for conversation dynamics (prosody phase 1).
// Every expectation is hand-computed from the fixture turns, so the
// heuristics' definitions are pinned, not just their shapes.

import { describe, it, expect } from 'vitest';
import { computeDynamics, type DynamicsTurn } from '../src/utils/prosody';

const T = (speaker: string, start: number, end: number): DynamicsTurn => ({
  speaker, start, end,
});

describe('computeDynamics', () => {
  it('returns null without turns', () => {
    expect(computeDynamics([])).toBeNull();
    expect(computeDynamics([T('A', 2, 1)])).toBeNull(); // end <= start dropped
  });

  it('measures speech, overlap and pauses on a hand-computed fixture', () => {
    // A: 0-10, B interrupts at 8-12 (2s overlap), silence 12-14, A: 14-20.
    const dyn = computeDynamics(
      [T('A', 0, 10), T('B', 8, 12), T('A', 14, 20)],
      [],
      20
    )!;
    expect(dyn.speechSeconds).toBeCloseTo(18); // union: 0-12 + 14-20
    expect(dyn.overlapSeconds).toBeCloseTo(2); // 8-10
    expect(dyn.overlapShare).toBeCloseTo(2 / 20);
    expect(dyn.pauseCount).toBe(1);
    expect(dyn.avgPauseSeconds).toBeCloseTo(2);
    expect(dyn.longPauses).toBe(1);
  });

  it('attributes interruptions to the speaker who started during another', () => {
    const dyn = computeDynamics([T('A', 0, 10), T('B', 8, 12), T('A', 14, 20)])!;
    const a = dyn.speakers.find((s) => s.speaker === 'A')!;
    const b = dyn.speakers.find((s) => s.speaker === 'B')!;
    expect(b.interruptionsMade).toBe(1);
    expect(b.timesInterrupted).toBe(0);
    expect(a.interruptionsMade).toBe(0);
    expect(a.timesInterrupted).toBe(1);
    expect(a.turns).toBe(2);
    expect(a.talkSeconds).toBeCloseTo(16);
  });

  it('counts a short quiet interjection as a backchannel candidate', () => {
    // B says "mm-hm" (0.5s) at 4s while A holds the floor 0-10.
    const dyn = computeDynamics(
      [T('A', 0, 10), T('B', 4, 4.5)],
      [{ speaker: 'B', start_time: 4, end_time: 4.5, word_count: 1 }]
    )!;
    const b = dyn.speakers.find((s) => s.speaker === 'B')!;
    expect(b.backchannels).toBe(1);
  });

  it('does not call a long turn a backchannel even inside overlap', () => {
    const dyn = computeDynamics([T('A', 0, 10), T('B', 4, 9)])!;
    const b = dyn.speakers.find((s) => s.speaker === 'B')!;
    expect(b.backchannels).toBe(0);
    expect(b.interruptionsMade).toBe(1);
  });

  it('computes words per minute from segment word counts', () => {
    const dyn = computeDynamics(
      [T('A', 0, 60)],
      [{ speaker: 'A', start_time: 0, end_time: 60, word_count: 150 }]
    )!;
    expect(dyn.speakers[0].wordsPerMinute).toBe(150);
  });
});
