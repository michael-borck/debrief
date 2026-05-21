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
#
# Every repo is PINNED to a specific commit `revision`. Without this,
# snapshot_download follows the repo's main branch, so a compromised or
# retagged upstream could silently change the weights that ship in our binary.
# Bump a revision deliberately (and re-test) when you want a newer model.
# To refresh a SHA: curl -s https://huggingface.co/api/models/<repo> | jq -r .sha
REPOS: list = [
    {"id": "pyannote/speaker-diarization-3.1", "revision": "84fd25912480287da0247647c3d2b4853cb3ee5d"},
    {"id": "pyannote/segmentation-3.0", "revision": "e66f3d3b9eb0873085418a7b813d3b369bf160bb"},
    {"id": "pyannote/speaker-diarization-community-1", "revision": "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee"},
    {"id": "pyannote/wespeaker-voxceleb-resnet34-LM", "revision": "837717ddb9ff5507820346191109dc79c958d614"},
    {"id": "Systran/faster-whisper-base", "revision": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"},
    # MiniLM ships ONNX / OpenVINO / TF / Rust variants that we don't need.
    # Excluding them keeps the PyTorch path at ~80 MB instead of ~1 GB.
    {
        "id": "sentence-transformers/all-MiniLM-L6-v2",
        "revision": "c9745ed1d9f207416be6d2e6f8de32d1f16199bf",
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
    repo_id = repo["id"]
    revision = repo.get("revision")
    if not revision:
        print(f"ERROR: {repo_id} has no pinned revision", file=sys.stderr)
        sys.exit(1)
    opts = {k: v for k, v in repo.items() if k not in ("id", "revision")}
    print(f"Downloading {repo_id}@{revision[:12]}", flush=True)
    snapshot_download(repo_id, revision=revision, token=token, **opts)

total_bytes = sum(f.stat().st_size for f in CACHE_DIR.rglob("*") if f.is_file())
print(f"Done. Cache size: {total_bytes / 1e6:.1f} MB ({total_bytes / 1e9:.2f} GB)")
