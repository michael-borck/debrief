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
from fastapi import HTTPException
from pydantic import BaseModel

from embedder import Embedder

VERSION = "0.0.1-spike"

_embedder = Embedder()


@app.get("/healthz")
def healthz():
    return {"status": "ok", "version": VERSION}


class _EmbedRequest(BaseModel):
    texts: list[str]
    normalize: bool = True


class _EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dim: int


@app.post("/embed", response_model=_EmbedResponse)
def embed(req: _EmbedRequest) -> _EmbedResponse:
    """Embed a batch of texts for chat-RAG retrieval. Debrief-specific —
    sits alongside speech-analyser's /analyse on the same sidecar process."""
    try:
        vectors = _embedder.embed(req.texts, normalize=req.normalize)
        return _EmbedResponse(
            embeddings=vectors,
            model=_embedder.model_id,
            dim=_embedder.dim,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8765"))
    print(f"starting on {host}:{port}", file=sys.stderr, flush=True)
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
