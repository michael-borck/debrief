# Installation

DeepDebrief is a desktop Electron app. There are prebuilt installers for macOS, Windows, and Linux on the [Releases page](https://github.com/michael-borck/deep-debrief/releases).

## System requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | macOS 11, Windows 10, Ubuntu 20.04 (or equivalent) | macOS 13+, Windows 11, recent Linux |
| **CPU** | Any 64-bit x86 or Apple Silicon | Apple Silicon (M1/M2/M3/M4) or recent Intel/AMD |
| **RAM** | 4 GB | 8 GB+ |
| **Disk** | 2 GB free | 10 GB+ (for models and your transcript library) |
| **GPU** | Not required | Not used — all inference is CPU-only in the current build |

Apple Silicon Macs are by far the fastest platform for local transcription and diarisation. Intel Macs and older x86 Linux laptops work but are noticeably slower.

## macOS

1. Download the `.dmg` from the Releases page.
2. Open it and drag **DeepDebrief** into Applications.
3. Launch it from Applications or Spotlight.

DeepDebrief is code-signed and notarised, so macOS Gatekeeper accepts it without warnings. If you see a "damaged" error, you're likely running an unsigned nightly — right-click the app → Open the first time.

## Windows

1. Download the `.exe` installer from the Releases page.
2. Run it. Windows SmartScreen may prompt — click **More info** → **Run anyway** if the publisher is recognised.
3. Launch **DeepDebrief** from the Start menu.

Data lives in `%APPDATA%\deep-debrief` by default. You can move it from **Settings → General → Storage & Backup**.

## Linux

Download the `.AppImage` from the Releases page:

```bash
chmod +x DeepDebrief-*.AppImage
./DeepDebrief-*.AppImage
```

Or the `.deb` on Debian/Ubuntu:

```bash
sudo dpkg -i deep-debrief_*.deb
```

On Linux, API key encryption requires a running keyring service (`libsecret` via GNOME Keyring or KWallet). Without one, DeepDebrief falls back to storing keys as plain text — fine for personal machines, not for shared workstations.

## What gets installed where

| Platform | App binary | User data |
|---|---|---|
| macOS | `/Applications/DeepDebrief.app` | `~/Library/Application Support/deep-debrief/` |
| Windows | `C:\Users\<you>\AppData\Local\Programs\deep-debrief\` | `%APPDATA%\deep-debrief\` |
| Linux | `/opt/DeepDebrief/` or AppImage mount point | `~/.config/deep-debrief/` |

User data includes:

- `deepdebrief.db` — the SQLite database (transcripts, projects, settings, chat history)
- `models/` — cached Whisper, pyannote, and wespeaker model files
- `backups/` — automated backups, if auto-backup is enabled

You can change the database location from **Settings → General → Storage & Backup → Database location**. The app will move the file for you.

## Optional: install Ollama for local AI analysis

DeepDebrief's AI analysis (summaries, themes, chat) needs a language model. The privacy-preserving default is [Ollama](https://ollama.com), which also runs on your machine.

1. Download Ollama from [ollama.com](https://ollama.com) and install it.
2. Pull a model from a terminal:

   ```bash
   ollama pull llama3.2:3b
   ```

   A 3B-parameter model is plenty for summaries and chat on most machines. Pull something bigger (`llama3.1:8b`, `qwen2.5:14b`) if you have the RAM.

3. Leave DeepDebrief's AI provider set to **Ollama (local)** in Settings. The default URL (`http://localhost:11434/v1`) will just work.

If you'd rather use a cloud provider (OpenAI, Anthropic, Groq, Gemini, OpenRouter), skip Ollama entirely and configure the provider in Settings.

## First launch

On first run DeepDebrief shows a welcome modal explaining the privacy model and linking to this quick-start. Dismiss it once — it won't show again unless you clear browser storage or upgrade to a major new release.

The first time you transcribe anything, DeepDebrief downloads the Whisper model you selected (~75-470 MB). The first time you enable speaker detection, it also downloads pyannote + wespeaker (~30 MB combined). Both happen in the background with progress notifications. After that, everything is cached — no further downloads, no network calls during transcription.

## Uninstalling

- **macOS** — drag the app to Trash. Remove `~/Library/Application Support/deep-debrief/` to delete data.
- **Windows** — use Settings → Apps, or the uninstaller in the install directory. Remove `%APPDATA%\deep-debrief\` to delete data.
- **Linux** — `sudo dpkg -r deep-debrief` or delete the AppImage. Remove `~/.config/deep-debrief/` to delete data.

## Next steps

- [First Use](first-use.md) — what you'll see on launch
- [Quick Start](quick-start.md) — your first transcript in 10 minutes
- [Settings](../user-guide/settings.md) — every setting explained
