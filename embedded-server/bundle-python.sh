#!/bin/bash
# Download and stage a relocatable Python into embedded-server/python/.
# This bootstrap Python creates a venv on first launch (see setup-venv.py)
# into which speech-analyser + its heavy ML deps install.
set -euo pipefail

cd "$(dirname "$0")"

# Pinned to a specific python-build-standalone release for reproducibility.
# Bump when CPython has a security fix worth shipping.
PBS_TAG="20260504"
PBS_VERSION="3.13.13"
PBS_ASSET="cpython-${PBS_VERSION}+${PBS_TAG}-aarch64-apple-darwin-install_only.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PBS_ASSET}"

if [ -x python/bin/python3 ]; then
  echo "Bundled Python already present at embedded-server/python/. Skipping download."
  ./python/bin/python3 --version
  exit 0
fi

echo "Downloading ${PBS_ASSET} (~25 MB)..."
curl -fsSL "${PBS_URL}" -o "/tmp/${PBS_ASSET}"

echo "Extracting..."
tar -xzf "/tmp/${PBS_ASSET}" -C .
rm "/tmp/${PBS_ASSET}"

echo "Verifying..."
./python/bin/python3 --version
./python/bin/python3 -c "import struct; from struct import pack; print('stdlib OK')"

echo "Done: embedded-server/python/"
