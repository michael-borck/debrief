"""deep-talk embedded sidecar — HTTP wrapper around lens/speech-analyser, spawned by Electron main."""
import os
import sys

import uvicorn
from fastapi import FastAPI

VERSION = "0.0.1-spike"

app = FastAPI(title="deep-talk sidecar", version=VERSION)


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
