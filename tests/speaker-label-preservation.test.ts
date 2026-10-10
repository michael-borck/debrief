// Tests for carrying user-assigned speaker names across a re-diarisation.
//
// THE BUG THIS FIXES
// rediarisationService deleted the whole `speaker_tagged` version and rebuilt it,
// destroying every manual rename and AI-suggested merge. Diarisation also
// reassigns SPEAKER_00… arbitrarily each run, so the fix cannot compare ids — it
// matches clusters on temporal overlap instead.

import { describe, it, expect } from 'vitest';
import {
  buildRenameMap,
  preserveSpeakerLabels,
} from '../src/services/speakerLabelPreservation';

const seg = (speaker: string, start: number, end: number) => ({
  speaker,
  start_time: start,
  end_time: end,
});

describe('buildRenameMap', () => {
  it('captures only genuine renames', () => {
    const renames = buildRenameMap([
      { id: 'SPEAKER_00', name: 'Alice' },
      { id: 'SPEAKER_01', name: 'Bob' },
    ]);
    expect(Object.fromEntries(renames)).toEqual({
      SPEAKER_00: 'Alice',
      SPEAKER_01: 'Bob',
    });
  });

  it('ignores entries whose name equals their id', () => {
    // An untouched diarisation has name === id. Treating that as a rename would
    // freeze stale SPEAKER_00 labels onto whatever cluster overlaps next run.
    const renames = buildRenameMap([{ id: 'SPEAKER_00', name: 'SPEAKER_00' }]);
    expect(renames.size).toBe(0);
  });

  it('handles missing or malformed input', () => {
    expect(buildRenameMap(undefined).size).toBe(0);
    expect(buildRenameMap(null).size).toBe(0);
    expect(buildRenameMap([{ id: '', name: 'x' }, { id: 'a', name: '' }]).size).toBe(0);
  });
});

describe('preserveSpeakerLabels', () => {
  it('carries a name across when the same voice keeps its time range', () => {
    // The classic case: identical diarisation, labels came back in a different
    // order, so SPEAKER_00 is now what used to be SPEAKER_01.
    const previous = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 10, 20)];
    const fresh = [seg('SPEAKER_00', 10, 20), seg('SPEAKER_01', 0, 10)];
    const renames = new Map([
      ['SPEAKER_00', 'Alice'],
      ['SPEAKER_01', 'Bob'],
    ]);

    const { labels, needsReview } = preserveSpeakerLabels(fresh, previous, renames);

    // Despite the ids swapping, each cluster keeps the human's name.
    expect(labels.get('SPEAKER_01')).toBe('Alice'); // 0-10 was Alice
    expect(labels.get('SPEAKER_00')).toBe('Bob'); // 10-20 was Bob
    expect(needsReview).toEqual([]);
  });

  it('preserves nothing when there was no previous tagging', () => {
    const result = preserveSpeakerLabels(
      [seg('SPEAKER_00', 0, 10)],
      [],
      new Map([['SPEAKER_00', 'Alice']])
    );
    expect(result.labels.size).toBe(0);
    expect(result.needsReview).toEqual([]);
  });

  it('preserves nothing when no speaker had been renamed', () => {
    // Matched a prior cluster, but it was never named — nothing to carry and
    // nothing the user would miss.
    const result = preserveSpeakerLabels(
      [seg('SPEAKER_00', 0, 10)],
      [seg('SPEAKER_00', 0, 10)],
      new Map()
    );
    expect(result.labels.size).toBe(0);
    expect(result.needsReview).toEqual([]);
  });

  it('flags for review when the new cluster spans two renamed speakers', () => {
    // The new run merged two voices into one cluster. Assigning either name
    // would silently mislabel half the transcript.
    const previous = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 10, 20)];
    const merged = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_00', 10, 20)];
    const renames = new Map([
      ['SPEAKER_00', 'Alice'],
      ['SPEAKER_01', 'Bob'],
    ]);

    const { labels, needsReview } = preserveSpeakerLabels(merged, previous, renames);

    expect(labels.size).toBe(0);
    expect(needsReview).toEqual(['SPEAKER_00']);
  });

  it('heals a pure split: both halves keep the name and merge back into one speaker', () => {
    // The new run split one voice into two clusters. Each half sits entirely
    // inside the old speaker's time range, so neither is ambiguous — both inherit
    // the name. Because rerun tallies by NAME, the two clusters collapse back into
    // a single speaker entry, so the split heals rather than being surfaced as a
    // problem.
    const previous = [seg('SPEAKER_00', 0, 20)];
    const split = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 10, 20)];
    const renames = new Map([['SPEAKER_00', 'Alice']]);

    const { labels, needsReview } = preserveSpeakerLabels(split, previous, renames);

    expect(labels.get('SPEAKER_00')).toBe('Alice');
    expect(labels.get('SPEAKER_01')).toBe('Alice');
    expect(needsReview).toEqual([]);
  });

  it('handles a partly-realigned run, preserving what it confidently can', () => {
    // Alice's region is unchanged; Bob's shifted later. Only Alice is dominant.
    const previous = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 10, 20)];
    const fresh = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 11, 20)];
    const renames = new Map([
      ['SPEAKER_00', 'Alice'],
      ['SPEAKER_01', 'Bob'],
    ]);

    const { labels, needsReview } = preserveSpeakerLabels(fresh, previous, renames);

    expect(labels.get('SPEAKER_00')).toBe('Alice');
    expect(labels.get('SPEAKER_01')).toBe('Bob');
    expect(needsReview).toEqual([]);
  });

  it('ignores segments with no usable timing', () => {
    const result = preserveSpeakerLabels(
      [{ speaker: 'SPEAKER_00', start_time: null, end_time: null }],
      [{ speaker: 'SPEAKER_00', start_time: null, end_time: null }],
      new Map([['SPEAKER_00', 'Alice']])
    );
    expect(result.labels.size).toBe(0);
  });

  it('ignores segments with no speaker label', () => {
    const result = preserveSpeakerLabels(
      [{ speaker: null, start_time: 0, end_time: 10 }],
      [seg('SPEAKER_00', 0, 10)],
      new Map([['SPEAKER_00', 'Alice']])
    );
    expect(result.labels.size).toBe(0);
  });

  it('leaves untouched clusters unlabelled rather than inventing a name', () => {
    // Only one speaker was ever renamed; the second must not inherit anything.
    const previous = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 10, 20)];
    const fresh = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 10, 20)];
    const renames = new Map([['SPEAKER_00', 'Alice']]);

    const { labels } = preserveSpeakerLabels(fresh, previous, renames);

    expect(labels.get('SPEAKER_00')).toBe('Alice');
    expect(labels.has('SPEAKER_01')).toBe(false);
  });

  it('is stable under a full label permutation', () => {
    // Three speakers, every id reassigned to a different voice. Names must follow
    // the voice, not the id.
    const previous = [seg('SPEAKER_00', 0, 10), seg('SPEAKER_01', 10, 20), seg('SPEAKER_02', 20, 30)];
    const fresh = [seg('SPEAKER_00', 20, 30), seg('SPEAKER_01', 0, 10), seg('SPEAKER_02', 10, 20)];
    const renames = new Map([
      ['SPEAKER_00', 'Alice'],
      ['SPEAKER_01', 'Bob'],
      ['SPEAKER_02', 'Carol'],
    ]);

    const { labels } = preserveSpeakerLabels(fresh, previous, renames);

    expect(labels.get('SPEAKER_01')).toBe('Alice');
    expect(labels.get('SPEAKER_02')).toBe('Bob');
    expect(labels.get('SPEAKER_00')).toBe('Carol');
  });
});