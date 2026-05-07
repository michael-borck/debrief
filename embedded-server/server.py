"""deep-talk embedded sidecar — mounts lens/speech-analyser's FastAPI app."""
import os
import sys

import uvicorn

# Set BEFORE importing speech_analyser.app — the module reads this at import
# time to configure CORS for any localhost origin (the Electron renderer).
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
