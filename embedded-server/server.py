"""debrief embedded sidecar — mounts lens/speech-analyser's FastAPI app."""
import hmac
import os
import sys
from pathlib import Path

import uvicorn

# Resolve bundle dir: PyInstaller's _MEIPASS in prod, source dir in dev.
if hasattr(sys, "_MEIPASS"):
    _BUNDLE_DIR = Path(sys._MEIPASS)
else:
    _BUNDLE_DIR = Path(__file__).resolve().parent


def _user_data_dir() -> Path:
    """Mirror Electron's app.getPath('userData'). Must match the path used by
    setup-venv.py and the renderer's appId-derived userData location."""
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "debrief"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", str(home / "AppData" / "Roaming"))) / "debrief"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config"))) / "debrief"


# Point HF at the extracted cache in userData (setup-venv.py extracted the
# bundled models.tar.gz here on first launch). Force offline mode so we
# never touch the gated-repo gate at runtime. Must happen BEFORE
# speech_analyser imports anything from huggingface_hub / pyannote.
_hf_cache = _user_data_dir() / "hf-cache"
# Backwards-compatibility: pre-v1.9 builds bundled models/ directly inside
# the .app under embedded-server/models/ — still honour that layout if the
# new tarball-based one isn't materialised yet (e.g. first run hasn't
# completed setup-venv yet).
if not (_hf_cache / "hub").exists() and (_BUNDLE_DIR / "models" / "hub").exists():
    _hf_cache = _BUNDLE_DIR / "models"
os.environ["HF_HOME"] = str(_hf_cache)
os.environ["HF_HUB_OFFLINE"] = "1"

# Tell speech-analyser's app to allow any localhost origin (the Electron
# renderer). Read at import time, so set first.
os.environ.setdefault("AUDIO_LENS_MODE", "desktop")

# Suppress shutdown-time "leaked semaphore" warnings from loky/joblib.
# When Electron sends SIGTERM, worker pools spawned by tokenizers' Rust
# layer and sklearn's loky backend don't always clean up their named
# semaphores. Disabling those two specifically avoids the leak without
# touching torch's CPU thread count (which would slow Whisper). Whisper
# itself uses torch's intra-op parallelism, which is unaffected.
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

from speech_analyser.app import app
from speech_analyser.diarizer import Diarizer
from fastapi import HTTPException, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import tempfile
from pathlib import Path as _Path

from embedder import Embedder

VERSION = "0.0.1-spike"

# Bounds applied to untrusted input. These are not paranoia: /analyse and
# /rediarise buffer a whole upload into memory (see _read_upload_capped), and
# the Whisper model cache is unbounded across model sizes, so an unbounded
# request from anything that reaches this port is a local resource-exhaustion
# primitive.
MAX_UPLOAD_BYTES = int(os.environ.get("DEBRIEF_MAX_UPLOAD_BYTES", str(512 * 1024 * 1024)))
MAX_EMBED_TEXTS = 512
MAX_EMBED_CHARS = 20_000
MAX_SPEAKERS = 20
SUPPORTED_UPLOAD_SUFFIXES = {".wav", ".mp3", ".m4a", ".mp4", ".flac", ".ogg", ".webm", ".aac", ".opus"}

# Per-launch shared secret set by the Electron SidecarManager. Loopback isn't a
# trust boundary on a multi-process desktop — without this, any local process
# could POST audio to /analyse or read /embed. Every request must carry
# `Authorization: Bearer <token>`.
#
# FAIL CLOSED. The previous version logged a warning and allowed everything when
# DEBRIEF_SIDECAR_TOKEN was unset, which meant any launch path other than
# SidecarManager's (a manual `python server.py`, a dev script, an inherited
# environment, a future refactor) silently produced an unauthenticated
# transcription service on the loopback interface. Auth that depends on the
# caller remembering to set an env var is not auth. Development runs must opt in
# explicitly with DEBRIEF_SIDECAR_INSECURE_NO_AUTH=1.
_SIDECAR_TOKEN = os.environ.get("DEBRIEF_SIDECAR_TOKEN")
_ALLOW_NO_AUTH = os.environ.get("DEBRIEF_SIDECAR_INSECURE_NO_AUTH") == "1"
if not _SIDECAR_TOKEN and not _ALLOW_NO_AUTH:
    print(
        "FATAL: DEBRIEF_SIDECAR_TOKEN is not set. Refusing to start an "
        "unauthenticated transcription service on loopback.\n"
        "  Normal use: launch via Electron (SidecarManager sets this).\n"
        "  Local development only: set DEBRIEF_SIDECAR_INSECURE_NO_AUTH=1 to opt in.",
        file=sys.stderr,
        flush=True,
    )
    raise SystemExit(2)
if not _SIDECAR_TOKEN:
    print(
        "WARNING: DEBRIEF_SIDECAR_INSECURE_NO_AUTH=1 — sidecar auth disabled (dev only)",
        file=sys.stderr,
        flush=True,
    )


@app.middleware("http")
async def _require_bearer_token(request: Request, call_next):
    if _SIDECAR_TOKEN:
        expected = f"Bearer {_SIDECAR_TOKEN}"
        provided = request.headers.get("authorization", "")
        # constant-time compare so a wrong token can't be guessed via timing.
        # Encode to bytes first: hmac.compare_digest raises TypeError on str
        # operands containing non-ASCII, and HTTP header values are latin-1
        # decodable, so "Authorization: Bearer café" is a well-formed header
        # that would otherwise produce a 500 instead of a clean 401.
        if not hmac.compare_digest(
            provided.encode("utf-8", "surrogateescape"), expected.encode("utf-8")
        ):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


