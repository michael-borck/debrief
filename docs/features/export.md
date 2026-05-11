# Export

Debrief exports transcripts and projects to several formats. You pick what to include each time, so the same transcript can become a clean Markdown doc, a structured JSON record, or a polished PDF depending on what you need.

## Exporting a single transcript

From the transcript detail page, click **Export**. The export modal lets you choose:

### Format

| Format | Extension | Good for |
|---|---|---|
| **Markdown** | `.md` | Readable text with headings and tables. Version control. Copy-paste into notes apps. |
| **Plain text** | `.txt` | Raw content for scripts, archival, email. |
| **JSON** | `.json` | Structured data — transcript, analysis, metadata, segments. Use this when scripting around Debrief. |
| **PDF** | `.pdf` | Formatted document for sharing with people who don't use Debrief. |

### What to include

Checkboxes in the modal let you include or exclude:

- **Transcript text** — the full (or corrected) transcript with speaker tags
- **Timestamps** — per-sentence `[HH:MM:SS]` prefixes
- **Speaker labels** — bold speaker names before each turn
- **Summary** — the AI-generated summary
- **Key topics**, **action items**, **notable quotes**
- **Research themes** and **Q&A pairs**
- **Sentiment and emotions**
- **Personal notes** — your free-text notes on the transcript
- **Metadata** — title, duration, created date, tags, rating

Toggle what you want, click Export, pick a save location.

### Corrected vs original text

If you have transcript correction enabled, exports use the corrected version by default. Switch to "original" in the export modal if you want the raw Whisper output.

## Bulk export from the Library

Select multiple transcripts in bulk mode (Library → **Select** → tick multiple cards → **Export**). The bulk export modal offers:

- **One file per transcript** — each transcript becomes its own file in the chosen format, zipped together
- **Combined file** — all selected transcripts merged into a single document

Combined output is especially useful for Markdown and PDF, where you might want one readable document covering a whole batch.

## Exporting a project

From the project detail page, open the **Export** tab. Project exports bundle:

- The **project summary** and **themes** generated at the project level
- **Insights** from the dashboard (optional)
- Each **member transcript** with your chosen level of detail (text only, text + analysis, or just the analysis)
- **Cross-transcript analysis** results

Output formats match transcript exports. A project PDF is a reasonable format to hand to someone who needs the whole study without installing Debrief.

## JSON export schema

If you're processing Debrief data in other tools, JSON is your best bet. The top-level shape looks like:

```json
{
  "transcript": {
    "id": "...",
    "title": "...",
    "duration": 1234.5,
    "full_text": "...",
    "validated_text": "...",
    "segments": [
      { "start": 0.0, "end": 4.2, "speaker": "Interviewer", "text": "..." }
    ]
  },
  "analysis": {
    "summary": "...",
    "key_topics": [...],
    "action_items": [...],
    "sentiment_overall": "positive",
    "sentiment_score": 0.72,
    "emotions": { "joy": 0.4, "surprise": 0.2, ... },
    "notable_quotes": [...],
    "research_themes": [...],
    "qa_pairs": [...],
    "concept_frequency": {...}
  },
  "metadata": {
    "tags": [...],
    "rating": 4,
    "personal_notes": "..."
  }
}
```

Project JSON exports wrap this in a `project` envelope with a list of member transcripts and project-level analysis.

## Copy to clipboard

Several views offer a quick copy button (top-right corner): the summary, a notable quote, a Q&A pair, the full transcript. Clipboard copies use plain text with minimal formatting.

## Privacy considerations

- **Local processing, local export.** Nothing is uploaded during export — the file is written directly to the path you choose.
- **Cloud provider metadata.** If the transcript was analysed with a cloud provider, the AI-generated content came from that provider's servers. The raw transcript text itself was only sent for analysis, not stored externally by Debrief.
- **Audio files are not embedded.** Exports contain text, not audio. If you need the original audio, reach for the source file — Debrief tracks its path but doesn't re-export it.

## Tips

- **PDF is for people, JSON is for scripts.** Don't parse PDFs.
- **Use Markdown for living documents** you'll keep editing. It's diffable and plays nicely with Obsidian, Notion, etc.
- **Corrected text by default** is usually what you want. Flip to original if you need forensic accuracy.
- **Bulk export is faster than you think** — dozens of transcripts at once takes seconds.

## Next steps

- [Managing Transcripts](../user-guide/managing-transcripts.md)
- [Projects](../user-guide/projects.md) — project-level exports
- [Analysis](analysis.md) — what the analysis content means
