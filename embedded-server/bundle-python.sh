#!/bin/bash
# Download and stage a relocatable Python into embedded-server/python/.
# This bootstrap Python creates a venv on first launch (see setup-venv.py)
# into which speech-analyser + its heavy ML deps install.
#
# Auto-detects host platform and downloads the matching python-build-
# standalone tarball. Runs on macOS (arm64), Linux x86_64, and Windows
# (via git-bash / MSYS / Cygwin shells in GitHub Actions).
set -euo pipefail

cd "$(dirname "$0")"

# Pinned to a specific python-build-standalone release for reproducibility.
# Bump when CPython has a security fix worth shipping. Same version across
# all platforms so users get identical Python semantics regardless of OS.
PBS_TAG="20260504"
PBS_VERSION="3.13.13"

# Map host platform to the PBS asset triple. Output of uname -s on Windows
# git-bash is MINGW64_NT-..., on MSYS it's MSYS_NT-..., on Cygwin CYGWIN_NT-...
case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in
      arm64) TRIPLE="aarch64-apple-darwin" ;;
      x86_64) TRIPLE="x86_64-apple-darwin" ;;
      *) echo "Unsupported macOS arch: $(uname -m)" >&2; exit 1 ;;
    esac
    PYTHON_BIN="python/bin/python3"
    ;;
  Linux)
    TRIPLE="x86_64-unknown-linux-gnu"
    PYTHON_BIN="python/bin/python3"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # PBS dropped the "-shared" suffix from Windows builds; current
    # release line is plain x86_64-pc-windows-msvc.
    TRIPLE="x86_64-pc-windows-msvc"
    PYTHON_BIN="python/python.exe"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

PBS_ASSET="cpython-${PBS_VERSION}+${PBS_TAG}-${TRIPLE}-install_only.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PBS_ASSET}"

if [ -x "${PYTHON_BIN}" ]; then
  echo "Bundled Python already present at embedded-server/python/. Skipping download."
  "./${PYTHON_BIN}" --version
  exit 0
fi

# Use a host-portable temp path. /tmp exists on macOS + Linux + git-bash on Win.
TMPFILE="$(mktemp -t debrief-pbs.XXXXXX.tar.gz 2>/dev/null || mktemp /tmp/debrief-pbs.XXXXXX.tar.gz)"

echo "Downloading ${PBS_ASSET}..."
curl -fsSL "${PBS_URL}" -o "${TMPFILE}"

# Verify the tarball against the publisher's checksum before extracting.
# python-build-standalone publishes one aggregate SHA256SUMS file per release
# (`<sha>  <asset>` lines). Fail closed: if we can't fetch or match the
# checksum, we do NOT extract — a tampered or truncated download must never
# become the bundled interpreter.
echo "Verifying checksum..."
SHAFILE="${TMPFILE}.SHA256SUMS"
SUMS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/SHA256SUMS"
curl -fsSL "${SUMS_URL}" -o "${SHAFILE}"
# Match the exact asset in field 2 ($2 == ...) so we don't pick up the
# *_stripped variant, which shares our filename as a prefix.
EXPECTED="$(awk -v f="${PBS_ASSET}" '$2 == f {print $1}' "${SHAFILE}" | head -1 | tr 'A-Z' 'a-z')"
if [ -z "${EXPECTED}" ]; then
  echo "ERROR: ${PBS_ASSET} not found in ${SUMS_URL}" >&2
  rm -f "${TMPFILE}" "${SHAFILE}"
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "${TMPFILE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "${TMPFILE}" | awk '{print $1}')"
else
  echo "ERROR: no sha256sum/shasum tool available to verify download" >&2
  rm -f "${TMPFILE}" "${SHAFILE}"
  exit 1
fi
ACTUAL="$(echo "${ACTUAL}" | tr 'A-Z' 'a-z')"
if [ "${EXPECTED}" != "${ACTUAL}" ]; then
  echo "ERROR: SHA-256 mismatch for ${PBS_ASSET}" >&2
  echo "  expected: ${EXPECTED}" >&2
  echo "  actual:   ${ACTUAL}" >&2
  rm -f "${TMPFILE}" "${SHAFILE}"
  exit 1
fi
rm -f "${SHAFILE}"
echo "Checksum OK (${ACTUAL})"

echo "Extracting..."
tar -xzf "${TMPFILE}" -C .
rm "${TMPFILE}"

echo "Verifying..."
"./${PYTHON_BIN}" --version
"./${PYTHON_BIN}" -c "import struct; from struct import pack; print('stdlib OK')"

echo "Done: embedded-server/python/ (${TRIPLE})"
