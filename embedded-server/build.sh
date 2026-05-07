#!/bin/bash
# Build the embedded sidecar binary (consumed by electron-builder via extraResources).
set -euo pipefail

cd "$(dirname "$0")"

# Load build-time secrets (HF_TOKEN, etc.) if .env exists. Gitignored;
# see .env.example for the template.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ ! -d venv ]; then
  echo "venv not found. Bootstrap with: python3 -m venv venv && venv/bin/pip install -r requirements.txt"
  exit 1
fi

source venv/bin/activate
pip install -q pyinstaller

# Ensure speech-analyser is installed from the sibling lens/ checkout.
# Assumes ../../lens/speech-analyser exists; will eventually be a published wheel.
if ! python -c "import speech_analyser" 2>/dev/null; then
  echo "Installing speech-analyser from ../../lens/speech-analyser..."
  pip install -q ../../lens/speech-analyser
fi

rm -rf build dist embedded-server.spec

pyinstaller --onefile \
  --name embedded-server \
  --collect-submodules uvicorn \
  --collect-submodules fastapi \
  --collect-all faster_whisper \
  --collect-all ctranslate2 \
  --collect-all onnxruntime \
  --collect-all av \
  --collect-all tokenizers \
  --collect-all huggingface_hub \
  --collect-all speech_analyser \
  server.py

deactivate

echo ""
echo "Build complete: embedded-server/dist/embedded-server"
ls -lh dist/embedded-server
