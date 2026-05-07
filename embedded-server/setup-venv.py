"""First-launch setup: create the user-data venv and pip install speech-analyser.

Run by SidecarManager when the venv is missing. Emits 'STEP: <message>' lines
on stdout so the renderer can show progress in <FirstLaunchSetup>; emits
'ERROR: <message>' on failure.
"""
import os
import subprocess
import sys
from pathlib import Path

# Same pin we publish to PyPI. Bump in lockstep with speech-analyser releases.
SPEECH_ANALYSER_PIN = "speech-analyser[diarization]>=0.2.0"


def user_data_dir() -> Path:
    """Mirror Electron's app.getPath('userData') across platforms."""
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "deep-talk"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", str(home / "AppData" / "Roaming"))) / "deep-talk"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config"))) / "deep-talk"


def venv_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def venv_pip(venv: Path) -> Path:
    return venv / ("Scripts/pip.exe" if sys.platform == "win32" else "bin/pip")


def emit(step: str) -> None:
    print(f"STEP: {step}", flush=True)


def fail(message: str, code: int = 1) -> "None":
    print(f"ERROR: {message}", flush=True)
    sys.exit(code)


def main() -> int:
    # Allow the SidecarManager (and tests) to override the target via env.
    target = Path(os.environ["DEEP_TALK_VENV"]) if "DEEP_TALK_VENV" in os.environ \
        else user_data_dir() / "venv"

    if target.exists() and venv_python(target).exists():
        emit("Venv already present; skipping setup")
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)

    emit(f"Creating Python environment at {target}")
    try:
        subprocess.run([sys.executable, "-m", "venv", str(target)], check=True)
    except subprocess.CalledProcessError as e:
        fail(f"venv creation failed (exit {e.returncode})", e.returncode)

    pip = venv_pip(target)
    py = venv_python(target)

    emit("Upgrading pip")
    try:
        subprocess.run([str(pip), "install", "--quiet", "--upgrade", "pip"], check=True)
    except subprocess.CalledProcessError as e:
        fail(f"pip upgrade failed (exit {e.returncode})", e.returncode)

    emit("Installing speech analysis libraries (largest step — PyTorch is ~250 MB)")
    try:
        subprocess.run([str(pip), "install", "--quiet", SPEECH_ANALYSER_PIN], check=True)
    except subprocess.CalledProcessError as e:
        fail(
            "pip install of speech-analyser failed. Check your internet connection "
            f"and try again (exit {e.returncode})",
            e.returncode,
        )

    emit("Verifying installation")
    try:
        subprocess.run(
            [
                str(py),
                "-c",
                "from speech_analyser import SpeechAnalyser; "
                "from pyannote.audio import Pipeline; "
                "print('OK')",
            ],
            check=True,
        )
    except subprocess.CalledProcessError as e:
        fail(f"verification import failed (exit {e.returncode})", e.returncode)

    emit("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
