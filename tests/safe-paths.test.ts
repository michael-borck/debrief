// @vitest-environment node
//
// Regression tests for the fs-delete-file path scope. Before the fix, the
// IPC handler ran fs.unlinkSync on any path the renderer supplied. After
// the fix, it routes through assertPathUnderTmp which canonicalises both
// paths and checks the prefix via path.relative.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

// require() the CJS module the same way electron.js does.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isPathUnder, assertPathUnderTmp } = require('../public/electron/safe-paths.js');

const TMP = realpathSync(tmpdir());

describe('assertPathUnderTmp', () => {
  let workDir: string;
  let tmpFile: string;
  let tmpFileNonExistent: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(TMP, 'debrief-safe-paths-'));
    tmpFile = join(workDir, 'existing.wav');
    writeFileSync(tmpFile, 'wav-bytes');
    tmpFileNonExistent = join(workDir, 'deleted.wav');
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('accepts a real file under tmpdir', () => {
    expect(() => assertPathUnderTmp(tmpFile)).not.toThrow();
  });

  it('accepts a non-existent path whose dirname is under tmpdir', () => {
    // fs-delete-file is sometimes called after the file is already gone;
    // we still want to allow it through so the cleanup is idempotent.
    expect(() => assertPathUnderTmp(tmpFileNonExistent)).not.toThrow();
  });

  it('rejects absolute paths outside tmpdir', () => {
    expect(() => assertPathUnderTmp(join(homedir(), '.ssh', 'id_rsa'))).toThrow(/outside tmpdir/);
  });

  it('rejects a path that escapes via .. segments', () => {
    const sneaky = join(TMP, '..', '..', 'etc', 'passwd');
    expect(() => assertPathUnderTmp(sneaky)).toThrow(/outside tmpdir/);
  });

  it('rejects a path that prefix-matches but is not a child (e.g. /tmpfoo vs /tmp)', () => {
    // path.relative('/tmp', '/tmpfoo/x') returns '../tmpfoo/x' — the
    // '..' guard catches this. We can't actually create that dir on every
    // CI runner, so assert via isPathUnder directly with a hypothetical.
    expect(isPathUnder(`${TMP}foo/x`, TMP)).toBe(false);
  });

  it('rejects empty / non-string inputs', () => {
    expect(() => assertPathUnderTmp('')).toThrow();
    // @ts-expect-error wrong type intentional
    expect(() => assertPathUnderTmp(null)).toThrow();
    // @ts-expect-error wrong type intentional
    expect(() => assertPathUnderTmp(undefined)).toThrow();
  });

  it('rejects a symlink under tmpdir that points outside tmpdir', () => {
    // Create a symlink in workDir pointing at /etc/hosts. Canonicalisation
    // should resolve to /etc/hosts and fail the prefix check.
    const linkPath = join(workDir, 'link-to-outside');
    const target = '/etc/hosts';
    try {
      symlinkSync(target, linkPath);
    } catch {
      // Some sandboxes block symlink creation; skip the assertion in that
      // case. We still have the .. and absolute-path tests above.
      return;
    }
    expect(() => assertPathUnderTmp(linkPath)).toThrow(/outside tmpdir/);
  });
});

describe('isPathUnder', () => {
  it('is true for a real child', () => {
    const child = mkdtempSync(join(TMP, 'debrief-child-'));
    try {
      expect(isPathUnder(child, TMP)).toBe(true);
    } finally {
      rmSync(child, { recursive: true, force: true });
    }
  });

  it('is false when root is a substring prefix but not a directory parent', () => {
    expect(isPathUnder('/tmpfoo/bar', '/tmp')).toBe(false);
  });

  it('is false for the root itself (we want children, not the root)', () => {
    expect(isPathUnder(TMP, TMP)).toBe(false);
  });

  it('is false for empty inputs', () => {
    expect(isPathUnder('', TMP)).toBe(false);
    expect(isPathUnder(TMP, '')).toBe(false);
  });
});

// Special directory layout on macOS: nested workdir creation under
// /var/folders/.../T/ also needs to pass. mkdtempSync already gives us
// that, but assert explicitly so a future change to realpath logic can't
// silently regress it.
describe('macOS /private/var realpath', () => {
  it('accepts a tmp child after symlink resolution', () => {
    const child = mkdtempSync(join(tmpdir(), 'debrief-realpath-'));
    try {
      expect(isPathUnder(child, tmpdir())).toBe(true);
    } finally {
      rmSync(child, { recursive: true, force: true });
    }
  });
});
