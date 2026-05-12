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
from speech_analyser.diarizer import Diarizer
from fastapi import HTTPException, UploadFile, File, Form
from pydantic import BaseModel
import tempfile
from pathlib import Path as _Path

from embedder import Embedder

VERSION = "0.0.1-spike"

_embedder = Embedder()
_diarizer = Diarizer()


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


class _RediariseTurn(BaseModel):
    start: float
    end: float
    speaker: str


class _RediariseResponse(BaseModel):
    speakers: list[_RediariseTurn]
    num_speakers_used: int | None


@app.post("/rediarise", response_model=_RediariseResponse)
async def rediarise(
    file: UploadFile = File(..., description="Audio file to re-diarise"),
    num_speakers: int | None = Form(default=None, description="Exact speaker count hint (omit for auto)"),
) -> _RediariseResponse:
    """Re-run diarisation only (no transcription). Debrief-specific endpoint
    so the per-transcript rerun is cheap and the speaker-count slider is
    honoured. Whisper is skipped — the renderer already has the segments."""
    suffix = _Path(file.filename or "upload").suffix or ".wav"
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = _Path(tmp.name)
    try:
        turns = _diarizer.diarize(tmp_path, num_speakers=num_speakers)
        return _RediariseResponse(
            speakers=[_RediariseTurn(start=t.start, end=t.end, speaker=t.speaker) for t in turns],
            num_speakers_used=num_speakers,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        tmp_path.unlink(missing_ok=True)


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8765"))
    print(f"starting on {host}:{port}", file=sys.stderr, flush=True)
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
