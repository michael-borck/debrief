// @vitest-environment node
//
// Tests for the settings per-domain RPC. Asserts:
//   - get/getMany/getAll return the right shapes
//   - set is an upsert (no duplicate-key error on second write)
//   - setMany is atomic (one bad key aborts the whole batch)
//   - assertKey rejects SQL-meta and weird characters
//
// node:sqlite stands in for better-sqlite3 here (same engine, different
// native binding; better-sqlite3 is built against Electron's Node ABI so
// it won't load from host-Node vitest). The settings.js module uses only
// the subset of API both drivers share: prepare/all/get/run/transaction.
//
// One caveat: node:sqlite's `transaction()` API differs from
// better-sqlite3's. We patch the module's `setMany` test to skip the
// transaction-wrapper check on node:sqlite and verify atomicity by
// observing the post-state instead.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const settingsModule = require('../public/electron/db-rpc/settings.js');

const SCHEMA = readFileSync(resolve(__dirname, '..', 'database', 'schema.sql'), 'utf8');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  // Clear the default seed rows so each test starts from empty.
  db.exec('DELETE FROM settings');
  return db;
}

// node:sqlite doesn't expose a `transaction(fn)` helper the way
// better-sqlite3 does, so wrap one ourselves. settings.js's setMany only
// requires that the returned object be callable with the batch.
function shim(db: DatabaseSync): any {
  return {
    prepare: db.prepare.bind(db),
    exec: db.exec.bind(db),
    transaction(fn: (arg: any) => void) {
      return (arg: any) => {
        db.exec('BEGIN');
        try {
          fn(arg);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      };
    },
  };
}

describe('db-rpc settings', () => {
  let db: DatabaseSync;
  let api: ReturnType<typeof settingsModule.makeSettings>;

  beforeEach(() => {
    db = makeDb();
    const shimmed = shim(db);
    api = settingsModule.makeSettings(() => shimmed);
  });

  describe('get', () => {
    it('returns null for a missing key', () => {
      expect(api.get('nonexistent')).toBeNull();
    });

    it('returns the stored value for a present key', () => {
      db.exec("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
      expect(api.get('theme')).toBe('dark');
    });
  });

  describe('getMany', () => {
    it('returns an empty object for an empty key list', () => {
      expect(api.getMany([])).toEqual({});
    });

    it('returns only present keys', () => {
      db.exec("INSERT INTO settings (key, value) VALUES ('a', '1'), ('b', '2')");
      expect(api.getMany(['a', 'b', 'c'])).toEqual({ a: '1', b: '2' });
    });
  });

  describe('getAll', () => {
    it('returns every row in the table', () => {
      db.exec("INSERT INTO settings (key, value) VALUES ('a', '1'), ('b', '2')");
      expect(api.getAll()).toEqual({ a: '1', b: '2' });
    });
  });

  describe('set', () => {
    it('inserts a new key', () => {
      api.set('theme', 'dark');
      expect(api.get('theme')).toBe('dark');
    });

    it('upserts an existing key (no PRIMARY KEY conflict)', () => {
      api.set('theme', 'dark');
      api.set('theme', 'light');
      expect(api.get('theme')).toBe('light');
    });

    it('rejects non-string values', () => {
      // @ts-expect-error wrong type intentional
      expect(() => api.set('theme', 42)).toThrow(/must be a string/);
    });
  });

  describe('setMany', () => {
    it('upserts every entry', () => {
      api.setMany({ theme: 'dark', autoBackup: 'true' });
      expect(api.get('theme')).toBe('dark');
      expect(api.get('autoBackup')).toBe('true');
    });

    it('is atomic — one bad key aborts the whole batch', () => {
      api.set('theme', 'dark');
      // 'bad key' has a space → assertKey will throw before any write runs.
      expect(() => api.setMany({ theme: 'light', 'bad key': 'x' })).toThrow();
      // The first key in the batch must NOT have been written.
      expect(api.get('theme')).toBe('dark');
    });
  });

  describe('assertKey', () => {
    const { assertKey } = settingsModule;

    it('accepts ASCII letters, digits, underscore (alpha first)', () => {
      expect(() => assertKey('theme')).not.toThrow();
      expect(() => assertKey('aiAnalysisUrl')).not.toThrow();
      expect(() => assertKey('a_b_c_123')).not.toThrow();
    });

    it('rejects SQL metacharacters and other hazards', () => {
      const bad = ["'", '"', ';', '--', ' ', '\n', "key';DROP--", '', '1abc', '..'];
      for (const k of bad) expect(() => assertKey(k)).toThrow();
    });
  });
});
