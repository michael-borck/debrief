// Robustness tests for the DB-row → entity hydration. These pin the behaviour
// that matters for release: a single corrupt JSON column must NOT take down the
// whole list (the original inline JSON.parse did exactly that — one bad blob
// threw out of a .map() and the outer catch silently emptied the library).

import { describe, it, expect } from 'vitest';
import { parseJsonOr, hydrateTranscriptRow, hydrateProjectRow } from '../src/utils/hydration';
import type { TranscriptRow, ProjectRow } from '../src/types/db';

function transcriptRow(over: Partial<TranscriptRow> = {}): TranscriptRow {
  return {
    id: 't1',
    title: 'Talk',
    filename: 'talk.mp3',
    duration: 120,
    file_size: 1000,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    status: 'completed',
    starred: 1,
    full_text: 'hello world',
    action_items: '["a","b"]',
    key_topics: '["x"]',
    tags: '[]',
    validation_changes: '[]',
    speakers: '[{"id":"s1","name":"Alice","segments":3}]',
    emotions: '{"joy":0.8}',
    notable_quotes: '[]',
    research_themes: '[]',
    qa_pairs: '[]',
    concept_frequency: '{}',
    ...over,
  } as TranscriptRow;
}

describe('parseJsonOr', () => {
  it('parses valid JSON', () => {
    expect(parseJsonOr('["a"]', [], 'f')).toEqual(['a']);
    expect(parseJsonOr('{"k":1}', {}, 'f')).toEqual({ k: 1 });
  });

  it('returns the fallback for null/undefined/empty', () => {
    expect(parseJsonOr(null, 'd', 'f')).toBe('d');
    expect(parseJsonOr(undefined, 'd', 'f')).toBe('d');
    expect(parseJsonOr('', 'd', 'f')).toBe('d');
  });

  it('returns the fallback for non-string input', () => {
    expect(parseJsonOr(42, 'd', 'f')).toBe('d');
    expect(parseJsonOr([], 'd', 'f')).toBe('d');
  });

  it('returns the fallback instead of throwing on malformed JSON', () => {
    expect(parseJsonOr('{not json', [], 'f')).toEqual([]);
    expect(parseJsonOr('@@@', {}, 'f')).toEqual({});
  });
});

describe('hydrateTranscriptRow', () => {
  it('parses every JSON column and coerces starred (0/1) to boolean', () => {
    const t = hydrateTranscriptRow(transcriptRow());

    expect(t.action_items).toEqual(['a', 'b']);
    expect(t.key_topics).toEqual(['x']);
    expect(t.speakers).toEqual([{ id: 's1', name: 'Alice', segments: 3 }]);
    expect(t.emotions).toEqual({ joy: 0.8 });
    expect(t.starred).toBe(true); // DB 1 → true
    expect(t.processed_text).toBe('hello world'); // falls back to full_text
  });

  it('coerces starred 0 → false', () => {
    expect(hydrateTranscriptRow(transcriptRow({ starred: 0 })).starred).toBe(false);
  });

  it('survives a single corrupt column without losing the rest of the row', () => {
    const t = hydrateTranscriptRow(
      transcriptRow({ action_items: '{corrupt', emotions: 'also broken' })
    );

    // corrupt columns fall back to defaults…
    expect(t.action_items).toEqual([]);
    expect(t.emotions).toEqual({});
    // …but the valid columns still parsed, and identity is intact.
    expect(t.key_topics).toEqual(['x']);
    expect(t.id).toBe('t1');
    expect(t.title).toBe('Talk');
  });

  it('treats empty-string JSON columns as empty defaults', () => {
    const t = hydrateTranscriptRow(
      transcriptRow({ tags: '', notable_quotes: '', concept_frequency: '' })
    );
    expect(t.tags).toEqual([]);
    expect(t.notable_quotes).toEqual([]);
    expect(t.concept_frequency).toEqual({});
  });
});

describe('hydrateProjectRow', () => {
  const projectRow = (over: Partial<ProjectRow> = {}): ProjectRow =>
    ({
      id: 'p1',
      name: 'Proj',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      themes: '["growth"]',
      key_insights: '["insight"]',
      tags: '[]',
      ...over,
    }) as ProjectRow;

  it('parses themes/key_insights/tags', () => {
    const p = hydrateProjectRow(projectRow());
    expect(p.themes).toEqual(['growth']);
    expect(p.key_insights).toEqual(['insight']);
    expect(p.tags).toEqual([]);
  });

  it('falls back to [] on corrupt themes, keeping the rest', () => {
    const p = hydrateProjectRow(projectRow({ themes: '{bad' }));
    expect(p.themes).toEqual([]);
    expect(p.key_insights).toEqual(['insight']);
    expect(p.name).toBe('Proj');
  });
});
