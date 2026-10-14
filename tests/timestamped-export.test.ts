// Tests for the timestamped export formatters.
//
// These formats are the first place interpolated sentence timings become
// user-visible, so beyond format correctness the tests pin the honesty
// requirement from the plan: exports must say which kind of time they carry.

import { describe, it, expect } from 'vitest';
import {
  formatTimestamp,
  formatClock,
  selectSegments,
  toVtt,
  toSrt,
  toSpeakerText,
  precisionNote,
  precisionFor,
  type TimedLine,
} from '../src/utils/timestamped-export';
import type { SentenceSegment } from '../src/types';

const seg = (over: Partial<SentenceSegment>): SentenceSegment => ({
  id: 1,
  transcript_id: 't1',
  sentence_index: 0,
  text: 'hello',
  word_count: 1,
  version: 'original',
  created_at: '',
  updated_at: '',
  ...over,
});

const line = (over: Partial<TimedLine>): TimedLine => ({
  text: 'hello',
  start: 0,
  end: 1,
  precision: 'interpolated',
  ...over,
});

describe('formatTimestamp', () => {
  it('formats SRT with a comma', () => {
    expect(formatTimestamp(3661.5, 'srt')).toBe('01:01:01,500');
  });

  it('formats VTT with a dot', () => {
    expect(formatTimestamp(3661.5, 'vtt')).toBe('01:01:01.500');
  });

  it('handles hours, minutes and sub-second rounding', () => {
    expect(formatTimestamp(0, 'srt')).toBe('00:00:00,000');
    expect(formatTimestamp(59.9999, 'srt')).toBe('00:01:00,000');
    expect(formatTimestamp(7322.25, 'vtt')).toBe('02:02:02.250');
  });

  it('clamps negative and non-finite values', () => {
    expect(formatTimestamp(-5, 'srt')).toBe('00:00:00,000');
    expect(formatTimestamp(NaN, 'srt')).toBe('00:00:00,000');
    expect(formatTimestamp(Infinity, 'vtt')).not.toBe('');
  });
});

describe('formatClock', () => {
  it('shows m:ss under an hour and h:mm:ss past it', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(83)).toBe('1:23');
    expect(formatClock(3723)).toBe('1:02:03');
  });

  it('floors rather than rounds (timestamps point at where speech starts)', () => {
    expect(formatClock(83.9)).toBe('1:23');
  });
});

