"""Sentence embeddings for Debrief's chat RAG.

Lives in debrief's sidecar (not speech-analyser) because text embeddings
are a chat-feature concern, not a speech-analysis concern. The sidecar
process already exists for transcription + diarisation, so adding the
~80 MB MiniLM model to that venv is cheaper than a second Python process.

384-dim, L2-normalised vectors via sentence-transformers/all-MiniLM-L6-v2.
Same dimensionality the renderer's vector store / LanceDB layer already
expects.
"""
import sys
from typing import Any

_MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
_DIM = 384


class Embedder:
    """Lazy-loaded sentence-transformers wrapper."""

    def __init__(self) -> None:
        self._model: Any = None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model

        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as e:
            raise RuntimeError(
                "sentence-transformers is not installed in the sidecar venv. "
                "Re-run npm run build:sidecar to bootstrap, or pip install "
                "'sentence-transformers>=2.7' into ~/Library/Application Support/debrief/venv/."
            ) from e

        try:
            from huggingface_hub import try_to_load_from_cache
            cached = try_to_load_from_cache(_MODEL_ID, "config.json")
            if not isinstance(cached, str):
                print(
                    f"[debrief] Downloading embedding model '{_MODEL_ID}' "
                    f"(~80 MB, first use only)...",
                    file=sys.stderr,
                    flush=True,
                )
        except Exception:
            pass

        self._model = SentenceTransformer(_MODEL_ID)
        return self._model

    def embed(self, texts: list[str], normalize: bool = True) -> list[list[float]]:
        if not texts:
            return []
        model = self._load()
        vectors = model.encode(
            texts,
            normalize_embeddings=normalize,
            convert_to_numpy=True,
        )
        return vectors.tolist()

    @property
    def dim(self) -> int:
        return _DIM

    @property
    def model_id(self) -> str:
        return _MODEL_ID
