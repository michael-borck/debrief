# System Requirements

Hardware, OS, and runtime requirements for Debrief.

## Operating system

| Platform | Minimum | Recommended |
|---|---|---|
| **macOS** | macOS 11 Big Sur | macOS 13 Ventura or later |
| **Windows** | Windows 10 (64-bit) | Windows 11 |
| **Linux** | Ubuntu 20.04 or equivalent (glibc 2.31+) | Recent mainstream distro |

Debrief is built on Electron, so anything that runs recent Chrome and Node.js will run Debrief.

## CPU

Debrief runs all ML inference (Whisper, pyannote, wespeaker, embeddings) on the CPU. There's no GPU acceleration in the current build.

| Hardware class | Performance |
|---|---|
| **Apple Silicon (M1/M2/M3/M4)** | Excellent. Tiny.en at 2-3× realtime, diarisation pipeline fast. |
| **Recent Intel / AMD x86 (2020+, 6+ cores)** | Good. Tiny.en at ~1.5× realtime, diarisation comfortable. |
| **Older Intel / AMD x86 (2017 or earlier, 4 cores)** | Acceptable for short recordings. Use tiny.en, consider disabling diarisation. |
| **Low-power ARM (Raspberry Pi, ChromeOS Flex)** | Not recommended — inference is too slow for practical use. |

On Apple Silicon you can comfortably run the Small.en model and diarisation together. On older Intel hardware, stick with Tiny.en and turn off speaker detection for single-speaker recordings.

## Memory (RAM)

| Use case | Minimum | Recommended |
|---|---|---|
| **Idle Debrief** | 500 MB | — |
| **Sidecar idle** | +200 MB | — |
| **Tiny.en transcription** | 1.5 GB free | 2.5 GB free |
| **Base transcription** *(default)* | 2 GB free | 3 GB free |
| **Small transcription** | 2.5 GB free | 3.5 GB free |
| **Diarisation added** | +1 GB | +1 GB |
| **Ollama model running alongside** | 4–8 GB free for the model itself | 8 GB+ |

The sidecar process holds PyTorch + faster-whisper + pyannote in memory while inference is running. Memory drops back to a few hundred MB when idle.

If you're running local Ollama in parallel, that model needs its own memory — a 3B model needs ~2–4 GB, an 8B model needs ~5–8 GB, a 14B model needs ~10–14 GB. Plan accordingly.

Minimum total system RAM to run Debrief comfortably: **6 GB**. Recommended: **8 GB+**. If you want cloud-class AI locally (bigger Ollama models): **16 GB+**.

## Disk space

| Component | Size |
|---|---|
| Debrief application (installer) | ~600 MB |
| First-launch sidecar venv (PyTorch + pyannote + faster-whisper) | ~1 GB |
| Bundled pyannote + wespeaker + faster-whisper-base model weights | ~200 MB |
| Other Whisper models (downloaded on demand if you change the default) | tiny.en ~75 MB / small ~470 MB / large-v3 ~3 GB |
| SQLite database | KB per transcript (scales with library size) |
| Automated backups | Optional, configurable retention |

**Minimum free disk space at install time**: 3 GB (installer + first-launch venv + bundled models + working room).
**Recommended**: 10+ GB (room for a larger Whisper model, a growing library, and backups).

## Network

Debrief needs network access for:

- Downloading Whisper / pyannote / wespeaker models the first time you use each (one-time)
- Talking to cloud AI providers if you pick one (OpenAI, Anthropic, etc.)
- Talking to a local Ollama server if it's running on a different host
- Checking for updates (manual, not automatic in the current build)

Once models are cached and you're using local Ollama, Debrief can run fully offline.

## Display

- **Minimum resolution**: 1280×720
- **Recommended resolution**: 1440×900 or larger
- **High-DPI displays**: fully supported on macOS, Windows, and Linux

The transcript detail page benefits from wider screens because of the tab layout and sidebar panels. 13" laptops work fine; larger screens let you see more at once.

## Audio hardware

Not required to run Debrief — it only processes files you've already recorded. For playback in the transcript detail page, any working audio output works.

## Optional dependencies

These aren't bundled with Debrief but enable specific features:

### Ollama (for local AI)

Install separately from [ollama.com](https://ollama.com). Pull at least one model:

```bash
ollama pull llama3.2:3b
```

Runs as a background service on `localhost:11434` by default. Debrief auto-detects it.

### Linux keyring service

For encrypted API key storage on Linux, install one of:

- GNOME Keyring (default on GNOME desktops)
- KWallet (default on KDE)
- Any other `libsecret` provider

Without a keyring, Debrief falls back to plain-text key storage with a warning.

### FFmpeg

Bundled with Debrief. You don't need a separate install.

## Not required

- **No account or sign-in.** Debrief has no cloud component.
- **No GPU.** All inference runs on CPU in the current build.
- **No separate Python install.** A relocatable CPython 3.13 runtime ships inside the installer, and the speech analysis engine installs into your user-data folder on first launch.
- **No Docker.** Just install the app.

## Next steps

- [Installation](../getting-started/installation.md) — platform-specific install steps
- [First Use](../getting-started/first-use.md) — initial setup
- [Common Issues](../troubleshooting/common-issues.md) — performance tuning and fixes