# Reject requests whose Host header isn't loopback. Without this, a page at
# evil.com that resolves to 127.0.0.1 is same-origin from the browser's point of
# view (DNS rebinding). The bearer token is what actually blocks that today; this
# is the cheap second layer. Must be registered before the auth middleware so a
# rebound request is rejected before any work happens.
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"]
)


_embedder = Embedder()
_diarizer = Diarizer()


@app.get("/healthz")
def healthz():
    return {"status": "ok", "version": VERSION}


def _harden_app() -> None:
    """Tighten the vendored speech-analyser FastAPI app in place.

    speech_analyser.app registers its middleware and routes at import time and
    ships a desktop-mode CORS policy that allows `file://.*` and `null` origins.
    `file://.*` matches every local file origin, and `null` matches sandboxed
    iframes and data: navigations — a page on the internet could therefore fire
    simple multipart POSTs at this service (CSRF-simple, so no preflight).

    We do not patch the vendored package: embedded-server/dist/ is a
    gitignored PyInstaller artifact that is regenerated on every build, so an
    edit there would silently vanish. The app object is imported and configured
    here instead, which is the source of truth.

    CORS is removed outright because the Electron renderer reaches the sidecar
    over IPC (preload exposes only sidecar:status / sidecar:restart) — it never
    issues a cross-origin HTTP request, so no origin needs allowing. Any browser
    that guesses the port is already blocked by the bearer token, and now also by
    TrustedHostMiddleware.
    """
    # Drop the vendored CORSMiddleware (and anything else we don't recognise).
    app.user_middleware = [m for m in app.user_middleware if m.cls is not CORSMiddleware]

    # Interactive API docs map the whole surface for anyone who reaches the port.
    # They're behind the auth middleware now that auth fails closed, but there's
    # no reason to ship them on a local service.
    app.router.routes = [
        r
        for r in app.router.routes
        if getattr(r, "path", None) not in ("/docs", "/redoc", "/openapi.json")
    ]


_harden_app()


class _EmbedRequest(BaseModel):
    # Unbounded, these scale linearly into memory: a few MB of JSON becomes a
    # few hundred MB of activations inside sentence-transformers.
    texts: list[str] = Field(..., max_length=MAX_EMBED_TEXTS)
    normalize: bool = True

    @Field_validator("texts")
    @classmethod
    def _cap_text_length(cls, values: list[str]) -> list[str]:
        for v in values:
            if len(v) > MAX_EMBED_CHARS:
                raise ValueError(f"text exceeds {MAX_EMBED_CHARS} characters")
        return values


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
        raise HTTPException(status_code=503, detail=_safe_error(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e))


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
    num_speakers: int | None = Form(
        default=None, ge=1, le=MAX_SPEAKERS, description="Exact speaker count hint (omit for auto)"
    ),
) -> _RediariseResponse:
    """Re-run diarisation only (no transcription). Debrief-specific endpoint
    so the per-transcript rerun is cheap and the speaker-count slider is
    honoured. Whisper is skipped — the renderer already has the segments."""
    suffix = _safe_suffix(file.filename)
    tmp_path = await _spool_upload(file, suffix)
    try:
        turns = _diarizer.diarize(tmp_path, num_speakers=num_speakers)
        return _RediariseResponse(
            speakers=[_RediariseTurn(start=t.start, end=t.end, speaker=t.speaker) for t in turns],
            num_speakers_used=num_speakers,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e))
    finally:
        tmp_path.unlink(missing_ok=True)


def _safe_suffix(filename: str | None) -> str:
    """Derive a temp-file suffix from an untrusted filename.

    The suffix never reaches a shell (mkstemp creates the file itself) and never
    becomes a path component, so this is hardening rather than fixing an
    exploitable traversal. It does prevent a pathological filename producing an
    `OSError: File name too long` from mkstemp, which would surface as a 500.
    """
    suffix = _Path(filename or "upload").suffix.lower()
    if suffix not in SUPPORTED_UPLOAD_SUFFIXES:
        return ".wav"
    return suffix


async def _spool_upload(file: UploadFile, suffix: str) -> _Path:
    """Stream an upload to a temp file, aborting if it exceeds the size cap.

    The previous code called `await file.read()`, which pulls the entire body
    into RAM. Starlette spools multipart parts to disk past 1 MB precisely to
    avoid that; reading it all back undoes the protection, so a single large
    request could exhaust the sidecar's memory. Chunking keeps peak usage at the
    chunk size regardless of input.
    """
    total = 0
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                tmp_path = _Path(tmp.name)
                tmp_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes",
                )
            tmp.write(chunk)
        return _Path(tmp.name)


def _safe_error(exc: Exception) -> str:
    """Return a message safe to send to the client.

    str() on a pyannote/ctranslate2/torch failure typically embeds filesystem
    paths, the HuggingFace cache layout and library versions. Log the detail
    server-side; return something the caller can act on.
    """
    print(f"sidecar error: {exc!r}", file=sys.stderr, flush=True)
    return type(exc).__name__


def main() -> None:
    # Bind loopback only. HOST is honoured for tests, but must never be
    # something routable: an inherited HOST from the parent shell would expose
    # an authenticated-but-network-reachable transcription service.
    host = os.environ.get("HOST", "127.0.0.1")
    if host not in ("127.0.0.1", "localhost", "::1"):
        print(
            f"FATAL: refusing to bind {host!r}; the sidecar must listen on loopback only.",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)
    port = int(os.environ.get("PORT", "8765"))
    print(f"starting on {host}:{port}", file=sys.stderr, flush=True)
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="warning",
        # Bound the work a single caller can queue up. Without these, N
        # concurrent uploads each buffer up to MAX_UPLOAD_BYTES.
        limit_concurrency=8,
        timeout_keep_alive=15,
    )


if __name__ == "__main__":
    main()
