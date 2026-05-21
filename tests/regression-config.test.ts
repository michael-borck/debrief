// @vitest-environment node
//
// Regression guards for past bug-fix commits whose fix lives in config/CI and
// could be silently undone by a careless edit. (The two vector-store fixes —
// fabcbc1, 7cd48a7 — are covered behaviourally by tests/vector-store.test.ts via
// getTranscriptChunks.)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(__dirname, '..');
const readText = (p: string) => readFileSync(resolve(root, p), 'utf8');
const builder = () => JSON.parse(readText('electron-builder.json'));

describe('regression: packaging bundles all embedded-server *.py (64b60fd)', () => {
  // embedder.py was once missing from the bundle because the filter listed
  // files individually; it must use a *.py glob so new sidecar modules ship.
  it('extraResources includes a *.py glob for embedded-server', () => {
    const b = builder();
    const er = (b.extraResources || []).find((r: any) => r.from === 'embedded-server');
    expect(er, 'embedded-server extraResources entry').toBeTruthy();
    expect(er.filter).toContain('*.py');
  });
});

describe('regression: auto-update manifests are generated (6955aed)', () => {
  // publish must be github (not null) or electron-builder skips the
  // latest*.yml manifests that electron-updater needs.
  it('electron-builder publish targets github michael-borck/debrief', () => {
    const b = builder();
    const pub = Array.isArray(b.publish) ? b.publish[0] : b.publish;
    expect(pub).toMatchObject({ provider: 'github', owner: 'michael-borck', repo: 'debrief' });
  });
});

describe('regression: release is gated on dependency audits (238c936)', () => {
  it('release.yml runs npm audit and pip-audit', () => {
    const yml = readText('.github/workflows/release.yml');
    expect(yml).toMatch(/npm audit/);
    expect(yml).toMatch(/pip-audit/);
  });
});
