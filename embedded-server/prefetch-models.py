"""Build-time: prefetch pyannote + whisper model weights into embedded-server/models/.

Pure huggingface_hub.snapshot_download — no pyannote.audio / torch import, so
this runs fast in CI with just `pip install huggingface_hub`. The bundled
binary points HF_HOME at this directory at runtime, so no token is needed
once shipped.

Requires HF_TOKEN env var (sourced from .env by prefetch-models.sh) and
prior acceptance of terms on the gated pyannote pages.
"""
import os
import sys
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent / "models"
CACHE_DIR.mkdir(exist_ok=True)
os.environ["HF_HOME"] = str(CACHE_DIR)

token = os.environ.get("HF_TOKEN")
if not token:
    print("ERROR: HF_TOKEN not set. Add it to embedded-server/.env (see .env.example).", file=sys.stderr)
    sys.exit(1)

# All four pyannote repos are gated; their licences (MIT or CC-BY-4.0) permit
# redistribution provided we credit pyannote/wespeaker in the about screen.
# Systran/faster-whisper-base is ungated.
# Each entry is either a repo id (download everything) or a dict with
# optional allow_patterns / ignore_patterns to keep the bundle lean.
REPOS: list = [
    "pyannote/speaker-diarization-3.1",
    "pyannote/segmentation-3.0",
    "pyannote/speaker-diarization-community-1",
    "pyannote/wespeaker-voxceleb-resnet34-LM",
    "Systran/faster-whisper-base",
    # MiniLM ships ONNX / OpenVINO / TF / Rust variants that we don't need.
    # Excluding them keeps the PyTorch path at ~80 MB instead of ~1 GB.
    {
        "id": "sentence-transformers/all-MiniLM-L6-v2",
        "ignore_patterns": [
            "onnx/**",
            "openvino/**",
            "*.onnx",
            "tf_model.h5",
            "flax_model.msgpack",
            "rust_model.ot",
        ],
    },
]

from huggingface_hub import snapshot_download

for repo in REPOS:
    if isinstance(repo, str):
        repo_id, opts = repo, {}
    else:
        repo_id = repo["id"]
        opts = {k: v for k, v in repo.items() if k != "id"}
    print(f"Downloading {repo_id}", flush=True)
    snapshot_download(repo_id, token=token, **opts)

total_bytes = sum(f.stat().st_size for f in CACHE_DIR.rglob("*") if f.is_file())
print(f"Done. Cache size: {total_bytes / 1e6:.1f} MB ({total_bytes / 1e9:.2f} GB)")
