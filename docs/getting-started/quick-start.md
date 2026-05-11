# Quick Start

The speed-run version of getting productive with Debrief. If you've already read [First Use](first-use.md), skip straight to Step 1.

**Time needed:** about 5 minutes once the speech analysis engine is installed (a one-time ~5–15 minute setup happens on first launch).

## Step 0 — First-launch setup (one time)

The first time you open Debrief, a **First-time setup** modal walks through installing the speech analysis engine into your user-data folder (`~/Library/Application Support/debrief/venv/` on macOS). Roughly **1 GB on disk**, **3–10 minutes** depending on your connection. You can keep using settings + library while it runs; transcription becomes available once setup completes.

You only do this once. Subsequent launches are instant.

## Step 1 — Point Debrief at an LLM

Open **Settings → Processing → AI Analysis Service**. Everything after transcription (summary, themes, action items, chat) needs a language model.

- **Stay private** — install [Ollama](https://ollama.com) and run `ollama pull llama3.2:3b`. Leave the provider set to Ollama. Nothing leaves your machine.
- **Want more power** — switch to OpenAI, Anthropic, Groq, Gemini, OpenRouter, or a custom endpoint. Paste the API key. A "☁ Cloud" banner reminds you transcripts will be sent to that provider.

Click **Test Connection**, then **Refresh Models** and pick one. That's it.

## Step 2 — Upload a file

Click **Upload & Process** in the sidebar. Drag an audio or video file into the dropzone (MP3, WAV, M4A, OGG, MP4, MOV, WebM, FLAC — most formats work). Optionally assign it to a project. Click **Upload & Process**.

Debrief will:

1. Decode the audio
2. Transcribe via the local sidecar (faster-whisper)
3. Detect speakers via pyannote 3.1 (local, if enabled)
4. Run AI analysis for summary, themes, sentiment, action items
5. Save everything to the Library

You can navigate away — processing continues in the background. A toast tells you when it's done.

## Step 3 — Read the results

Click the transcript in the **Library**. The detail page has:

- **Overview** — summary, key topics, action items, sentiment, notable quotes
- **Transcript** — the full text with speaker tags and timestamps; click a line to jump the audio player to that point
- **Analysis** — deeper research views (themes, Q&A pairs, concept frequency, speaker talk-time)
- **Chat** — ask questions about the content

If you need to rename speakers or fix diarisation mistakes, open **Speaker Tagging** from the transcript detail page.

## Step 4 — Organise with projects

Projects let you analyse multiple recordings together.

1. Sidebar → **Projects** → **New Project**
2. Give it a name, optional description, colour, icon
3. Open the project and click **Add Transcripts** to include recordings from the Library
4. Use the project's **Insights**, **Cross-transcript Search**, and **Chat** tabs to work across the whole set

A project's chat has access to every transcript in the project at once — good for questions like "which interviews mentioned the Q3 roadmap?".

## Step 5 — Export

From any transcript detail page, click **Export** to save as Markdown, TXT, JSON, or PDF. Projects have their own export with multi-transcript analysis bundled in.

## Tips

- **Start with short files** while you're learning. A 2-minute recording gives you the full workflow in about a minute of processing on an M-series Mac.
- **Defaults are sensible.** Local sidecar + Ollama + speaker detection is a reasonable starting point for most users.
- **Settings save immediately.** No Save button.
- **Watch the status pill** (bottom-right of the window) for sidecar health. Green = ready, blue = setup in progress, red = check connection or click to retry.
- **Press `Cmd/Ctrl + ?`** anytime for the full keyboard shortcuts list.

## Next steps

- [Interface Overview](../user-guide/interface-overview.md) — full tour of the window
- [Managing Transcripts](../user-guide/managing-transcripts.md) — library, archive, trash, bulk ops
- [Projects](../user-guide/projects.md) — cross-transcript analysis
- [Analysis](../features/analysis.md) — what each analysis view means
- [AI Chat](../features/ai-chat.md) — the three chat modes explained
- [Troubleshooting](../troubleshooting/common-issues.md) — if something misbehaves
