// @vitest-environment node
//
// Guard test for Tier 0.6 / C-SEC-3: the generic `db-query` IPC (an
// arbitrary-SQL passthrough from the renderer) was removed and replaced by
// per-domain RPCs under electronAPI.db.*. This test fails if either canary
// string comes back, so the hole can't be silently reintroduced.
//
// It checks live source under src/ and public/. Doc comments are allowed to
// mention "db-query" in prose, so we match the precise call shapes only:
//   - electronAPI.database        (the renderer passthrough accessor)
//   - ipcMain.handle('db-query'   (the main-process handler)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [resolve(__dirname, '..', 'src'), resolve(__dirname, '..', 'public')];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', '.git']);

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'electronAPI.database (renderer SQL passthrough)', pattern: /electronAPI\.database\b/ },
  { label: "ipcMain.handle('db-query' (generic handler)", pattern: /ipcMain\.handle\(\s*['"]db-query['"]/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (EXTS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

describe('no generic db-query passthrough (Tier 0.6 guard)', () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it('scans a non-trivial number of source files', () => {
    // sanity: if the walk found nothing, the test would pass vacuously
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`has no occurrences of ${label}`, () => {
      const hits = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
      expect(hits, `forbidden pattern reintroduced in:\n${hits.join('\n')}`).toEqual([]);
    });
  }
});
