#!/bin/bash
# Build the embedded sidecar binary (consumed by electron-builder via extraResources).
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d venv ]; then
  echo "venv not found. Bootstrap with: python3 -m venv venv && venv/bin/pip install -r requirements.txt"
  exit 1
fi

source venv/bin/activate
pip install -q pyinstaller

rm -rf build dist embedded-server.spec

pyinstaller --onefile \
  --name embedded-server \
  --collect-submodules uvicorn \
  --collect-submodules fastapi \
  server.py

deactivate

echo ""
echo "Build complete: embedded-server/dist/embedded-server"
ls -lh dist/embedded-server
