// @vitest-environment jsdom
//
// Smoke tests for the DOCX/PDF export builders. They don't assert document
// internals (that'd be brittle), but they do catch the export path crashing —
// which is the realistic regression — and confirm a non-empty file is produced
// for both a minimal payload and a fully-populated one (metadata + analysis).

import { describe, it, expect } from 'vitest';
import { buildDocx, buildPdf, type ExportPayload } from '../src/services/exportService';

const minimal: ExportPayload = {
  transcript: { id: 't1', title: 'My Interview' } as any,
  transcriptContent: 'Hello world. This is the transcript body.',
  versionLabel: 'Original',
  includeMetadata: false,
  includeAnalysis: false,
};

const full: ExportPayload = {
  transcript: {
    id: 't2',
    title: 'Quarterly Review',
    filename: 'q.mp3',
    created_at: '2026-01-02T03:04:05.000Z',
    duration: 1925,
    status: 'completed',
    speaker_count: 2,
    sentiment_overall: 'positive',
    sentiment_score: 0.6,
    summary: 'A productive discussion about roadmap.',
    key_topics: ['roadmap', 'hiring'],
    action_items: ['Email the deck', 'Schedule follow-up'],
    speakers: [{ id: 'A', name: 'Alice' }],
    notable_quotes: ['We ship Friday.'],
    tags: ['work'],
  } as any,
  transcriptContent: 'Alice: We ship Friday.\nBob: Great.',
  versionLabel: 'Speaker tagged',
  includeMetadata: true,
  includeAnalysis: true,
};

describe('exportService', () => {
  it('buildDocx produces a non-empty Blob (minimal)', async () => {
    const blob = await buildDocx(minimal);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('buildDocx produces a non-empty Blob (metadata + analysis)', async () => {
    const blob = await buildDocx(full);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('buildPdf produces a non-empty Blob (minimal)', () => {
    const blob = buildPdf(minimal);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('buildPdf produces a non-empty Blob (metadata + analysis)', () => {
    const blob = buildPdf(full);
    expect(blob.size).toBeGreaterThan(0);
  });
});
