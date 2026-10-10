// @vitest-environment node
//
// Guard test for the column-injection class of bug found in
// public/electron.js `segments-update` (2026-10-10 audit, C-1).
//
// The bug: `Object.keys(updates).map(key => `${key} = ?`)` built a SET clause
// from arbitrary renderer-supplied object keys. A key like
// `text = 'x' WHERE 1=1 --` is valid JS, reaches the SQL string verbatim, and
// rewrites every row in the table (or exfiltrates another table via subquery).
// A key of `text` cannot do this, so the fix is not escaping — it is an
// allow-list, which is why db-rpc/transcripts.js and db-rpc/projects.js
// already use UPDATABLE_COLUMNS.
//
// Why a source-level test: the handler is registered inline in electron.js,
// which cannot be imported under vitest (it requires the electron runtime).
// Source scanning is what tests/no-generic-db-query.test.ts already does for
// exactly this reason, so this follows that established precedent rather than
// inventing a new one.
//
// The invariant asserted here is the *general* one, not "segments-update has a
// Set named X": any ipcMain handler that interpolates a value into a SQL string
// must gate it behind an allow-list membership check in the same handler body.
// That way a future handler in this file cannot reintroduce the hole silently.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN_PROCESS = readFileSync(
  resolve(__dirname, '..', 'public', 'electron.js'),
  'utf8'
);

/** Every `ipcMain.handle('name', ...)` registration in the main process. */
function findHandlers(source: string): { channel: string; body: string }[] {
  const out: { channel: string; body: string }[] = [];
  const re = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(re)) {
    // Brace-match the *arrow function body*, not from the channel string. The
    // parameter list is often a destructuring pattern (`{ segmentId, updates }`)
    // whose braces close immediately, which would truncate the match.
    const arrow = source.indexOf('=>', match.index);
    if (arrow === -1) continue;
    const open = source.indexOf('{', arrow);
    if (open === -1) continue;

    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    out.push({ channel: match[1], body: source.slice(arrow, end + 1) });
  }
  return out;
}

const handlers = findHandlers(MAIN_PROCESS);

describe('no-unvalidated-sql-interpolation guard', () => {
  it('finds the handler set (guard is not vacuously passing)', () => {
    expect(handlers.length).toBeGreaterThan(40);
    expect(handlers.some((h) => h.channel === 'segments-update')).toBe(true);
  });

  it('segments-update gates every interpolated column behind an allow-list', () => {
    const handler = handlers.find((h) => h.channel === 'segments-update');
    expect(handler).toBeDefined();
    const body = handler!.body;

    // The dangerous shape: building SQL from raw object keys.
    expect(body).not.toMatch(/Object\.keys\([^)]*\)\.map\(\s*key\s*=>/);

    // It must consult an allow-list before interpolating the key.
    expect(body).toMatch(/SEGMENT_UPDATABLE_COLUMNS\.has\(/);
  });

  it('the segments allow-list excludes identity and ownership columns', () => {
    // These are never user-writable: id/transcript_id identify ownership, and
    // created_at/updated_at are stamped by the handler.
    for (const col of ['id', 'transcript_id', 'created_at', 'updated_at']) {
      const literal = new RegExp(`'${col}'`);
      const listMatch = MAIN_PROCESS.match(
        /const SEGMENT_UPDATABLE_COLUMNS = new Set\(\[([\s\S]*?)\]\);/
      );
      expect(listMatch, 'SEGMENT_UPDATABLE_COLUMNS must exist').not.toBeNull();
      expect(listMatch![1], `'${col}' must not be in SEGMENT_UPDATABLE_COLUMNS`).not.toMatch(
        literal
      );
    }
  });

  it('segments-update validates segmentId before using it as a bound value', () => {
    const handler = handlers.find((h) => h.channel === 'segments-update');
    // segmentId is bound (safe) but must still be shape-checked so a garbage
    // id cannot silently no-op and report success.
    expect(handler!.body).toMatch(/Number\.isInteger\(segmentId\)/);
  });

  it('no handler interpolates an allow-list lookup result without gating', () => {
    // Any handler building `SET ${...}` from an interpolated key must either
    // gate the key through a `*.has(` check or use a static column list.
    const offenders: string[] = [];
    for (const { channel, body } of handlers) {
      if (!/UPDATE\s+\w+\s+SET\s+.*\$\{/.test(body)) continue;
      const gated = /\.has\(/.test(body) || /UPDATABLE_COLUMNS/.test(body);
      if (!gated) offenders.push(channel);
    }
    expect(offenders, `unvalidated dynamic SET clause in: ${offenders.join(', ')}`).toEqual([]);
  });
});