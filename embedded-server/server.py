"""debrief embedded sidecar — mounts lens/speech-analyser's FastAPI app."""
import os
import sys
from pathlib import Path

import uvicorn

# Resolve bundle dir: PyInstaller's _MEIPASS in prod, source dir in dev.
if hasattr(sys, "_MEIPASS"):
    _BUNDLE_DIR = Path(sys._MEIPASS)
else:
    _BUNDLE_DIR = Path(__file__).resolve().parent

# Point HF at the bundled pyannote cache and force offline mode so we never
# touch the gated-repo gate at runtime. Must happen BEFORE speech_analyser
# imports anything from huggingface_hub / pyannote.
os.environ["HF_HOME"] = str(_BUNDLE_DIR / "models")
os.environ["HF_HUB_OFFLINE"] = "1"

# Tell speech-analyser's app to allow any localhost origin (the Electron
# renderer). Read at import time, so set first.
os.environ.setdefault("AUDIO_LENS_MODE", "desktop")

from speech_analyser.app import app

VERSION = "0.0.1-spike"


@app.get("/healthz")
def healthz():
    return {"status": "ok", "version": VERSION}


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8765"))
    print(f"starting on {host}:{port}", file=sys.stderr, flush=True)
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
