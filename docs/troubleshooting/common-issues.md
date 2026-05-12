# Common Issues

Solutions to the problems users hit most often. If nothing here matches, check the [FAQ](faq.md) or file an issue on [GitHub](https://github.com/michael-borck/debrief/issues).

## Installation and launch

### "Debrief is damaged" on macOS

You're running an unsigned nightly build, or Gatekeeper is being cautious. Right-click the app in Applications → **Open** → **Open** in the prompt. macOS remembers the exception after that.

Official release builds from the Releases page are code-signed and notarised — they open cleanly without this dance.

### Windows SmartScreen blocks the installer

Click **More info** → **Run anyway**. SmartScreen reputation builds over time; release builds are signed but may still trip the heuristic until they're well-known.

### Linux AppImage won't execute

Mark it executable first:

```bash
chmod +x Debrief-*.AppImage
./Debrief-*.AppImage
```

On some distros you also need FUSE installed:

```bash
sudo apt install libfuse2
```

### App launches then quits immediately

Usually a corrupted user data folder. Try renaming it so Debrief creates a fresh one:

- macOS: `mv ~/Library/Application\ Support/debrief ~/Library/Application\ Support/debrief.bak`
- Windows: rename `%APPDATA%\debrief` to `debrief.bak`
- Linux: rename `~/.config/debrief` to `~/.config/debrief.bak`

Launch again. If it works, your old data is still in the `.bak` folder — copy `debrief.db` out if you want to preserve your library.

## Transcription

### Model download is stuck

The first time you transcribe with a model, Debrief downloads it from Hugging Face. If the download stalls:

1. Check your internet connection
2. Check **Settings → Transcription** — does the download progress bar move?
3. Quit and relaunch. Downloads resume on next launch.
4. If it still fails, a firewall or proxy may be blocking `huggingface.co`

### Transcription is very slow

Expected speeds on an M-series Mac:

| Model | Speed |
|---|---|
| Tiny.en | 2-3× realtime |
| Base.en | ~1.5× realtime |
| Small.en | ~0.7× realtime |

If you're getting much worse:

- **You're on Intel / old x86 Linux** — CPU inference scales with your CPU. Apple Silicon is in a different league. Use a smaller model.
- **You enabled speaker detection** — diarisation adds ~1× audio length. Turn it off for single-speaker recordings if speed matters more.
- **Background processes** — heavy apps competing for CPU slow everything down.

### Transcription quality is poor

Three likely causes, in order of likelihood:

1. **Audio quality.** Background noise, distant speakers, overlapping voices — Whisper struggles with all of these. Clean audio in = clean transcript out.
2. **Model choice.** Tiny.en is fast but rough. Move up to Base.en or Small.en for hard audio.
3. **Accent or non-English speech.** The English-only models are tuned for English. Heavily accented English or other languages will transcribe poorly.

If you've tried all three and it's still bad, try running the audio through noise reduction before uploading.

## Speaker detection (diarisation)

### Wrong number of speakers

Symptom: the pipeline says 4 speakers but there are only 2, or vice versa.

Open the transcript and find the **Speaker detection** panel on the detail page:

1. Set **Number of speakers** to the exact count you expect (or leave on Auto).
2. Click **Rerun**. This re-runs only the diarisation step (Whisper is skipped — much faster than a fresh import).

Pyannote will produce exactly that many speaker clusters and re-tag the transcript. If you set a count that doesn't match the audio (e.g. 3 on a single-speaker recording), the result will still split into 3 clusters — so only pin a count you're confident about.

You can also fix mis-splits manually in **Speaker Tagging → Merge** without rerunning.

### Speakers are mislabelled as "Speaker 1", "Speaker 2", etc.

That's by design — diarisation identifies distinct voices but doesn't know their names. Use **Speaker Tagging** on the transcript detail page to rename them. Try **AI Correction** for automatic suggestions based on conversational context.

### One speaker's segments are scattered across multiple labels

This happens when background noise or music fragments the voice embedding. Open **Speaker Tagging**, click **Merge** on one of the labels, select the other, confirm.

## AI analysis

### "AI provider unreachable" or analysis fails

Open **Settings → Processing → AI Analysis Service** and click **Test Connection**. The specific error message tells you what's wrong:

- **Connection refused** — Ollama isn't running, or the URL is wrong. Start Ollama (`ollama serve`), or check the URL in Settings.
- **401 Unauthorized** — bad API key for a cloud provider. Re-enter it.
- **404 Not Found** — the URL points to the wrong endpoint. Default URLs are filled in automatically when you pick a provider; reset by re-selecting the provider from the dropdown.
- **Timeout** — the provider is slow or overloaded. Retry, or switch providers.

### Analysis quality is mediocre

Usually means the AI model is too small for the task. A 3B-parameter local model produces decent summaries but shallow themes. Try:

- A bigger Ollama model (`llama3.1:8b`, `qwen2.5:14b`) if you have the RAM
- A cloud provider (OpenAI GPT-4-class, Claude Sonnet) for noticeably better output
- Customising prompts in **Settings → AI Prompts** to bias the AI toward what you care about

### Analysis never completes

Check the session logs (macOS: `~/Library/Logs/debrief/`, or look at the dev console if you launched with a debug build). Usually the AI provider threw an error that didn't surface as a toast. Common causes:

- Context length exceeded (the transcript is too long for the model's context window — try a smaller Whisper model so the transcript is shorter, or a model with a bigger context)
- Rate limit hit (cloud providers throttle; wait and retry)

## Chat and search

### Chat returns nothing useful

- **Is the right conversation mode set?** Smart Search is the default and works for most cases. Try Full Transcript for deep questions that need full context.
- **Is the search index built?** **Settings → General → Chat Search Index → View Statistics**. If it's empty, it'll build on first use, but you can pre-build by chatting with a transcript once.
- **Is your AI provider responsive?** Chat quality depends on the LLM. A 3B local model gives bland answers; cloud models give richer ones.

### Semantic search returns nothing / wrong results

- **Rebuild the index.** **Settings → General → Chat Search Index → Reset Search Index**. It rebuilds on next use.
- **Rephrase for the mode you're in.** Semantic wants conceptual queries. Keyword wants literal phrases.

## Library and files

### Can't find a transcript I just uploaded

Check the status:

- **Still processing** — the card shows a spinner. Wait.
- **Error** — the card shows a red badge. Click to see the error message.
- **Archived or Trashed** — check those pages.

The dashboard's **Recent Transcripts** and the Library both show completed transcripts. Newly uploaded files appear as soon as transcription starts.

### Transcript opens but audio won't play

Debrief remembers the original file path but doesn't copy the audio into its own storage. If you moved or deleted the source file after upload, playback breaks.

Either move the file back to where it was, or re-upload and delete the broken transcript.

## Database and storage

### "Database is locked" error

Another process is holding a lock on the SQLite file. Usually one of:

- A second copy of Debrief is running (check Activity Monitor / Task Manager)
- A cloud sync client is locking the file mid-sync (iCloud, Dropbox)
- An antivirus is scanning the file

Close the other process or wait for the sync to finish. If the file is in a sync folder, consider moving the database to a non-synced location (**Settings → General → Storage & Backup**).

### Running out of disk space

Debrief stores:

- Transcripts in SQLite (small — KB per transcript)
- Whisper/pyannote/wespeaker models in `models/` (~500 MB worst case)
- Automated backups in `backups/` (if auto-backup is on)

Biggest space hog is usually the backups. Trim old ones from **Settings → General → Storage & Backup** or delete them manually from the folder.

## Still stuck?

- [FAQ](faq.md) — common questions
- [GitHub Issues](https://github.com/michael-borck/debrief/issues) — report bugs
- [Discussions](https://github.com/michael-borck/debrief/discussions) — ask for help
