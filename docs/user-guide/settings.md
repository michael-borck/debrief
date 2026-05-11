# Settings

The Settings page (sidebar → **Settings**) is organised into five tabs. This page covers everything in each one.

## Transcription

Where you choose which Whisper model runs locally to turn audio into text.

### Transcription Model

Three model options. All English-only. All run entirely on your machine — no network calls during transcription.

| Model | Size | Speed | Best for |
|---|---|---|---|
| **Tiny (English)** | ~75 MB | Fastest (~2-3× realtime on M-series) | Quick drafts, short clips, slow hardware |
| **Base (English)** | ~140 MB | Balanced | Most users, most recordings |
| **Small (English)** | ~470 MB | Slower | Highest accuracy in this set |

The first time you transcribe with a model, Debrief downloads it to your user data folder (`~/Library/Application Support/debrief/models/` on macOS, equivalents on Windows/Linux) and caches it forever. Subsequent transcriptions just use the cached model — no download, no network.

### Download model now

Optional button. Pre-fetches the chosen model so the first transcription doesn't pay the download cost. Useful if you want to be ready to work offline.

## Processing

Settings for everything that happens after transcription: speaker detection, AI analysis, transcript correction.

### AI Analysis Service

The one piece that's not local by default. Debrief needs an LLM for summaries, sentiment analysis, themes, action items, and AI Chat.

**Provider** dropdown — pick from:

| Provider | Privacy | Notes |
|---|---|---|
| **Ollama (local)** | 🔒 Private | Runs on your computer. Install [Ollama](https://ollama.com) separately. |
| **OpenAI** | ☁ Cloud | GPT-4, GPT-4o, o1. Requires API key. |
| **Anthropic (Claude)** | ☁ Cloud | Claude Sonnet, Opus, Haiku. Requires API key. |
| **Google Gemini** | ☁ Cloud | Gemini 1.5 Pro, Flash. Requires API key. |
| **Groq** | ☁ Cloud | Fast inference for Llama, Mixtral, Gemma. Requires API key. |
| **OpenRouter** | ☁ Cloud | Gateway to hundreds of models. Requires API key. |
| **Custom** | depends | Any OpenAI-compatible HTTP endpoint. |

A coloured banner under the dropdown reminds you which mode you're in (green for Private, amber for Cloud) so you never accidentally send transcripts to a server you didn't intend.

**Server URL** auto-fills with the provider's default but stays editable for custom Ollama ports, WSL setups, enterprise proxies, etc.

**API Key** field appears only for cloud providers. Stored encrypted via your OS keychain (macOS Keychain, Windows DPAPI, libsecret on Linux). Never logged. On Linux machines without a keyring service, Debrief falls back to plain text and warns you.

**Test Connection** runs a cheap probe (lists models) to verify the URL and key work.

**Refresh Models** populates a real model dropdown from the provider. Pick whichever one you want to use.

### Detect speakers from audio

Toggle for the diarisation pipeline. On by default.

When on, after Whisper finishes, Debrief runs:

1. **Pyannote segmentation** to find speech regions and local speaker activity in 5-second windows
2. **Wespeaker** to compute a 256-dimensional voice fingerprint for each turn
3. **Agglomerative clustering** to assign global speaker labels across the whole recording

Adds about 1× the audio length to processing time. Turn it off for single-speaker recordings to save time.

**Advanced diarisation tuning** (collapsible) — exposes the pipeline's tunables as sliders: cluster similarity threshold, median filter frames, min turn duration, min gap to split, noise cluster minimum. Defaults are validated across clean, noisy, and multi-speaker recordings — only touch these if the pipeline misbehaves on a specific file. Click **Reset to defaults** to revert.

### AI token usage

Two counters of how many tokens your AI provider has consumed, both broken down by provider and model:

- **This session** — resets when Debrief restarts, or manually via the Reset session button
- **Lifetime** — persisted across restarts; reset only when you explicitly click Reset lifetime (with a confirmation)

Local providers (Ollama) report tokens but no cost. Hosted providers may charge per token — check your provider's pricing page.

### Transcript correction

Optional AI cleanup of spelling, grammar, punctuation, and capitalisation. Enabled by default. The original transcript is preserved alongside the corrected version — you can switch between them on the transcript detail page.

The "Correction Options" sub-checkboxes let you turn off specific categories (e.g. correct spelling but leave punctuation alone).

### Remove duplicate sentences

When transcription windows overlap, you can sometimes get the same sentence twice. This option detects and removes duplicates. On by default.

## Chat

Settings for the in-app AI Chat feature.

### Conversation Mode

Three options:

- **Quote Lookup** — returns relevant excerpts from your transcripts directly, with no AI rewriting. Fastest, most factual. Best for finding specific information.
- **Smart Search (Recommended)** — retrieves the most relevant chunks and sends them to the AI for interpretation. Best balance of speed and quality. Default.
- **Full Transcript** — sends the entire transcript to the AI for comprehensive analysis. Slowest, most thorough. Best for deep questions where you need full context.

### Advanced Chat Settings (collapsed)

Click to expand. Most users never need to touch these:

- **Context Chunks** — how many transcript chunks to include in chat context (default 4)
- **Chunking Method** — speaker-based / time-based / hybrid (default speaker)
- **Max Chunk Size** — duration cap per chunk in seconds (default 60)
- **Chunk Overlap** — seconds of overlap between chunks (default 10)
- **Conversation Memory Limit** — how many messages to remember before compacting history (default 20)

## AI Prompts

Customise the prompts Debrief sends to the AI for each analysis task (summaries, sentiment, themes, etc.). Each prompt has a default that's restored if you delete your customisation.

You can edit a prompt's text directly. Variables like `{transcript}` get filled in at runtime. Useful if you want the AI to focus on specific aspects of your recordings (e.g. "always look for action items related to project deadlines").

## General

### Storage & Backup

- **Database location** — where Debrief stores its SQLite database. You can change it (move to an external drive, sync folder, etc.) and the app will move the file for you.
- **Open Folder** — opens the database directory in Finder/Explorer.
- **Backup Now** — creates an immediate backup.
- **Auto-backup** — periodic backups on a schedule (daily/weekly/monthly).

### Chat Search Index (collapsed)

The vector embeddings Debrief uses to power chat search. Reset only if you experience chat issues. Most users never need this.

- **Reset Search Index** — clears all embeddings. The next chat will re-index.
- **View Statistics** — shows index size and per-transcript chunk counts.

### Appearance

- **Theme** — Light / Dark / System. Currently System default.

### Privacy

A reminder of what stays local and what doesn't:

> Debrief stores all data locally on your computer. No data is sent to external services except for transcription and analysis processing through your configured services.

(Transcription is now always local — that line predates the local Whisper migration. It'll be updated in a future release.)

## Tips

- **Start with defaults.** Tiny.en + Ollama local + speaker detection on works well for most cases.
- **If you upgrade your AI**, also try a better Whisper model — the bottleneck for "good summaries" is sometimes transcript quality, not the LLM.
- **API keys are encrypted at rest** via your OS keychain. On Linux without a keyring service Debrief falls back to plain text — use Ollama on shared machines if that matters.
- **Settings save immediately.** No "Save" button — every toggle and dropdown writes to the database as you change it.
