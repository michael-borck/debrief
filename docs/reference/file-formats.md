# File Formats

Reference for the input formats Debrief accepts and the output formats it can export.

## Input: audio and video

Debrief uses the bundled `ffmpeg` to decode input files, so anything `ffmpeg` can read works. In practice that includes every common audio and video format.

### Audio

| Format | Extension | Notes |
|---|---|---|
| MP3 | `.mp3` | Universally supported; most common input |
| WAV | `.wav` | Uncompressed; largest files |
| M4A | `.m4a` | Default for iPhone Voice Memos |
| AAC | `.aac` | Raw AAC streams |
| OGG Vorbis | `.ogg` | Open format |
| Opus | `.opus` | Modern codec, great quality at low bitrates |
| FLAC | `.flac` | Lossless; large |
| WMA | `.wma` | Older Windows format |

### Video

Debrief extracts the audio track from video files before transcribing.

| Format | Extension | Notes |
|---|---|---|
| MP4 | `.mp4` | Most common video format |
| QuickTime | `.mov` | macOS screen recordings |
| Matroska | `.mkv` | Common for downloaded video |
| WebM | `.webm` | Browser recordings |
| AVI | `.avi` | Older format |
| Flash Video | `.flv` | Legacy |

If a format isn't listed but `ffmpeg` supports it, Debrief will probably accept it too. Try the upload — if it fails, the error tells you what went wrong.

### What makes a good input file

- **Clear speech.** Distant microphones, background noise, and heavy reverb all hurt accuracy.
- **16 kHz or higher sample rate.** Whisper resamples everything to 16 kHz internally anyway, so there's no benefit to higher rates and lower rates lose information.
- **Mono or stereo.** Surround and multi-channel inputs get downmixed.
- **Reasonable length.** Whisper handles any length, but longer files take longer and may run into memory limits on small machines. Under 60 minutes is a comfortable range.

There's no hard file-size limit. Practical ceiling is your available RAM during processing.

## Output: export formats

The export modal (on any transcript or project detail page) offers:

### Markdown (`.md`)

Readable text with headings, tables, and lists. Good for:

- Copy-pasting into note-taking apps (Obsidian, Notion, Logseq)
- Version-controlled documentation
- Reading in any text editor

Structure: `# Title` / metadata block / `## Summary` / `## Transcript` / `## Analysis` sections. You pick which sections to include.

### Plain text (`.txt`)

Stripped-down version of the Markdown export — just the transcript content. Optionally includes speaker tags and timestamps. Useful for:

- Legal archives
- Email attachments
- Feeding into other text tools

### JSON (`.json`)

Structured data covering everything Debrief knows about the transcript:

- Transcript text (original, corrected, speaker-tagged versions)
- Segments with timestamps and speaker labels
- All analysis results (summary, themes, sentiment, Q&A pairs, etc.)
- Metadata (tags, rating, notes, duration, file size)

See the [Export schema](../features/export.md#json-export-schema) for the shape. Good for:

- Feeding data into other tools
- Custom reporting pipelines
- Longitudinal analysis

### PDF (`.pdf`)

Formatted document suitable for sharing with people who don't use Debrief. Good for:

- Research reports
- Meeting summaries for stakeholders
- Archival printouts

PDFs are rendered from the Markdown template, so the structure matches the Markdown export.

## Internal storage format

For reference — you rarely need to interact with this directly.

- **Database**: SQLite (`debrief.db`). Regular SQL tables for transcripts, segments, projects, chat history, settings, and AI prompts.
- **Vector store**: SQLite with a vector extension, used for chat and semantic search embeddings. Lives in the same user data folder.
- **Models**: ONNX format for Whisper, pyannote, and wespeaker. Cached in `models/` under the user data folder.

Database location and backup controls live in **Settings → General → Storage & Backup**.

## Supported AI model formats

Debrief doesn't load AI models itself (beyond the local transcription / diarisation / embedding models). For analysis and chat it talks to whichever AI provider you've configured:

- **Ollama** — any Ollama-hosted model via the `/v1/chat/completions` endpoint
- **OpenAI-compatible** — OpenAI, Groq, Gemini (via OpenAI-compat endpoint), OpenRouter, custom
- **Anthropic** — Claude models via the native `/v1/messages` API

You pick the specific model in **Settings → Processing → AI Analysis Service**. Whatever models your provider exposes will show up in the Refresh Models dropdown.

## Next steps

- [Transcription & Diarisation](../features/transcription.md) — how audio is processed
- [Export](../features/export.md) — exporting in depth
- [System Requirements](system-requirements.md) — hardware and software specs
