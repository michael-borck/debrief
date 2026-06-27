// Hydration: convert raw DB rows (JSON columns as strings, booleans as 0/1)
// into the typed entity shapes the UI consumes. Centralised here so every
// read path hydrates identically — previously each call site did its own
// partial JSON.parse, so one corrupt blob column could throw out of a .map()
// and the outer try/catch would silently empty the whole list.

import type { Transcript, Project } from '../types';
import type { TranscriptRow, ProjectRow } from '../types/db';

/**
 * Parse a JSON-string column with a typed fallback. Returns `fallback` for
 * null/undefined/''/non-string, and — crucially — catches parse errors so a
 * single corrupt column degrades to the default instead of failing the row.
 */
export function parseJsonOr<T>(raw: unknown, fallback: T, field: string, rowId?: string): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`Failed to parse ${field}${rowId ? ` for ${rowId}` : ''}:`, err);
    return fallback;
  }
}

/** Full hydration of a transcripts row: every JSON column parsed, defaults applied. */
export function hydrateTranscriptRow(t: TranscriptRow): Transcript {
  const id = t?.id;
  return {
    ...t,
    action_items: parseJsonOr(t.action_items, [], 'action_items', id),
    key_topics: parseJsonOr(t.key_topics, [], 'key_topics', id),
    tags: parseJsonOr(t.tags, [], 'tags', id),
    validation_changes: parseJsonOr(t.validation_changes, [], 'validation_changes', id),
    processed_text: t.processed_text || t.full_text || '',
    speakers: parseJsonOr(t.speakers, [], 'speakers', id),
    emotions: parseJsonOr(t.emotions, {}, 'emotions', id),
    notable_quotes: parseJsonOr(t.notable_quotes, [], 'notable_quotes', id),
    research_themes: parseJsonOr(t.research_themes, [], 'research_themes', id),
    qa_pairs: parseJsonOr(t.qa_pairs, [], 'qa_pairs', id),
    concept_frequency: parseJsonOr(t.concept_frequency, {}, 'concept_frequency', id),
    starred: !!t.starred,
  };
}

/** Full hydration of a projects row: themes/key_insights/tags parsed. */
export function hydrateProjectRow(p: ProjectRow): Project {
  return {
    ...p,
    themes: parseJsonOr(p.themes, [], 'themes', p.id),
    key_insights: parseJsonOr(p.key_insights, [], 'key_insights', p.id),
    tags: parseJsonOr(p.tags, [], 'tags', p.id),
  };
}
