// @vitest-environment node
//
// Tests for the projectAnalysis per-domain RPC (project_analysis):
//   - insert serializes an object results payload, or passes a string through
//   - insert with an explicit createdAt vs the schema default
//   - getLatestResults returns the newest row's results, or null
//   - bad ids / empty analysisType are rejected
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts).

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/projectAnalysis.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seedProject(db: DatabaseSync, id: string) {
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, `proj-${id}`);
}

describe('db-rpc projectAnalysis', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeProjectAnalysis>;

  beforeEach(() => {
    db = makeDb();
    api = mod.makeProjectAnalysis(() => db);
    seedProject(db, 'p1');
  });

  it('insert serializes an object results payload', () => {
    api.insert({
      id: 'a1',
      projectId: 'p1',
      analysisType: 'comprehensive_analysis',
      results: { themes: ['x'] },
      createdAt: '2026-01-01',
    });
    const row = db.prepare('SELECT * FROM project_analysis WHERE id = ?').get('a1') as any;
    expect(row.results).toBe('{"themes":["x"]}');
    expect(row.analysis_type).toBe('comprehensive_analysis');
    expect(row.created_at).toBe('2026-01-01');
  });

  it('insert passes a pre-stringified results string through', () => {
    api.insert({ id: 'a1', projectId: 'p1', analysisType: 't', results: '["already"]' });
    const row = db.prepare('SELECT * FROM project_analysis WHERE id = ?').get('a1') as any;
    expect(row.results).toBe('["already"]');
    // no explicit createdAt -> schema default fired
    expect(row.created_at).toBeTruthy();
  });

  it('getLatestResults returns the newest row, or null', () => {
    expect(api.getLatestResults('p1')).toBeNull();
    api.insert({ id: 'old', projectId: 'p1', analysisType: 't', results: { v: 1 }, createdAt: '2026-01-01' });
    api.insert({ id: 'new', projectId: 'p1', analysisType: 't', results: { v: 2 }, createdAt: '2026-02-01' });
    expect(api.getLatestResults('p1')).toEqual({ results: '{"v":2}' });
  });

  it('rejects bad ids and empty analysisType', () => {
    expect(() => api.insert({ id: '', projectId: 'p1', analysisType: 't', results: {} })).toThrow(
      /invalid analysis id/
    );
    expect(() => api.insert({ id: 'a', projectId: 42 as any, analysisType: 't', results: {} })).toThrow(
      /invalid project id/
    );
    expect(() => api.insert({ id: 'a', projectId: 'p1', analysisType: '', results: {} })).toThrow(
      /analysisType must be a non-empty string/
    );
    expect(() => api.getLatestResults('')).toThrow(/invalid project id/);
  });
});
