# Transcription & Diarisation

DeepDebrief does both jobs locally: turning audio into text (transcription) and figuring out who said what (diarisation). No external server, no cloud upload, no API key needed for either step.

## How it works

The pipeline runs in the Electron main process so it can use Node.js libraries that aren't available in the browser sandbox:

```
audio file
    ↓
[ffmpeg-static] decode to 16 kHz mono PCM
    ↓
[Whisper via @huggingface/transformers] transcribe → text + per-chunk timestamps
    ↓
[pyannote-segmentation-3.0] find speech regions and local speaker activity
    ↓
[wespeaker-voxceleb-resnet34-LM] compute 256-d voice embedding per turn
    ↓
[agglomerative cosine clustering] assign global speaker labels
    ↓
[timestamp alignment] join speaker labels to whisper segments
    ↓
text segments with speaker tags
```

All four ML models are downloaded once on first use and cached in your user data folder forever. After that, transcription makes zero network calls.

## Whisper transcription

DeepDebrief uses Whisper through the `@huggingface/transformers` library, which provides a JavaScript wrapper around ONNX Runtime. The result is a high-quality transcription engine that runs in pure Node.js without needing Python, PyTorch, or a separate server.

### Model choices (Settings → Transcription)

| Model | Size | Speed (M-series Mac) | Best for |
|---|---|---|---|
| **Tiny (English)** | ~75 MB | ~2-3× realtime | Quick drafts, short clips, slower hardware |
| **Base (English)** | ~140 MB | ~1.5× realtime | Most users — recommended balance |
| **Small (English)** | ~470 MB | ~0.7× realtime | Best accuracy, when speed isn't critical |

The number after `realtime` is the multiplier. 2× realtime means a 1-minute file transcribes in 30 seconds. 0.7× means it takes 1.4 minutes.

All three models are English-only (`.en`). They're faster and more accurate than the multilingual variants for English audio.

### What you get back

For each transcription, Whisper returns:

- The full transcript text
- A list of chunks, each with `[startTime, endTime, text]`

The chunks are typically sentence-sized. They become the per-sentence rows in DeepDebrief's transcript segments table, which power features like the synced audio playback and find-in-transcript search.

### Internal chunking (not the same as the old Speaches chunking)

Whisper itself processes audio in 30-second windows internally with 5-second strides. This is an algorithm parameter, not a network parameter — there's no network call between windows. You don't need to configure it.

(Older versions of DeepDebrief used a separate Speaches HTTP server and chunked at the network level for request size limits. That entire path has been removed.)

## Speaker diarisation

Diarisation runs after transcription if "Detect speakers from audio" is enabled in Settings → Processing.

Two models work together:

- **`onnx-community/pyannote-segmentation-3.0`** (~6 MB) — finds speech regions and identifies up to 3 simultaneous local speakers in each 5-second analysis window. Output is a sequence of frames classified into 7 "powerset" classes (silence, single speakers 0-2, and the three pair combinations for overlap detection).
- **`onnx-community/wespeaker-voxceleb-resnet34-LM`** (~25 MB) — turns a slice of audio into a 256-dimensional voice fingerprint vector.

### The full algorithm

1. **Window the audio** in 5-second chunks
2. **Segment each window** with pyannote → per-frame speaker activations
3. **Median filter** the frame activations (11-frame window) to kill single-frame jitter that causes over-segmentation
4. **Convert frames to turns** by finding contiguous runs of each speaker
5. **Merge brief gaps** within the same speaker channel (gaps shorter than 200ms are bridged)
6. **Drop turns shorter than 500ms** from the clustering pool — they're too short to embed reliably
7. **Embed each long-enough turn** with wespeaker
8. **Cluster** turns using agglomerative cosine clustering at threshold 0.5
9. **Reassign noise clusters** — any cluster totalling less than 3 seconds of audio is moved to the temporally-nearest substantial cluster (this kills the long tail of "ghost speakers" you'd otherwise see on noisy audio)
10. **Reassign the dropped short turns** to their nearest neighbour cluster
11. **Renumber** clusters from 1 contiguously
12. **Align with Whisper segments** by timestamp overlap — each text chunk gets the speaker label of the diarisation turn it overlaps most with

### Why it's better than the old approach

Earlier DeepDebrief versions sent transcribed text to an LLM and asked it to guess speakers from textual cues. That approach:

- Couldn't detect overlapping speech
- Couldn't handle 4+ speakers
- Gave noisy results on rapid back-and-forth
- Was slow (extra LLM round-trip per file)

The current pipeline uses voice fingerprints from the actual audio, which is dramatically more accurate. On real test files: a clean 30-second 2-speaker clip identifies 2 speakers correctly; a 14-minute structured interview identifies 2 speakers with the expected interviewer/interviewee split; a tough 5-min noisy 5-speaker file identifies 4-6 speakers (the dominant 4 covering 98%+ of the audio).

### Tuning (advanced)

Every diarisation tunable is exposed as a slider under **Settings → Processing → Advanced diarisation tuning** (inside the Detect speakers collapsible). Defaults are validated across a range of audio types:

- Median filter: 11 frames
- Min duration on (turn length): 0.5s
- Min duration off (gap merging): 0.2s
- Cluster threshold (cosine similarity): 0.5
- Noise reassignment minimum: 3.0s

Don't touch these unless the pipeline is misbehaving on a specific file — tuning is a last resort after Speaker Tagging can't fix the result manually. See the [Advanced Features Tutorial](../tutorials/advanced-features.md#diarisation-tuning) for guidance on which knob to turn when.

## After diarisation: manual correction

The diarisation pipeline gives you a starting point with generic labels (`Speaker 1`, `Speaker 2`, ...). You can then:

- **Rename speakers** to meaningful names (Interviewer, Sarah, Customer Service, etc.)
- **Merge speakers** if pyannote over-split one real person
- **Re-tag specific segments** if they were assigned to the wrong speaker

Open the **Speaker Tagging** modal from the transcript detail page. The modal has three tools:

1. **Manual editing** — click any segment and assign it to a speaker
2. **Extend Manual Tags** — tag a few segments by hand, then click this button to have the AI extend your pattern to the rest
3. **AI Correction** — ask the AI to suggest meaningful labels and flag merge candidates based on speaker context. Suggestions appear with checkboxes — accept the ones you like, reject the rest, click Apply

The AI Correction button uses your configured AI provider (Settings → Processing → AI Analysis Service). It sends 5 representative samples per speaker to the model, asks for label suggestions and merge candidates, and returns structured JSON.

## Performance notes

- **First-time costs.** First time you transcribe: Whisper model download. First time you diarise: pyannote + wespeaker download. After that, no network calls.
- **CPU only.** No GPU acceleration in the current build. Apple Silicon is fast enough; Intel Macs and old Linux laptops are noticeably slower.
- **Memory.** Whisper holds the model in memory (~150 MB for tiny.en, ~500 MB for small.en). Diarisation models are smaller. Total resident memory during transcription is typically 300-700 MB on top of the base Electron process.
- **Long files.** Transcription scales linearly with audio length. A 30-minute interview takes about 10-15 minutes with base.en + diarisation enabled on an M-series Mac. Faster on Apple Silicon, slower on Intel.

## What's next

- [Analysis](analysis.md) — what DeepDebrief does with the text after transcription
- [AI Chat](ai-chat.md) — talking to your transcripts
- [Settings → Transcription](../user-guide/settings.md#transcription) — picking a model
- [Settings → Detect speakers from audio](../user-guide/settings.md#detect-speakers-from-audio) — turning diarisation on/off
