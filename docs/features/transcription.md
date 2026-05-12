# Transcription & Diarisation

Debrief does both jobs locally: turning audio into text (transcription) and figuring out who said what (diarisation). Both run inside a Python sidecar that ships with the app — no external server, no cloud upload, no API key needed for either step.

## Architecture at a glance

```
Electron renderer
    ↓ IPC: audio.transcribe(path, opts)
Electron main
    ↓ HTTP: POST /analyse (multipart) → 127.0.0.1:<port>
Python sidecar  (lens/speech-analyser)
    │
    ├── faster-whisper → transcript + per-segment timestamps
    ├── pyannote.audio 3.1 → speaker turns (if diarize=true)
    └── speech_analyser → composite metrics (WPM, fillers, quality score)
```

The sidecar is a bundled Python process managed by the main process. First-launch setup installs the heavy ML dependencies (PyTorch, torchcodec, pyannote, faster-whisper) into your user-data folder via pip; pyannote and whisper model weights are bundled inside the installer so the runtime doesn't need a HuggingFace token. Subsequent launches spawn the sidecar in seconds.

## Whisper transcription

Debrief uses `faster-whisper` (a CTranslate2-optimised reimplementation of OpenAI's Whisper) running inside the sidecar. The default model is `base` (~140 MB); other Whisper sizes (`tiny`, `tiny.en`, `base`, `base.en`, `small`, `medium`, `large-v3`, etc.) can be selected if you swap the model name in Settings.

### Model choices

`faster-whisper` supports the full Whisper family. Defaults to `base`. Larger models give better accuracy but consume more memory and CPU time:

| Model | Approx. memory | Speed (M-series Mac) | Best for |
|---|---|---|---|
| `tiny.en` | ~150 MB | ~3× realtime | Quick drafts, short clips |
| `base` *(default)* | ~250 MB | ~1.5× realtime | Most users |
| `small` | ~500 MB | ~0.7× realtime | Highest accuracy in the small family |
| `large-v3` | ~3 GB | ~0.2× realtime | Production transcription, fast machines |

Only `base` ships pre-bundled in the installer. Picking a different model triggers a one-time HuggingFace download into the sidecar venv's cache.

`base` is the safe default. Apple Silicon makes it fast enough for most use, and it handles accents and noisy audio better than `tiny`.

### What you get back

For each transcription, the sidecar returns:

- The full transcript text
- A list of sentence-level segments, each with `{start, end, text, speaker}` (`speaker` is `null` when diarisation is off)
- A `speech_metrics` block: word count, speaking rate (WPM), filler word count + rate, silence ratio, plus a composite quality score (0–100) with clarity/depth/balance/pace factor breakdown
- A `speakers` list with per-speaker word count and percentage (when diarisation is on)

The segments become the per-sentence rows in Debrief's `transcript_segments` table, which power synced audio playback and find-in-transcript search.

## Speaker diarisation

Diarisation runs when "Detect speakers from audio" is enabled in Settings → Processing. The sidecar uses `pyannote.audio` 3.1's pre-trained pipeline:

- **`pyannote/speaker-diarization-3.1`** — the orchestrator. Bundled at install time.
- **`pyannote/segmentation-3.0`** — finds speech regions and identifies up to 3 overlapping local speakers in each 5-second window. MIT licensed, bundled.
- **`pyannote/wespeaker-voxceleb-resnet34-LM`** — turns each turn into a 256-dimensional voice fingerprint vector. CC-BY-4.0 licensed, bundled.
- **`pyannote/speaker-diarization-community-1`** — clustering / PLDA backend. CC-BY-4.0 licensed, bundled.

All four model files live inside the installer (`Contents/Resources/embedded-server/models/`). At runtime the sidecar sets `HF_HOME` to point at the bundled cache and `HF_HUB_OFFLINE=1` so pyannote loads them without contacting HuggingFace.

The whole pipeline is opaque from Debrief's side — we POST the audio, pyannote returns speaker turns. Internal hyperparameters (segmentation thresholds, clustering distance, etc.) aren't currently exposed.

### After diarisation: manual correction

The diarisation pipeline gives you a starting point with generic labels (`SPEAKER_00`, `SPEAKER_01`, …). You can then:

- **Rename speakers** to meaningful names (Interviewer, Sarah, Customer Service, etc.)
- **Merge speakers** if pyannote over-split one real person
- **Re-tag specific segments** if they were assigned to the wrong speaker

Open the **Speaker Tagging** modal from the transcript detail page. The modal has three tools:

1. **Manual editing** — click any segment and assign it to a speaker
2. **Extend Manual Tags** — tag a few segments by hand, then click this button to have the AI extend your pattern to the rest
3. **AI Correction** — ask the AI to suggest meaningful labels and flag merge candidates based on speaker context. Suggestions appear with checkboxes — accept the ones you like, reject the rest, click Apply

The AI Correction button uses your configured AI provider (Settings → Processing → AI Analysis Service). It sends 5 representative samples per speaker to the model, asks for label suggestions and merge candidates, and returns structured JSON.

### Per-transcript rerun

The transcript detail page has a **Speaker detection** panel with a **Number of speakers** dropdown (Auto / 2–8) and a **Rerun** button. Clicking it hits a debrief-specific `/rediarise` endpoint on the sidecar that **skips Whisper** — the existing transcript text is reused, only the speaker tags get rewritten. Much faster than a full re-import.

When the dropdown is set to a specific count, pyannote uses it as a hard `num_speakers` hint. This is the right knob when auto-detect over-splits one person into two voices, or merges two voices into one. Pyannote does not interpret the hint as "at least N" or "at most N" — it produces exactly N clusters.

### Known limitations

- **Auto-detect over- or under-splits short or noisy recordings.** Workaround: set the speaker count manually on the rerun panel. Pyannote honours an exact count hint.
- **No per-chunk progress events.** The sidecar's `/analyse` endpoint returns the full result in one HTTP response — there's no per-chunk progress while it runs. The Processing Queue shows a single "transcribing" stage with an indeterminate progress bar until completion. Server-Sent Events from the sidecar would address this.
- **Cancel closes the connection but the sidecar keeps churning.** A cancel button stops the renderer waiting, but the underlying compute completes in the background until the response is discarded.

## Performance notes

- **First-time costs.** First-launch setup installs ~1 GB of Python deps. After that, all model loading is from local disk — no further network needed.
- **CPU only.** No GPU acceleration in the current build. Apple Silicon is fast enough for `base`; Intel Macs and older Linux laptops are noticeably slower.
- **Memory.** Sidecar process holds the Whisper model plus pyannote in memory — typically 1.5–2.5 GB during active inference. Idle memory drops once the response is returned. Total resident memory across Electron + sidecar is ~3 GB peak.
- **Long files.** Transcription scales linearly with audio length. A 30-minute interview takes about 12–18 minutes with `base` + diarisation enabled on an M-series Mac.

## What's next

- [Analysis](analysis.md) — what Debrief does with the text after transcription
- [AI Chat](ai-chat.md) — talking to your transcripts
- [Settings → Detect speakers from audio](../user-guide/settings.md#detect-speakers-from-audio) — turning diarisation on/off
