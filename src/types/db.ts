// DB-row forms. better-sqlite3 returns JSON-array/object columns as strings and
// booleans as 0/1; these types model the RAW row so the IPC boundary is honest.
// Hydration (utils/hydration) parses the strings into the entity types
// (Transcript / Project). Consumers that need the raw string form (e.g.
// ChatHistoryPage's own JSON.parse on transcripts.get) read TranscriptRow
// directly; consumers that need parsed values run the row through hydrate*.

import type { Transcript, Project } from './index';

/** transcripts table row — JSON columns are strings, starred may be 0/1. */
export type TranscriptRow = Omit<
  Transcript,
  | 'action_items' | 'key_topics' | 'tags' | 'validation_changes'
  | 'speakers' | 'emotions' | 'notable_quotes' | 'research_themes'
  | 'qa_pairs' | 'concept_frequency'
> & {
  action_items?: string;
  key_topics?: string;
  tags?: string;
  validation_changes?: string;
  speakers?: string;
  emotions?: string;
  notable_quotes?: string;
  research_themes?: string;
  qa_pairs?: string;
  concept_frequency?: string;
};

/** projects table row — themes/key_insights/tags are JSON strings. */
export type ProjectRow = Omit<Project, 'themes' | 'key_insights' | 'tags'> & {
  themes?: string;
  key_insights?: string;
  tags?: string;
};

/** ProjectRow + rollup columns returned by the listProjectsWithStats JOIN. */
export type ProjectStatsRow = ProjectRow & {
  earliest_transcript?: string;
  latest_transcript?: string;
};

/** chat_messages / project_chat_messages row (snake_case, JSON-string metadata). */
export interface MessageRow {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  metadata?: string;
}

/** transcript_topics row. */
export interface TopicRow {
  id: string;
  transcript_id: string;
  topic_index: number;
  label: string;
  summary?: string;
  chunk_ids?: string;
  model_used?: string;
  created_at?: string;
}
