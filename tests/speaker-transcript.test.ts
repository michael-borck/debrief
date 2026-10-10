// Tests for speaker-attributed transcript construction and role inference.
//
// WHY THIS EXISTS
// The research-analysis prompt asks the model to attribute quotes and Q&A pairs
// to a speaker, and the schema has always had a `speaker?` field to receive it —
// but it was handed plain prose with every label stripped out, so those fields
// could never be populated. Separately, `interactionPattern` was derived from the
// speaker COUNT alone, which classified a presentation with Q&A as a "discussion"
// (the exact case this plan targets: one speaker plus six questioners).

import { describe, it, expect } from 'vitest';
import {
  buildSpeakerAttributedText,
  talkShareBySpeaker,
  inferInteractionPattern,
  type ChunkTiming,
} from '../src/services/speakerTranscript';

const c = (speaker: string | null | undefined, text: string): ChunkTiming => ({
  speaker,
  text,
});

describe('buildSpeakerAttributedText', () => {
  it('labels each speaker block', () => {
    const out = buildSpeakerAttributedText([c('SPEAKER_00', 'Welcome everyone'), c('SPEAKER_01', 'Thanks')]);
    expect(out).toBe('[SPEAKER_00]: Welcome everyone\n\n[SPEAKER_01]: Thanks');
  });

  it('merges consecutive chunks from the same speaker into one block', () => {
    // Diarisation assigns a speaker per ~10s Whisper chunk; without merging, the
    // model would see dozens of single-line blocks for one continuous talk.
    const out = buildSpeakerAttributedText([
      c('SPEAKER_00', 'first part'),
      c('SPEAKER_00', 'second part'),
      c('SPEAKER_00', 'third part'),
    ]);
    expect(out).toBe('[SPEAKER_00]: first part second part third part');
  });

  it('starts a new block when the speaker changes', () => {
    const out = buildSpeakerAttributedText([
      c('SPEAKER_00', 'mine'),
      c('SPEAKER_01', 'mine too'),
      c('SPEAKER_00', 'mine again'),
    ]);
    expect(out.split('\n\n')).toHaveLength(3);
  });

  it('folds unlabelled chunks into the preceding speaker', () => {
    // Better than emitting an "Unknown" label the model might then repeat as if
    // it were a real speaker.
    const out = buildSpeakerAttributedText([
      c('SPEAKER_00', 'labelled'),
      c(null, 'unlabelled'),
    ]);
    expect(out).toBe('[SPEAKER_00]: labelled unlabelled');
  });

  it('drops leading unlabelled chunks rather than inventing a speaker', () => {
    const out = buildSpeakerAttributedText([c(null, 'orphan'), c('SPEAKER_00', 'real')]);
    expect(out).toBe('[SPEAKER_00]: real');
  });

  it('skips empty and whitespace-only chunks', () => {
    const out = buildSpeakerAttributedText([c('SPEAKER_00', 'keep'), c('SPEAKER_00', '   '), c('SPEAKER_00', '')]);
    expect(out).toBe('[SPEAKER_00]: keep');
  });

  it('returns empty string when there is nothing usable, so callers can fall back', () => {
    expect(buildSpeakerAttributedText([])).toBe('');
    expect(buildSpeakerAttributedText(undefined)).toBe('');
    expect(buildSpeakerAttributedText(null)).toBe('');
    expect(buildSpeakerAttributedText([c('SPEAKER_00', '   ')])).toBe('');
    // No speaker labels anywhere — the caller must use the plain transcript.
    expect(buildSpeakerAttributedText([c(null, 'just prose')])).toBe('');
  });

  it('tolerates null entries in the array', () => {
    const out = buildSpeakerAttributedText([null, c('SPEAKER_00', 'survived'), undefined]);
    expect(out).toBe('[SPEAKER_00]: survived');
  });
});

describe('talkShareBySpeaker', () => {
  it('computes each speaker share of spoken words', () => {
    const share = talkShareBySpeaker([
      c('A', 'one two three four'),
      c('B', 'five six'),
    ]);
    expect(share[0]).toMatchObject({ speaker: 'A', words: 4 });
    expect(share[0].share).toBeCloseTo(4 / 6);
    expect(share[1].share).toBeCloseTo(2 / 6);
  });

  it('sorts most-talkative first', () => {
    const share = talkShareBySpeaker([c('quiet', 'one'), c('loud', 'a b c d e')]);
    expect(share[0].speaker).toBe('loud');
  });

  it('ignores unlabelled and empty chunks', () => {
    expect(talkShareBySpeaker([c(null, 'a b c'), c('A', '')])).toEqual([]);
  });
});

describe('inferInteractionPattern', () => {
  it('classifies a single speaker as a presentation', () => {
    expect(inferInteractionPattern([{ name: 'A', segments: 100 }])).toBe('presentation');
  });

  it('classifies a two-way exchange as an interview regardless of the split', () => {
    // Interviewers typically talk more than the person being interviewed, so a
    // dominant speaker here does NOT mean a presentation.
    expect(inferInteractionPattern([{ name: 'Q', segments: 60 }, { name: 'A', segments: 40 }])).toBe(
      'interview'
    );
    expect(inferInteractionPattern([{ name: 'A', segments: 50 }, { name: 'B', segments: 50 }])).toBe(
      'interview'
    );
  });

  it('classifies a talk plus audience Q&A as a presentation, NOT a discussion', () => {
    // THE REGRESSION THIS FIXES. One speaker dominates; six people each ask a
    // brief question. Speaker count is 7, so the old rule said "discussion".
    const speakers = [
      { name: 'Presenter', segments: 85 },
      { name: 'Q1', segments: 2 },
      { name: 'Q2', segments: 3 },
      { name: 'Q3', segments: 2 },
      { name: 'Q4', segments: 3 },
      { name: 'Q5', segments: 2 },
      { name: 'Q6', segments: 3 },
    ];
    expect(speakers).toHaveLength(7);
    expect(inferInteractionPattern(speakers)).toBe('presentation');
  });

  it('classifies a genuinely shared multi-speaker conversation as a discussion', () => {
    const speakers = [
      { name: 'A', segments: 30 },
      { name: 'B', segments: 25 },
      { name: 'C', segments: 25 },
      { name: 'D', segments: 20 },
    ];
    expect(inferInteractionPattern(speakers)).toBe('discussion');
  });

  it('classifies a panel with one strong lead as a presentation', () => {
    const speakers = [
      { name: 'Chair', segments: 60 },
      { name: 'B', segments: 15 },
      { name: 'C', segments: 15 },
      { name: 'D', segments: 10 },
    ];
    expect(inferInteractionPattern(speakers)).toBe('presentation');
  });

  it('returns null when there is nothing to go on', () => {
    expect(inferInteractionPattern([])).toBeNull();
    expect(inferInteractionPattern(undefined)).toBeNull();
    expect(inferInteractionPattern(null)).toBeNull();
    // Speakers exist but no segment data — asserting a pattern here would be a
    // guess, so leave it unknown.
    expect(inferInteractionPattern([{ name: 'A' }, { name: 'B' }])).toBeNull();
    expect(inferInteractionPattern([{ name: 'A', segments: 0 }])).toBe('presentation');
  });

  it('ignores speakers with no name', () => {
    expect(inferInteractionPattern([{ name: '', segments: 5 }])).toBeNull();
  });
});