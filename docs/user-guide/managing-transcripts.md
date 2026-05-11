# Managing Transcripts

Everything you can do with a transcript after it's been processed.

## The Library

The Library (sidebar → **Library**) is the central index of every transcript you've made. Each card shows title, date, duration, status, star/rating, speaker count, and tags.

### Finding things

- **Search box** — full-text match against titles and transcript content
- **Filter dropdown** — by status, project, tag, starred, rated, date range
- **Sort dropdown** — by date created, duration, rating, title (A-Z)

Deeper semantic search lives on the dedicated **Search & Filter** page — see [Search](../features/search.md).

### Card actions

Hover or click a card to reveal quick actions: open, star, rate, add to project, archive, delete.

### Bulk operations

Click **Select** mode at the top of the Library and multi-select cards. The bulk action bar lets you:

- **Archive** — move selected to the Archive page
- **Delete** — move to Trash
- **Add to project** — assign multiple transcripts to a project at once
- **Export** — bundle selected transcripts into one export

## Transcript detail page

Click any card to open its detail page. Tabs along the top cover Overview, Transcript, Analysis, Chat, and Notes — see [Interface Overview](interface-overview.md) for what each tab shows.

### Editing the text

Click **Edit Transcript** to open the sentence editor. You can:

- Fix recognition errors on any sentence
- Switch between "original" (as Whisper wrote it), "corrected" (AI-cleaned), and "speaker-tagged" views
- Save changes immediately

Your edits are versioned — the original transcript is always preserved.

### Fixing speakers

Click **Speaker Tagging** to open the tagging modal. Three tools:

1. **Manual editing** — click any segment and assign a speaker label
2. **Extend Manual Tags** — tag a few examples by hand, then have the AI extend the pattern to the rest of the transcript
3. **AI Correction** — ask the AI to suggest meaningful labels (Interviewer, Sarah, etc.) and flag merge candidates based on context; review and apply

Renaming a speaker updates every segment at once. Merging two speakers unifies all their segments under one label.

### Audio player

The audio player bar is pinned to the bottom of the detail page. Click any line in the Transcript tab to jump to that timestamp. Keyboard shortcuts while the player has focus:

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Skip 5 seconds |
| `Shift + ←` / `→` | Skip 30 seconds |
| `+` / `-` | Faster / slower playback |
| `0` | Reset to 1× speed |
| `M` | Mute / unmute |

### Metadata

In the Overview tab sidebar:

- **Title** — click to edit
- **Tags** — add free-form tags for filtering later
- **Star** — toggle for quick favourites
- **Rating** — 1-5 stars
- **Personal notes** — free-text notes that stay attached to the transcript

## Assigning to projects

From the detail page, click **Add to Project** to assign. A transcript can belong to multiple projects at once. Project-scoped analysis and chat pick up all member transcripts automatically.

## Archive vs Trash

Two kinds of soft-delete:

- **Archive** — hides the transcript from Library and search results but keeps it fully intact. Restore from the Archive page whenever. Good for "I'm done with this but don't want to delete it".
- **Trash** — marks the transcript for permanent deletion. Shows up in the Trash page with a restore option. Clearing the Trash page actually removes the data.

Delete from Library sends to Trash by default. Hold Shift while clicking Delete to skip Trash and delete immediately (there's still a confirmation).

## Export

Click **Export** on any transcript detail page. Formats:

- **Markdown** — readable, good for version control and copy-paste
- **Plain text** — just the transcript text, optionally with speaker tags and timestamps
- **JSON** — structured data including analysis, segments, and metadata — useful if you're scripting around DeepDebrief
- **PDF** — formatted document suitable for sharing

The export modal lets you pick which pieces to include (transcript, summary, analysis, metadata, notes). Exports land wherever you choose in the save dialog.

Bulk export from the Library bundles multiple transcripts into one file. Project export rolls project-level analysis into the output too.

## Processing errors

If a transcript shows a red **Error** status, open it to see the error message. Common causes:

- **Audio file missing** — the original file was moved or deleted after upload
- **Unsupported format** — ffmpeg couldn't decode it (rare; most formats work)
- **AI provider unreachable** — Ollama not running, cloud API down, wrong URL
- **Model download interrupted** — first-time model fetch failed

You can retry processing from the transcript's context menu, or delete the failed transcript and re-upload the source file.

## Next steps

- [Projects](projects.md) — organising transcripts into groups
- [Analysis](../features/analysis.md) — what each analysis view means
- [Export](../features/export.md) — formats and options in depth
- [Search](../features/search.md) — finding content across everything
