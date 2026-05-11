# Tutorial: Basic Workflow

A walkthrough of the end-to-end Debrief workflow using a single recording. Follow along with any 2-5 minute audio file you have handy.

**Time needed:** 15 minutes on a reasonably fast machine.

## 1. Prepare

Make sure you've done the [Quick Start](../getting-started/quick-start.md):

- A Whisper model is picked in **Settings → Transcription**
- Your AI provider is configured in **Settings → Processing → AI Analysis Service**
- Test Connection succeeded

Pick a test file that's 2-5 minutes long with clean audio. Interview snippets, podcast clips, and meeting recordings all work well.

## 2. Upload

Sidebar → **Upload & Process**. Drag your file into the drop zone. A card appears showing:

- The file name and duration
- An optional project selector
- An **Upload & Process** button

Leave the project unset for now. Click **Upload & Process**.

## 3. Watch the pipeline

Debrief runs a series of steps:

1. **Decoding audio** — ffmpeg extracts a 16 kHz mono PCM stream
2. **Transcribing** — Whisper runs on the audio
3. **Detecting speakers** — pyannote + wespeaker identify who's talking (if enabled)
4. **Analysing** — the AI provider generates summary, themes, action items, sentiment, etc.
5. **Saving** — results go into the library

Processing continues in the background if you navigate away. A toast tells you when it's done.

On an M-series Mac with tiny.en + Ollama 3B, expect a 3-minute file to take roughly 30-60 seconds end-to-end. Slower machines and bigger models scale that up.

## 4. Open the transcript

Sidebar → **Library**. Your new transcript is at the top of the grid. Click it.

You land on the **Overview** tab. Take a moment to read:

- The **summary** — does it match what's in your file?
- **Key topics** — are they what you'd expect?
- **Action items** — extracted to-dos (may be empty for non-meeting content)
- **Sentiment** — overall tone plus a score
- **Notable quotes** — striking lines pulled from the recording

If any of these look wrong, it's usually one of:

- Weak AI model (try a bigger one in Settings)
- Poor transcript (try a bigger Whisper model)
- Unusual content the default prompts weren't written for (customise in **Settings → AI Prompts**)

## 5. Read the transcript

Click the **Transcript** tab. You'll see the full text with:

- **Speaker labels** (generic like "Speaker 1" unless you've named them)
- **Timestamps** on each line
- **Clickable lines** that jump the audio player to that point

The audio player bar sticks to the bottom of the page. Hit **Space** to play, click any line to jump.

## 6. Fix the speakers

Click **Speaker Tagging** (top right). The modal shows every speaker the diarisation pipeline detected. Rename them to meaningful labels:

- Type a new name in the input next to "Speaker 1" → press Enter
- Repeat for each speaker
- Click **Save**

If two "speakers" are actually the same person who pyannote over-split, click **Merge** on one and select the other. Their segments will unify.

If the AI label guesses help, click **AI Correction** — it'll sample a few turns per speaker and suggest meaningful labels.

## 7. Explore the analysis

Click the **Analysis** tab. You'll see deeper views:

- **Research themes** with confidence scores and example quotes
- **Q&A pairs** if the recording is conversational
- **Concept frequency** — a searchable word-count table
- **Talk-time per speaker**
- **Filler words**
- **Conversation quality** metrics

Click any of these to drill in. Everything is read-only — analysis reflects the transcript state at the moment of analysis.

## 8. Chat with it

Click the **Chat** tab. A familiar chat window appears. Try:

- "Summarise this in three bullets"
- "What action items came out of this?"
- "Quote the most important thing the interviewer said"

Chat uses whichever conversation mode you picked in **Settings → Chat**. Smart Search (the default) retrieves the most relevant chunks from the transcript and sends them to the AI for interpretation.

Chat history is saved — you can reopen it later and pick up where you left off.

## 9. Correct the text

If you spotted transcription errors on the Transcript tab, click **Edit Transcript**. The sentence editor opens. Fix any sentences directly, then Save. Your edits are versioned and the original is preserved.

The **Analyze corrected transcript** setting (in Processing) makes re-analysis use your edits instead of the original Whisper output.

## 10. Export

Click **Export** (top right). Pick a format — Markdown is a good default for human reading. Tick what to include (transcript, summary, analysis). Click Export, pick a save location.

Open the exported file in your editor. You now have a self-contained document that doesn't need Debrief to read.

## Where to go from here

- **Run a project** across multiple recordings → [Project Setup Tutorial](project-setup.md)
- **Power user features** — prompt customisation, diarisation tuning, semantic search → [Advanced Features Tutorial](advanced-features.md)
- **Tweak settings** to your workflow → [Settings](../user-guide/settings.md)
- **Troubleshoot oddities** → [Common Issues](../troubleshooting/common-issues.md)
