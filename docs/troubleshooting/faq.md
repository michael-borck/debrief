# FAQ

Quick answers to the questions people ask most. For longer explanations, see [Common Issues](common-issues.md).

## Privacy and data

### Does DeepDebrief send my recordings to the cloud?

**Transcription and speaker detection: no, never.** Both run locally via Whisper, pyannote, and wespeaker. No network calls after the initial model download.

**AI analysis: depends on your provider.** If you use Ollama (local), nothing leaves your machine. If you pick a cloud provider (OpenAI, Anthropic, Groq, Gemini, OpenRouter), transcripts are sent to that provider for analysis. A banner in Settings reminds you which mode you're in.

### Where is my data stored?

Locally, in SQLite. Default locations:

- **macOS**: `~/Library/Application Support/deep-debrief/deepdebrief.db`
- **Windows**: `%APPDATA%\deep-debrief\deepdebrief.db`
- **Linux**: `~/.config/deep-debrief/deepdebrief.db`

You can move it to any folder you like in **Settings → General → Storage & Backup**.

### Are API keys safe?

Yes. DeepDebrief encrypts API keys using your OS keychain (macOS Keychain, Windows DPAPI, libsecret on Linux). The keys never leave your machine except when being sent to the provider you configured them for.

On Linux without a keyring service, DeepDebrief falls back to plain text and logs a warning.

### Can I use DeepDebrief offline?

Yes, after the first model download. Transcription, diarisation, transcript editing, library management, and Ollama-based AI all work offline.

You need a connection only for:

- First-time Whisper/pyannote/wespeaker model downloads
- Cloud AI providers (OpenAI, Anthropic, etc.)
- The in-app documentation search is local, but linked GitHub pages aren't

## Features

### What file formats does DeepDebrief support?

Anything ffmpeg can decode, including:

- **Audio**: MP3, WAV, M4A, AAC, OGG, FLAC, OPUS, WMA
- **Video**: MP4, MOV, MKV, WebM, AVI, FLV

DeepDebrief extracts the audio track from video files automatically.

### How accurate is transcription?

Depends on the model and the audio. Rough guide on clean English speech:

- **Tiny.en** — ~85% word accuracy
- **Base.en** — ~90%
- **Small.en** — ~93%

Noisy audio, heavy accents, or overlapping speech drop these noticeably. Technical jargon the model hasn't seen often gets garbled.

### How does speaker detection work?

Two models run together: pyannote-segmentation-3.0 finds speech regions and local speaker activity, wespeaker-voxceleb-resnet34-LM computes a 256-dimensional voice fingerprint for each turn, and agglomerative clustering assigns global speaker labels.

See [Transcription & Diarisation](../features/transcription.md) for the full pipeline.

### Can I edit the transcript?

Yes. Click **Edit Transcript** on the detail page. The sentence editor lets you fix recognition errors. The original transcript is preserved — your edits are versioned.

### Can I rename or merge speakers?

Yes. Click **Speaker Tagging** on the transcript detail page. You can rename speakers, merge duplicates, or ask the AI to suggest meaningful labels.

### What's the difference between the three chat modes?

- **Quote Lookup** — returns literal passages, no AI rewriting
- **Smart Search** — retrieves relevant chunks and lets the AI interpret them (default)
- **Full Transcript** — sends the whole transcript to the AI for deep synthesis

Set in **Settings → Chat → Conversation Mode**.

### Can I customise the AI prompts?

Yes. **Settings → AI Prompts** lets you edit the prompt used for each analysis task (summary, themes, sentiment, action items, etc.). Each prompt has a default you can restore.

### Can I work across multiple transcripts?

Yes — create a **project** and add transcripts to it. Projects give you cross-transcript analysis, cross-transcript search, and project-scoped AI chat. See [Projects](../user-guide/projects.md).

## Performance

### Why is it slow on my machine?

Most likely because you're on Intel x86 or older Linux hardware. Apple Silicon is in a different performance class for local inference. Options:

- Use a smaller Whisper model (Tiny.en is fast everywhere)
- Turn off speaker detection for single-speaker recordings
- Use a cloud AI provider instead of local Ollama

### How much RAM does DeepDebrief use?

Idle: ~200 MB. During transcription with tiny.en: ~400-500 MB. Small.en + diarisation: up to ~1 GB transient. The models stay loaded between runs for speed, so expect DeepDebrief to sit at a few hundred MB of resident memory after warming up.

### How much disk does it use?

- Application binary: ~300 MB
- Downloaded models: up to ~500 MB total if you use all three Whisper sizes plus diarisation
- Database: tiny (KB per transcript; a large library is usually under 100 MB)
- Backups: whatever you let auto-backup keep

## AI providers

### Which AI provider should I pick?

- **Privacy-first, local**: Ollama. Install separately, pull a model (`ollama pull llama3.2:3b` is a sensible start). Slower and less capable than cloud models, but private and free.
- **Best quality**: OpenAI GPT-4-class or Anthropic Claude Sonnet/Opus. Needs an API key, transcripts get sent to the provider's servers.
- **Cheapest paid**: Groq for fast Llama/Mixtral at very low cost, or OpenRouter to shop across providers.

### Do I need OpenAI / Anthropic?

No. Ollama is fully supported and works for all features. Cloud providers are an upgrade for quality, not a requirement.

### Does DeepDebrief charge me anything?

No. DeepDebrief is free and open source. If you use a cloud AI provider, that provider charges you — DeepDebrief doesn't take a cut. Monitor your spend in **Settings → Processing → Session token usage**.

## Installation and updates

### How do I update DeepDebrief?

Download the latest release from [GitHub Releases](https://github.com/michael-borck/deep-debrief/releases) and install over the existing version. Your data stays put — DeepDebrief reads it from the user data folder on next launch.

Automatic updates are on the roadmap.

### Can I run multiple versions side by side?

Not really — they'd share the same user data folder. If you need to test a new version safely, move your database to a backup location first (**Settings → General → Storage & Backup → Backup Now**).

### What about Linux without a keyring?

DeepDebrief runs fine. API keys fall back to plain-text storage with a warning. If you're on a shared machine, install GNOME Keyring or KWallet first, or use Ollama to avoid storing any keys at all.

## Getting help

- [Common Issues](common-issues.md) — longer troubleshooting
- [GitHub Issues](https://github.com/michael-borck/deep-debrief/issues) — bug reports
- [GitHub Discussions](https://github.com/michael-borck/deep-debrief/discussions) — questions and community
