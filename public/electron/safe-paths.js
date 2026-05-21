// Path-restriction helpers used by IPC handlers in electron.js to guard
// against renderer-supplied paths escaping their intended root. Extracted
// here so they can be unit-tested without spinning up Electron.
//
// Add a new helper rather than relaxing an existing one. "Just resolve and
// check the prefix" sounds simple but has a long history of bugs (symlinks,
// '..' in canonical form, root-prefix substring matches like `/tmp` vs
// `/tmpfoo`). The helpers here use fs.realpathSync + path.relative to get
// it right.

const fs = require('fs');
const os = require('os');
const path = require('path');

function isPathUnder(targetPath, rootPath) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) return false;
  if (typeof rootPath !== 'string' || rootPath.length === 0) return false;

  const root = fs.realpathSync(rootPath);
  // realpath the target if it exists; if not (e.g. file was already deleted),
  // canonicalise the parent dir + keep the basename so '..' segments still
  // collapse before the prefix check.
  let resolved;
  try {
    resolved = fs.realpathSync(targetPath);
  } catch {
    resolved = path.resolve(targetPath);
  }

  const rel = path.relative(root, resolved);
  // path.relative starts with '..' if the target is outside, and is
  // absolute if the two paths are on different drives (Windows).
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertPathUnderTmp(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('filePath must be a non-empty string');
  }
  if (!isPathUnder(filePath, os.tmpdir())) {
    throw new Error(`refusing to operate on path outside tmpdir: ${filePath}`);
  }
}

module.exports = { isPathUnder, assertPathUnderTmp };
