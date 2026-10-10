// @vitest-environment node
//
// Guard test for the BrowserWindow navigation policy in public/electron.js.
//
// THE BUG (2026-10-10 audit, H-1): will-navigate treated any URL starting with
// `file://` as internal. In production the app itself is loaded from a file://
// URL, so that prefix admitted EVERY local file. A renderer that ever
// navigated — an injected <a href>, a crafted hash, a compromised renderer —
// would load an arbitrary local HTML file in the privileged webContents and
// with it inherit preload.js, i.e. the entire electronAPI bridge (db access,
// ai:complete, crypto, fs). `http://localhost:` had the same problem, matching
// ANY port.
//
// THE FIX: allow exactly one target — the app's own document, ignoring the hash
// (HashRouter) — and deny everything else by default. http(s) targets are still
// handed to the OS browser, but no other scheme (file:// elsewhere, javascript:,
// data:) is permitted to load in the window at all.
//
// electron.js cannot be imported under vitest (it requires the electron
// runtime), so this asserts the policy against the source. This mirrors
// tests/no-generic-db-query.test.ts, which guards a main-process concern the
// same way.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '..', 'public', 'electron.js'), 'utf8');

/** Extract the body of the will-navigate handler. */
function navigationHandler(event: 'will-navigate' | 'will-redirect'): string {
  const marker = `webContents.on('${event}'`;
  const start = SOURCE.indexOf(marker);
  expect(start, `${event} handler must exist`).toBeGreaterThan(-1);

  const arrow = SOURCE.indexOf('=>', start);
  const open = SOURCE.indexOf('{', arrow);
  let depth = 0;
  for (let i = open; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}') {
      depth--;
      if (depth === 0) return SOURCE.slice(arrow, i + 1);
    }
  }
  throw new Error(`could not brace-match the ${event} handler`);
}

describe('BrowserWindow navigation policy', () => {
  it('will-navigate no longer treats any file:// URL as internal', () => {
    const body = navigationHandler('will-navigate');
    // The old prefix test admitted every local file.
    expect(body).not.toMatch(/startsWith\(['"]file:\/\/['"]\)/);
  });

  it('will-navigate no longer treats any localhost PORT as internal', () => {
    const body = navigationHandler('will-navigate');
    expect(body).not.toMatch(/startsWith\(['"]http:\/\/localhost:/);
  });

  it('compares against the app document URL, ignoring the hash', () => {
    const body = navigationHandler('will-navigate');
    // HashRouter navigation must keep working.
    expect(body).toMatch(/appDocumentUrl/);
    expect(body).toMatch(/split\('#'\)/);
  });

  it('denies by default: non-http(s) targets are never forwarded to the OS', () => {
    const body = navigationHandler('will-navigate');
    // preventDefault happens for everything external, before the openExternal
    // branch, so a file:// or javascript: target is dropped rather than opened.
    expect(body).toMatch(/event\.preventDefault\(\)/);
    const preventAt = body.indexOf('preventDefault');
    const openAt = body.indexOf('shell.openExternal');
    expect(preventAt).toBeLessThan(openAt);

    // openExternal stays wrapped in an http(s)-only scheme check, so no other
    // scheme can reach the OS handler.
    expect(body).toMatch(
      /if \(url\.startsWith\('http:\/\/'\) \|\| url\.startsWith\('https:\/\/'\)\) \{\s*shell\.openExternal\(url\);/
    );
  });

  it('applies the same rule to will-redirect', () => {
    const body = navigationHandler('will-redirect');
    expect(body).toMatch(/appDocumentUrl/);
    expect(body).toMatch(/event\.preventDefault\(\)/);
  });

  it('window.open remains deny-all and scheme-allowlisted', () => {
    // The sibling control: no child BrowserWindow is ever created.
    expect(SOURCE).toMatch(/setWindowOpenHandler/);
    expect(SOURCE).toMatch(/return \{ action: 'deny' \}/);
  });

  it('renderer webPreferences stay hardened', () => {
    // Regression guard on the settings that make the rest of this meaningful.
    expect(SOURCE).toMatch(/nodeIntegration: false/);
    expect(SOURCE).toMatch(/contextIsolation: true/);
    expect(SOURCE).toMatch(/sandbox: true/);
  });
});