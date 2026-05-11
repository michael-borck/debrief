# Uploading Files

Three ways to get audio and video into DeepDebrief: drag-and-drop, the file browser, or the menu bar (File → New Upload).

## The Upload page

Sidebar → **Upload & Process**. The page has three things:

1. **Select Files** — the dropzone
2. **Project Assignment** — optional, pick a project to add the new transcript to
3. **Ready to Process** — sticky button on the right, plus the live Processing Queue underneath

You don't have to assign a project at upload time. You can leave it as "None (add to library only)" and assign it later from the transcript page or in bulk from the Library.

## Drag and drop

The fastest way. Drag one or more files onto the dropzone and they appear in the Selected Files list. The zone visually highlights when you're hovering with files.

You can drop files in batches — each new drop adds to the existing selection. Click **Clear all** to start over.

Behind the scenes, DeepDebrief uses Electron's `webUtils.getPathForFile()` to resolve the absolute path of each dropped file. This is the modern replacement for the deprecated `File.path` property and works on Electron 32+.

## Click to browse

Click anywhere in the dropzone (or the "Click to browse" link). The system file picker opens. Select one or more files. They appear in the Selected Files list.

## Menu bar

**File → New Upload** (or `Cmd+N` / `Ctrl+N`) jumps straight to the Upload page from anywhere in the app.

## Supported formats

DeepDebrief uses the bundled `ffmpeg-static` to decode audio, which means **almost any audio or video format works**:

- **Audio**: MP3, WAV, M4A, AAC, OGG, FLAC, WMA, OPUS, AMR
- **Video**: MP4, MOV, AVI, MKV, WebM, WMV, FLV, 3GP

Whatever ffmpeg can read, DeepDebrief can transcribe. Video files have their audio track extracted automatically.

There's no hard size limit. Long files take longer to process but won't fail because of length.

## What happens when you click Upload & Process

For each selected file:

1. **Decode** — ffmpeg converts the file to 16 kHz mono PCM (the format Whisper expects)
2. **Transcribe** — Whisper runs on the decoded audio, producing text with per-chunk timestamps
3. **Diarise** — pyannote and wespeaker identify and label speakers (if "Detect speakers from audio" is on in Settings)
4. **Validate** — optional spelling/grammar correction (if enabled in Settings)
5. **Analyse** — the configured AI model produces a summary, key topics, action items, sentiment, emotions, themes, and notable quotes
6. **Save** — everything is written to the local SQLite database
7. **Notify** — a green "Transcript ready" toast appears bottom-right

If anything fails, a sticky red "Processing failed" toast shows the error. You can keep using the app while transcription runs in the background.

## Processing Queue

The card on the right shows live progress for every file currently being processed. Each row has the filename, a percentage, the current stage (transcribing → analysing → complete), and a progress bar.

Long filenames truncate with `...` to fit the card. Hover over a row to see the full name.

When a file completes or errors, an X button appears so you can dismiss it from the queue.

## Assigning to a project

You have two options:

**At upload time**: Pick a project from the dropdown before clicking Upload & Process. Or click "+ Create New Project" inline if the project doesn't exist yet.

**After upload**: Open the transcript from the Library, scroll to the Projects card, and use the "+ Assign to project..." dropdown. You can assign to multiple projects, and remove the link from any of them with the X button on the project chip.

## Bulk uploads

The Selected Files list supports multiple files. Drop a batch, click Upload & Process, and DeepDebrief processes them one at a time in the queue. The success toast fires per file.

If you've selected a project, every file in the batch gets added to that project automatically.

## Tips and limits

- **Don't close the app while files are in the queue.** Processing is in-memory; if you quit, the queued files won't resume.
- **Long recordings (1+ hour)** can take a while with the larger Whisper models. If speed matters more than accuracy, switch to Tiny in Settings.
- **First-time downloads.** The first time you transcribe with a new model, DeepDebrief downloads it (~75-470 MB depending on choice). The first time you run diarisation, it downloads pyannote (~6 MB) and wespeaker (~25 MB). After that, all processing is fully local.
- **Duplicate detection.** If you upload a file with the same name as an existing transcript, DeepDebrief asks before adding it.

## Common issues

- **"Could not read the dropped file paths"** — usually means you dropped something that isn't a file (e.g. dragging text from a webpage). Click to browse instead.
- **"Audio decoded to an empty buffer"** — the file is corrupt or in a format ffmpeg can't read.
- **Toast says "Processing failed"** — read the message in the toast for the specific error. Common causes: AI provider down, API key invalid, model not selected in Settings.

For more, see [Common Issues](../troubleshooting/common-issues.md).
