"""First-launch setup: create the user-data venv and pip install speech-analyser.

Run by SidecarManager when the venv is missing. Emits 'STEP: <message>' lines
on stdout so the renderer can show progress in <FirstLaunchSetup>; emits
'ERROR: <message>' on failure. Also writes a full transcript of every
subprocess to <userData>/logs/setup.log so the failure mode is recoverable
after the modal disappears.
"""
import os
import subprocess
import sys
import tarfile
from datetime import datetime
from pathlib import Path

# Pip specs installed into the user-data venv on first launch.
#   - speech-analyser[diarization] for transcription + speaker diarisation
#   - sentence-transformers for the /embed endpoint (chat RAG retrieval).
INSTALL_SPECS = [
    "speech-analyser[diarization]>=0.2.0",
    "sentence-transformers>=2.7,<6",
]


def user_data_dir() -> Path:
    """Mirror Electron's app.getPath('userData') across platforms."""
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "debrief"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", str(home / "AppData" / "Roaming"))) / "debrief"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config"))) / "debrief"


def venv_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def venv_pip(venv: Path) -> Path:
    return venv / ("Scripts/pip.exe" if sys.platform == "win32" else "bin/pip")


_log_file = None
_log_path: "Path | None" = None


def _open_log(target_dir: Path) -> None:
    global _log_file, _log_path
    log_dir = target_dir.parent / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        _log_path = log_dir / "setup.log"
        _log_file = open(_log_path, "a", buffering=1)
        _log_file.write(f"\n=== setup-venv run at {datetime.now().isoformat()} ===\n")
        _log_file.write(f"sys.executable={sys.executable}\n")
        _log_file.write(f"DEBRIEF_VENV={os.environ.get('DEBRIEF_VENV', '<unset>')}\n\n")
    except Exception:
        _log_file = None
        _log_path = None


def _log(line: str) -> None:
    if _log_file is None:
        return
    try:
        _log_file.write(line if line.endswith("\n") else line + "\n")
    except Exception:
        pass


def emit(step: str) -> None:
    print(f"STEP: {step}", flush=True)
    _log(f"STEP: {step}")


def fail(message: str, code: int = 1) -> "None":
    # Multi-line errors render fine in the renderer modal; keep the most
    # actionable info first so users see it without scrolling.
    print(f"ERROR: {message}", flush=True)
    _log(f"ERROR: {message}")
    sys.exit(code)


def run_step(label: str, cmd: list, *, hint: str = "", env: dict = None) -> None:
    """Run a subprocess, capturing stdout+stderr. On failure, surface the last
    chunk of captured output in the renderer-visible ERROR so we never
    silently lose 'why did it fail'."""
    _log(f"\n--- {label} ---")
    _log("$ " + " ".join(repr(c) if " " in str(c) else str(c) for c in cmd))
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )
        if result.stdout:
            _log(f"stdout:\n{result.stdout}")
        if result.stderr:
            _log(f"stderr:\n{result.stderr}")
    except subprocess.CalledProcessError as e:
        if e.stdout:
            _log(f"stdout:\n{e.stdout}")
        if e.stderr:
            _log(f"stderr:\n{e.stderr}")
        # Sidecar-manager parses our stdout line-by-line, and only the
        # FIRST 'ERROR:' line is surfaced in the renderer. So the modal
        # message must be a single useful line; full traceback lives in
        # the log file. Pick the most diagnostic single line from stderr
        # to include in the user-facing message.
        combined = (e.stderr or "") + ("\n" + (e.stdout or ""))
        last_line = next(
            (ln for ln in reversed(combined.strip().splitlines()) if ln.strip()),
            "",
        )
        parts = [f"{label} failed (exit {e.returncode})"]
        if last_line:
            # Truncate so the modal stays readable.
            snippet = last_line.strip()
            if len(snippet) > 200:
                snippet = snippet[:200] + "…"
            parts.append(snippet)
        if hint:
            parts.append(hint)
        if _log_path:
            parts.append(f"Full log: {_log_path}")
        fail(" | ".join(parts), e.returncode)
    except FileNotFoundError as e:
        msg = f"{label} failed: {e}"
        if hint:
            msg += f" | {hint}"
        if _log_path:
            msg += f" | Full log: {_log_path}"
        fail(msg, 1)


def main() -> int:
    # Allow the SidecarManager (and tests) to override the target via env.
    target = Path(os.environ["DEBRIEF_VENV"]) if "DEBRIEF_VENV" in os.environ \
        else user_data_dir() / "venv"

    _open_log(target)

    fresh_install = not (target.exists() and venv_python(target).exists())

    if fresh_install:
        target.parent.mkdir(parents=True, exist_ok=True)
        emit(f"Creating Python environment at {target}")
        run_step(
            "venv creation",
            [sys.executable, "-m", "venv", str(target)],
            hint="Check userData write permissions and disk space.",
        )

    pip = venv_pip(target)
    py = venv_python(target)

    if fresh_install:
        emit("Upgrading pip")
        run_step(
            "pip upgrade",
            [str(pip), "install", "--quiet", "--upgrade", "pip"],
            hint="Usually a network issue.",
        )

        emit("Installing speech + embedding libraries (largest step — PyTorch is ~250 MB)")
    else:
        emit("Syncing dependencies")

    run_step(
        "pip install",
        [str(pip), "install", "--quiet", *INSTALL_SPECS],
        hint="Common causes: corporate proxy, antivirus blocking, or a temporary PyPI outage.",
    )

    # Extract the bundled HF model cache into <userData>/hf-cache. The
    # tarball sits next to this script in the .app bundle (read-only on
    # macOS notarised builds, hence we extract elsewhere). Idempotent —
    # skip when the cache is already populated.
    bundle_dir = Path(__file__).resolve().parent
    models_tar = bundle_dir / "models.tar.gz"
    hf_cache_dir = target.parent / "hf-cache"
    hf_cache_marker = hf_cache_dir / "hub"
    if models_tar.exists() and not hf_cache_marker.exists():
        emit("Extracting bundled model cache (one-time, ~400 MB on disk)")
        hf_cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            with tarfile.open(models_tar, "r:gz") as tf:
                # tar was created from inside embedded-server/, so members are
                # 'models/...'. We strip the leading 'models/' so they land
                # directly under hf-cache/.
                for member in tf.getmembers():
                    if member.name.startswith("models/"):
                        member.name = member.name[len("models/"):]
                    if not member.name:
                        continue
                    tf.extract(member, hf_cache_dir, filter="data")
            _log(f"Extracted {models_tar} -> {hf_cache_dir}")
        except Exception as e:
            fail(
                f"Failed to extract model cache: {e}",
                1,
            )
    elif not models_tar.exists() and not hf_cache_marker.exists():
        _log(f"WARNING: no models.tar.gz at {models_tar} and no existing cache. Pyannote/whisper will need network on first use.")

    emit("Verifying installation")
    run_step(
        "verification import",
        [
            str(py),
            "-c",
            "from speech_analyser import SpeechAnalyser; "
            "from pyannote.audio import Pipeline; "
            "from sentence_transformers import SentenceTransformer; "
            "print('OK')",
        ],
        hint=(
            "This usually means a native library refused to load under macOS "
            "hardened runtime — see logs/setup.log for the dlopen error. "
            "Try deleting the venv folder and relaunching."
        ),
    )

    emit("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
