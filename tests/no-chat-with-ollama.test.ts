// @vitest-environment node
//
// Guard test for the AI Completion seam (phases 1-3): the legacy
// `chat-with-ollama` IPC was removed and every AI call now goes through the
// unified `ai:complete` seam (electronAPI.ai.complete). This test fails if any
// part of the old path comes back, so it can't be silently reintroduced.
//
// It checks live source under src/ and public/. Prose may mention
// "chat-with-ollama" in comments, so we match the precise call shapes only:
//   - ipcMain.handle('chat-with-ollama'        (the main-process handler)
//   - ipcRenderer.invoke('chat-with-ollama'    (the preload binding)
//   - electronAPI.services.chatWithOllama      (the renderer accessor)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [resolve(__dirname, '..', 'src'), resolve(__dirname, '..', 'public')];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', '.git']);

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: "ipcMain.handle('chat-with-ollama' (legacy handler)", pattern: /ipcMain\.handle\(\s*['"]chat-with-ollama['"]/ },
  { label: "ipcRenderer.invoke('chat-with-ollama' (preload binding)", pattern: /ipcRenderer\.invoke\(\s*['"]chat-with-ollama['"]/ },
  { label: 'electronAPI.services.chatWithOllama (renderer accessor)', pattern: /electronAPI\.services\.chatWithOllama\b/ },
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

describe('no legacy chat-with-ollama path (Completion seam guard)', () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`has no occurrences of ${label}`, () => {
      const hits = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
      expect(hits, `forbidden pattern reintroduced in:\n${hits.join('\n')}`).toEqual([]);
    });
  }
});
