"""Build-time: prefetch pyannote models into embedded-server/models/.

Downloads pyannote/speaker-diarization-3.1 (and its sub-models — segmentation
and the embedding model) into a self-contained cache directory that gets
bundled into the PyInstaller binary via --add-data. At runtime the sidecar
points HF_HOME at the bundled cache so no token is needed.

Requires HF_TOKEN env var (sourced from .env by build.sh) and prior
acceptance of terms on huggingface.co/pyannote/speaker-diarization-3.1
and huggingface.co/pyannote/segmentation-3.0.
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

print(f"Downloading pyannote/speaker-diarization-3.1 into {CACHE_DIR}", flush=True)
from pyannote.audio import Pipeline

pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=token)
if pipeline is None:
    print("ERROR: Pipeline.from_pretrained returned None — token invalid or terms not accepted?", file=sys.stderr)
    sys.exit(2)

# Whisper isn't gated, but HF_HUB_OFFLINE=1 at runtime blocks any download —
# so we pre-pull the default model alongside pyannote. base = ~75MB; we
# match speech-analyser's AudioLens default.
print("Downloading Systran/faster-whisper-base", flush=True)
from huggingface_hub import snapshot_download

snapshot_download("Systran/faster-whisper-base")

total_bytes = sum(f.stat().st_size for f in CACHE_DIR.rglob("*") if f.is_file())
print(f"Done. Cache size: {total_bytes / 1e6:.1f} MB ({total_bytes / 1e9:.2f} GB)")
print("Top-level cache contents:")
for child in sorted(CACHE_DIR.iterdir()):
    print(f"  {child.name}")
