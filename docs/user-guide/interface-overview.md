# Interface Overview

A tour of DeepDebrief's main UI elements so you know where everything lives.

## Window layout

```
┌─────────────────────────────────────────────────────────┐
│  Sidebar       │          Main content area             │
│  (navigation)  │                                        │
│                │                                        │
│                │                                        │
│                │                                        │
├────────────────┴────────────────────────────────────────┤
│  Status bar (bottom edge)                               │
└─────────────────────────────────────────────────────────┘
```

- **Sidebar** — primary navigation. Collapses to icons-only if you want more room.
- **Main content** — whichever page you've navigated to.
- **Status bar** — tiny strip at the bottom showing AI provider status (green/amber/red), active model name, and any background processing activity.

## The sidebar

From top to bottom:

- **Dashboard** — landing page with recent transcripts, recent projects, and activity stats
- **Upload & Process** — drag-drop zone for new files
- **Projects** — grouped transcripts for cross-recording analysis
- **Library** — every transcript you've made, searchable and filterable
- **Search & Filter** — full-text and semantic search across transcripts
- **Chat History** — past AI conversations (both single-transcript and project chats)
- **Archive** — transcripts and projects you've archived (hidden from Library but not deleted)
- **Trash** — soft-deleted items awaiting permanent deletion
- **Documentation** — the docs you're reading right now, rendered in-app
- **Settings** — all configuration
- **About / Help** — version info, keyboard shortcuts, licenses

Click the collapse toggle at the bottom of the sidebar to shrink it to an icon rail.

## Dashboard

The landing page. You'll see:

- **Recent transcripts** — the last handful you've processed
- **Recent projects** — quick access to active projects
- **Activity stats** — totals for transcripts, projects, hours transcribed, etc.
- **Quick actions** — shortcuts to Upload, Settings, Docs

## Upload & Process page

A big drop zone. Drag audio/video files in, or click to browse. Below the drop zone you can:

- Pick a project to assign new uploads to
- Toggle whether to start processing immediately
- See the processing queue (files currently transcribing/analysing)

Processing continues in the background when you navigate away — a toast notifies you on completion.

## Library page

A grid of transcript cards with:

- **Title** and **date**
- **Duration** and **speaker count**
- **Status** badges (processing / completed / error)
- **Star** and **rating** controls
- **Tags** if you've added any

Filter and sort controls at the top:

- **Search** — find by title or content
- **Filter** — by status, project, tag, starred, rated
- **Sort** — by date, duration, rating, title
- **Bulk actions** — multi-select to archive, delete, export, or add-to-project

Click any card to open its detail page.

## Transcript detail page

Tabs along the top:

- **Overview** — summary, key topics, action items, notable quotes, sentiment, emotions
- **Transcript** — full text with speaker tags and per-sentence timestamps; click any line to jump the audio player
- **Analysis** — deeper views: research themes, Q&A pairs, concept frequency, talk-time per speaker, filler word stats, conversation quality metrics
- **Chat** — ask questions about this transcript
- **Notes** — your personal notes on the recording

Right-side action buttons:

- **Speaker Tagging** — rename, merge, or re-tag speakers
- **Edit Transcript** — open the sentence editor to fix recognition errors
- **Export** — save as Markdown, TXT, JSON, or PDF
- **Archive / Delete** — soft-delete or move to trash
- **Audio Player Bar** — sticks to the bottom of the page while you scroll

## Projects page

A grid of project cards. Click into one and you'll see:

- **Overview** — project-level summary and themes (generated from the combined transcripts)
- **Transcripts** — the list of recordings in this project, with add/remove controls
- **Insights** — cross-transcript metrics and visualisations
- **Cross-transcript Search** — query across every recording in the project
- **Chat** — project-scoped AI chat with access to all member transcripts
- **Export** — bundle multi-transcript analysis into a single document

See [Projects](projects.md) for the full feature set.

## Settings page

Five tabs:

- **Transcription** — Whisper model picker
- **Processing** — AI provider, speaker detection, transcript correction, diarisation tuning, session token usage
- **Chat** — conversation mode (Quote Lookup / Smart Search / Full Transcript), chunking, memory
- **AI Prompts** — customise the prompts DeepDebrief sends to the AI for each task
- **General** — storage, backups, appearance, search index

Every control saves immediately. There's no Save button.

## Status bar

A thin strip at the bottom of the window. Elements from left to right:

- **AI provider status** — green (connected), amber (cloud provider configured), red (unreachable), grey (not configured)
- **Active provider name** and model
- **Processing activity** — spinner and count while anything is transcribing or analysing
- **Database location** tooltip

## Keyboard shortcuts

Press **`Cmd/Ctrl + ?`** at any time to open the shortcuts dialog. The most useful ones:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + 1..5` | Jump to Dashboard / Library / Projects / Search / Settings |
| `Cmd/Ctrl + U` | Upload files |
| `Cmd/Ctrl + K` | Global search |
| `Cmd/Ctrl + N` | New project |
| `Cmd/Ctrl + ,` | Settings |
| `Cmd/Ctrl + Shift + C` | Open AI chat on current transcript |
| `Esc` | Close modal / cancel |
| `Space` | Play/pause audio (in transcript detail) |

Full list: [Keyboard Shortcuts Reference](../reference/keyboard-shortcuts.md).

## Light and dark theme

**Settings → General → Appearance** has Light / Dark / System options. System follows your OS preference. Theme changes apply instantly.

## Next steps

- [Uploading Files](uploading-files.md)
- [Managing Transcripts](managing-transcripts.md)
- [Projects](projects.md)
- [Settings](settings.md)
