// @vitest-environment node
//
// Tests for the modelMetadata per-domain RPC (model_metadata):
//   - upsert serializes capabilities/parameters and coerces boolean flags
//   - upsert replaces an existing row (INSERT OR REPLACE)
//   - get returns the raw row, or null
//   - bad model name / missing provider are rejected
//
// node:sqlite stands in for better-sqlite3 (see db-rpc-transcripts.test.ts).

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../public/electron/db-rpc/modelMetadata.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

describe('db-rpc modelMetadata', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof mod.makeModelMetadata>;

  beforeEach(() => {
    db = makeDb();
    api = mod.makeModelMetadata(() => db);
  });

  it('upsert serializes JSON columns and coerces booleans to 0/1', () => {
    api.upsert({
      modelName: 'llama2',
      provider: 'ollama',
      contextLimit: 8000,
      capabilities: { chat: true },
      parameters: { temp: 0.7 },
      lastUpdated: '2026-01-01',
      userOverride: true,
      isAvailable: false,
    });
    const row = api.get('llama2');
    expect(row.provider).toBe('ollama');
    expect(row.context_limit).toBe(8000);
    expect(row.capabilities).toBe('{"chat":true}');
    expect(row.parameters).toBe('{"temp":0.7}');
    expect(row.user_override).toBe(1);
    expect(row.is_available).toBe(0);
  });

  it('upsert replaces an existing row', () => {
    api.upsert({ modelName: 'm', provider: 'ollama', contextLimit: 100 });
    api.upsert({ modelName: 'm', provider: 'openai', contextLimit: 200 });
    const row = api.get('m');
    expect(row.provider).toBe('openai');
    expect(row.context_limit).toBe(200);
    expect(db.prepare('SELECT COUNT(*) c FROM model_metadata').get()).toEqual({ c: 1 });
  });

  it('get returns null for an unknown model', () => {
    expect(api.get('nope')).toBeNull();
  });

  it('rejects a bad model name and a missing provider', () => {
    expect(() => api.get('')).toThrow(/invalid model name/);
    expect(() => api.upsert({ modelName: '', provider: 'x' })).toThrow(/invalid model name/);
    expect(() => api.upsert({ modelName: 'm', provider: '' })).toThrow(
      /provider must be a non-empty string/
    );
  });
});
