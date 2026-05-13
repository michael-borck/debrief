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
    TRIPLE="x86_64-pc-windows-msvc-shared"
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

echo "Extracting..."
tar -xzf "${TMPFILE}" -C .
rm "${TMPFILE}"

echo "Verifying..."
"./${PYTHON_BIN}" --version
"./${PYTHON_BIN}" -c "import struct; from struct import pack; print('stdlib OK')"

echo "Done: embedded-server/python/ (${TRIPLE})"
