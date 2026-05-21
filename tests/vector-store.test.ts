// @vitest-environment node
//
// Regression tests for the LanceDB workaround (H-18). LanceDB 0.20's string
// `.where()` predicates on Utf8 columns silently match nothing, which had
// broken transcript-scoped search and ALL predicate deletes. These exercise
// the real MainVectorStore against a temp LanceDB to prove:
//   - searchSimilar filters by transcriptId/speaker (and excludes the seed)
//   - getTranscriptChunks returns the right rows
//   - deleteTranscriptChunks actually removes rows (via rebuild)
//   - updateChunks replaces without duplicating
//   - reset clears the table
//
// vector-store.js guards its require('electron') (which throws outside
// Electron), and we pass an explicit dbPath, so app is never needed here.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MainVectorStore } = require('../public/electron/vector-store.js');

const emb = (seed: number) => ({
  embedding: Array.from({ length: 384 }, (_, i) => Math.sin(seed + i)),
});
function chunk(id: string, transcriptId: string, speaker: string, text: string) {
  return {
    id,
    transcriptId,
    text,
    startTime: 0,
    endTime: 1,
    speaker,
    metadata: { chunkIndex: 0, wordCount: 2, speakers: [speaker], method: 'test' },
  };
}

describe('vector-store LanceDB workaround (H-18)', () => {
  let dir: string;
  let vs: any;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vs-test-'));
    vs = new MainVectorStore();
    await vs.initialize(dir);
    await vs.storeChunks(
      [chunk('a1', 'A', 'Alice', 'a one'), chunk('a2', 'A', 'Bob', 'a two'), chunk('b1', 'B', 'Alice', 'b one')],
      [emb(1), emb(2), emb(9)]
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('searchSimilar filters by transcriptId and excludes the seed row', async () => {
    const r = await vs.searchSimilar(emb(1).embedding, { transcriptId: 'A', limit: 10, minScore: 0 });
    expect(r).toHaveLength(2);
    expect(r.every((x: any) => x.chunk.transcriptId === 'A')).toBe(true);
  });

  it('searchSimilar filters by speaker', async () => {
    const r = await vs.searchSimilar(emb(1).embedding, { speaker: 'Alice', limit: 10, minScore: 0 });
    expect(r.map((x: any) => x.chunk.id).sort()).toEqual(['a1', 'b1']);
  });

  it('getTranscriptChunks returns only that transcript', async () => {
    expect(await vs.getTranscriptChunks('A')).toHaveLength(2);
    expect(await vs.getTranscriptChunks('B')).toHaveLength(1);
  });

  it('deleteTranscriptChunks actually removes rows', async () => {
    await vs.deleteTranscriptChunks('A');
    expect(await vs.getTranscriptChunks('A')).toHaveLength(0);
    expect(await vs.getTranscriptChunks('B')).toHaveLength(1);
  });

  it('updateChunks replaces without duplicating', async () => {
    await vs.updateChunks([chunk('b1', 'B', 'Carol', 'b one updated')], [emb(9)]);
    const b = await vs.getTranscriptChunks('B');
    expect(b).toHaveLength(1);
    expect(b[0].speaker).toBe('Carol');
  });

  it('reset clears the table', async () => {
    await vs.reset();
    expect(await vs.getTranscriptChunks('B')).toHaveLength(0);
  });
});
