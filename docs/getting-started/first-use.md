# First Use

Welcome to Debrief. This page walks you through what you'll see the first time you launch the app and the small amount of configuration that's worth doing up front.

## Your first launch

When Debrief opens, the **First-time setup** modal appears in front of the Dashboard. The bundled Python runtime needs to lay down the speech analysis engine (pyannote + faster-whisper, ~1 GB on disk) into your user-data folder. The modal walks through it step-by-step — typically 3–10 minutes depending on your connection. You can keep clicking around settings and the library while it runs; features that need transcription become available once setup completes.

You only see this modal on first launch. Subsequent launches are instant.

After setup completes you'll land on the **Dashboard**. Everything is local to your machine — no account, no sign-in, no cloud sync.

The sidebar on the left gives you everything you need:

- **Dashboard** — recent transcripts, recent projects, activity stats
- **Upload & Process** — drag a file in or click to browse
- **Projects** — group recordings for cross-recording analysis
- **Library** — every transcript you've made
- **Settings** — sidecar status, AI provider, processing options
- **Search & Filter** — find anything across transcripts
- **Chat History** — past AI conversations
- **Trash** / **Archive** — soft-deleted and archived items
- **Documentation** — the docs you're reading right now
- **Keyboard Shortcuts** — quick reference
- **Help & Support** — troubleshooting

A small pill at the bottom-right of the window shows the sidecar status (green = ready, blue = setup in progress, red = failed — click to retry).

## Privacy story (read this once, never worry again)

Debrief's pitch is "privacy-first local desktop". Here's exactly what that means:

- **Transcription runs on your computer.** Debrief ships a sandboxed Python sidecar (`lens/speech-analyser`) that wraps `faster-whisper`. The whisper model weights are bundled inside the installer, so transcription works fully offline once first-launch setup is done.
- **Speaker identification runs on your computer.** `pyannote.audio` 3.1 runs inside the same sidecar. The model weights (segmentation, embedding, clustering — all MIT- or CC-BY-licensed) are also bundled inside the installer. No HuggingFace token, no model download at runtime.
- **AI analysis is configurable.** By default, Debrief talks to a local Ollama instance — also on your machine. You can switch to a cloud provider (OpenAI, Anthropic, Groq, Gemini, OpenRouter, or any custom endpoint) in Settings if you want access to more powerful models. When you do, transcripts are sent to that provider for analysis. The app warns you with a "☁ Cloud" badge so you always know which mode you're in.
- **Storage is a local SQLite database.** Everything you produce — transcripts, analysis, projects, chat history — lives on disk in your user-data folder. Never uploaded anywhere by Debrief.

## A 3-minute first-time setup

You can skip this entirely and just start uploading files — the defaults are sensible. But if you want to tune things, here are the two settings worth checking.

### 1. Decide on speaker detection (Settings → Processing)

The **Detect speakers from audio** toggle controls whether Debrief asks the sidecar to run diarisation alongside transcription. It's on by default. Adds about 1× the audio length to processing time — turn it off for known single-speaker recordings to save time.

### 2. Connect an AI analysis service (Settings → Processing → AI Analysis Service)

This is the one piece that's not local by default. Debrief needs an LLM to produce summaries, sentiment, themes, and to power AI Chat. Pick a provider:

- **Ollama (local)** — install [Ollama](https://ollama.com/) separately and run something like `ollama pull llama3.2:3b`. Stays on your machine. Recommended if privacy matters.
- **OpenAI / Anthropic / Groq / Gemini / OpenRouter** — paste an API key. Faster, smarter, but transcripts get sent to the provider's servers.
- **Custom** — any OpenAI-compatible HTTP endpoint.

Click **Test Connection** to verify it works, then **Refresh Models** to populate the model dropdown.

## Your first transcript

Once the basics are set:

1. Click **Upload & Process** in the sidebar.
2. Drag an audio or video file into the dropzone, or click to browse.
3. Optionally pick a project to assign it to (you can also assign later).
4. Click **Upload & Process**.

Debrief will:

1. Decode the audio (any common format works — MP3, WAV, MP4, MOV, M4A, WebM, OGG, and more)
2. POST the audio to the local sidecar's `/analyse` endpoint
3. The sidecar runs faster-whisper for transcription and pyannote for diarisation (if enabled)
4. Run AI analysis for summary, themes, sentiment, etc.
5. Save everything to the library and show a success toast

Click the new transcript in the Library to see the results.

## What's next?

- [Interface Overview](../user-guide/interface-overview.md) — full tour of the window
- [Uploading Files](../user-guide/uploading-files.md) — upload, drag-drop, and bulk operations
- [Settings](../user-guide/settings.md) — every setting explained
- [Transcription & Diarisation](../features/transcription.md) — how the audio pipeline works
- [Quick Start](quick-start.md) — the speed-run version of this page

If something doesn't work, check [Common Issues](../troubleshooting/common-issues.md).
