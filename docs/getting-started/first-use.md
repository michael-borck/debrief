# First Use

Welcome to Debrief. This page walks you through what you'll see the first time you launch the app and the small amount of configuration that's worth doing up front.

## Your first launch

When Debrief opens, you'll land on the **Dashboard**. Everything is local to your machine — no account, no sign-in, no cloud sync.

The sidebar on the left gives you everything you need:

- **Dashboard** — recent transcripts, recent projects, activity stats
- **Upload & Process** — drag a file in or click to browse
- **Projects** — group recordings for cross-recording analysis
- **Library** — every transcript you've made
- **Settings** — model picker, AI provider, processing options
- **Search & Filter** — find anything across transcripts
- **Chat History** — past AI conversations
- **Trash** / **Archive** — soft-deleted and archived items
- **Documentation** — the docs you're reading right now
- **Keyboard Shortcuts** — quick reference
- **Help & Support** — troubleshooting

At the bottom of the window you'll see a status bar reporting whether the AI analysis service is reachable. Speech-to-text runs locally so it's always "connected".

## Privacy story (read this once, never worry again)

Debrief's pitch is "privacy-first local desktop". Here's exactly what that means:

- **Transcription runs on your computer.** Debrief uses Whisper through `@huggingface/transformers`. The model downloads once on first use (~75 MB for the default `tiny.en` model) and is cached locally. After that, transcribing a file makes **zero network calls**.
- **Speaker identification runs on your computer.** Pyannote segmentation and wespeaker embedding are also local models, downloaded on first use and cached.
- **AI analysis is configurable.** By default, Debrief talks to a local Ollama instance — also on your machine. You can switch to a cloud provider (OpenAI, Anthropic, Groq, Gemini, OpenRouter, or any custom endpoint) in Settings if you want access to more powerful models. When you do, transcripts are sent to that provider for analysis. The app warns you with a "☁ Cloud" badge so you always know which mode you're in.
- **Storage is a local SQLite database.** Everything you produce — transcripts, analysis, projects, chat history — lives on disk in your user data folder. Never uploaded anywhere by Debrief.

## A 5-minute first-time setup

You can skip this entirely and just start uploading files — the defaults are sensible. But if you want to tune things, here are the three settings worth checking.

### 1. Pick a transcription model (Settings → Transcription)

Three options:

| Model | Size | Speed | When to pick |
|---|---|---|---|
| **Tiny (English)** | ~75 MB | Fastest | Default. Quick drafts, short clips. Lower accuracy on noisy or accented speech. |
| **Base (English)** | ~140 MB | Balanced | Most users. Noticeably more accurate than Tiny, still fast on most laptops. |
| **Small (English)** | ~470 MB | Slower | Best accuracy in this set. Pick if you have a fast machine and want the cleanest transcripts. |

Click **Download** to fetch the model immediately. Otherwise it'll download automatically the first time you transcribe a file.

### 2. Decide on speaker detection (Settings → Processing)

The **Detect speakers from audio** toggle controls whether Debrief runs the diarisation pipeline (pyannote + wespeaker). It's on by default. Adds about 1× the audio length to processing time — turn it off for single-speaker recordings to save time.

### 3. Connect an AI analysis service (Settings → Processing → AI Analysis Service)

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
2. Run Whisper for transcription
3. Run pyannote + wespeaker for diarisation (if enabled)
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