describe('selectSegments', () => {
  const rows = [
    seg({ id: 1, speaker: 'Alice', text: 'one' }),
    seg({ id: 2, speaker: 'Bob', text: 'two' }),
    seg({ id: 3, speaker: 'Alice', text: 'three' }),
    seg({ id: 4, speaker: 'Alice', text: '   ' }), // blank -> dropped
  ];

  it('keeps all non-blank segments when no speaker is given', () => {
    expect(selectSegments(rows).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('filters to one speaker', () => {
    expect(selectSegments(rows, 'Alice').map((s) => s.id)).toEqual([1, 3]);
  });

  it('trims the requested speaker name', () => {
    expect(selectSegments(rows, '  Alice ')).toHaveLength(2);
  });

  it('returns nothing for an absent speaker', () => {
    expect(selectSegments(rows, 'Carol')).toEqual([]);
  });

  it('tolerates null entries and null input', () => {
    expect(selectSegments(null)).toEqual([]);
    expect(selectSegments([null, rows[0]])).toHaveLength(1);
  });
});

describe('toSrt', () => {
  it('numbers cues and uses SRT timestamps', () => {
    const out = toSrt([
      line({ text: 'first', start: 0, end: 1.5 }),
      line({ text: 'second', start: 2, end: 3.25 }),
    ]);
    expect(out).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nfirst\n\n' +
        '2\n00:00:02,000 --> 00:00:03,250\nsecond\n'
    );
  });

  it('prefixes the speaker when known', () => {
    const out = toSrt([line({ speaker: 'Alice', text: 'hello' })]);
    expect(out).toContain('Alice: hello');
  });

  it('omits the prefix for unlabelled lines', () => {
    const out = toSrt([line({ speaker: null, text: 'hello' })]);
    expect(out).toContain('\nhello\n');
  });
});

describe('toVtt', () => {
  it('starts with the WEBVTT header and uses dot timestamps', () => {
    const out = toVtt([line({ text: 'hi', start: 1, end: 2 })]);
    expect(out.startsWith('WEBVTT\n\n')).toBe(true);
    expect(out).toContain('00:00:01.000 --> 00:00:02.000');
  });

  it('uses voice spans for speakers', () => {
    const out = toVtt([line({ speaker: 'Alice', text: 'hi there' })]);
    expect(out).toContain('<v Alice>hi there');
  });

  it('strips markup from speaker names and cue text', () => {
    // A transcript can contain angle brackets; a cue would interpret them.
    const out = toVtt([line({ speaker: '<b>Alice</b>', text: 'a <i>test</i>' })]);
    expect(out).toContain('<v Alice>a test');
    expect(out).not.toContain('<i>');
  });
});

describe('toSpeakerText', () => {
  it('groups consecutive sentences by the same speaker under one stamp', () => {
    const out = toSpeakerText([
      line({ speaker: 'Alice', text: 'one', start: 5 }),
      line({ speaker: 'Alice', text: 'two', start: 8 }),
    ]);
    expect(out).toBe('[0:05] Alice:\none two');
  });

  it('starts a new block when the speaker changes', () => {
    const out = toSpeakerText([
      line({ speaker: 'Alice', text: 'mine', start: 5 }),
      line({ speaker: 'Bob', text: 'mine too', start: 9 }),
    ]);
    expect(out).toBe('[0:05] Alice:\nmine\n\n[0:09] Bob:\nmine too');
  });

  it('returns to an earlier speaker as a new block', () => {
    const out = toSpeakerText([
      line({ speaker: 'Alice', text: 'a', start: 5 }),
      line({ speaker: 'Bob', text: 'b', start: 6 }),
      line({ speaker: 'Alice', text: 'c', start: 7 }),
    ]);
    expect(out.match(/Alice:/g)).toHaveLength(2);
  });

  it('falls back to Unknown for unlabelled lines', () => {
    const out = toSpeakerText([line({ speaker: null, text: 'anon', start: 2 })]);
    expect(out).toBe('[0:02] Unknown:\nanon');
  });
});

describe('precision labelling', () => {
  it('says interpolated timings are estimates', () => {
    const note = precisionNote('interpolated');
    expect(note).toMatch(/estimates/i);
    expect(note).toMatch(/drift/i);
  });

  it('says turn timings come from diarization', () => {
    expect(precisionNote('turn')).toMatch(/diarization turns/i);
    expect(precisionNote('turn')).not.toMatch(/estimate/i);
  });

  it('never claims turn precision for sentence segments', () => {
    // Regression (2026-10-14 audit): precisionFor used to return 'turn'
    // whenever diarization turns existed for the transcript, while the
    // emitted numbers were still interpolated sentence estimates.
    expect(precisionFor([])).toBe('interpolated');
    expect(
      precisionFor([seg({ start_time: 0, end_time: 1, timing_source: 'interpolated' })])
    ).toBe('interpolated');
    expect(precisionFor([seg({ start_time: 0, end_time: 1 })])).toBe('interpolated');
  });

  it('claims word precision only when every timed segment is word-aligned', () => {
    const timed = { start_time: 0, end_time: 1 };
    expect(precisionNote('word')).toMatch(/word-level/i);
    expect(
      precisionFor([
        seg({ ...timed, timing_source: 'word' }),
        seg({ ...timed, timing_source: 'word' }),
      ])
    ).toBe('word');
    // Mixed provenance gets the conservative label.
    expect(
      precisionFor([
        seg({ ...timed, timing_source: 'word' }),
        seg({ ...timed, timing_source: 'interpolated' }),
      ])
    ).toBe('interpolated');
  });
});