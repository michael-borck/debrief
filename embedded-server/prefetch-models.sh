#!/bin/bash
# Build-time: populate embedded-server/models/ so electron-builder's
# extraResources can bundle them into the .app. Idempotent — skips if
# models/ is already populated.
set -euo pipefail

cd "$(dirname "$0")"

if [ -n "$(ls -A models 2>/dev/null || true)" ]; then
  echo "Models already cached in embedded-server/models/. Skipping prefetch."
  exit 0
fi

# Load HF_TOKEN from .env when running locally. CI sets it from the repo
# secret directly, so .env won't exist there — that's fine.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${HF_TOKEN:-}" ]; then
  echo "ERROR: HF_TOKEN not set."
  echo "  Local:  add HF_TOKEN=hf_... to embedded-server/.env (see .env.example)"
  echo "  CI:     ensure the HF_TOKEN repo secret is exposed as an env var"
  echo "Token must have read access and the terms must be accepted on:"
  echo "  https://huggingface.co/pyannote/speaker-diarization-3.1"
  echo "  https://huggingface.co/pyannote/segmentation-3.0"
  echo "  https://huggingface.co/pyannote/speaker-diarization-community-1"
  exit 1
fi

PY="${PYTHON:-python3}"
if ! "$PY" -c "import huggingface_hub" 2>/dev/null; then
  echo "Installing huggingface_hub..."
  "$PY" -m pip install --quiet --user 'huggingface_hub>=1.0'
fi

"$PY" prefetch-models.py
