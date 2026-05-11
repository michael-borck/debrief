# Projects

Projects group related transcripts so DeepDebrief can analyse them together. A single interview is a transcript. A batch of twelve interviews for the same study is a project.

## When to use a project

- **Interview studies** — multiple conversations around the same research questions
- **Lecture series** — every session of a course
- **Meeting cadences** — all the weekly team meetings for a quarter
- **Customer calls** — everything a support team handled in a period
- **Podcasts** — all episodes of a show

Anywhere you'd want to answer questions like "what themes repeat across these?" or "how did the conversation shift over time?" is a project.

## Creating a project

Sidebar → **Projects** → **New Project**. Fill in:

- **Name** — required
- **Description** — optional, used as context in the AI prompts
- **Color** and **icon** — visual shorthand for the project card
- **Tags** — free-form, for filtering

Click Create and you land on the project detail page.

## Adding transcripts

Two ways:

1. **From the project page** — click **Add Transcripts**, then select from the modal. You can filter by date, tag, status.
2. **From the Library** — open a transcript and click **Add to Project**. Or select multiple transcripts in bulk mode and add them all at once.

A transcript can belong to multiple projects. Removing it from one doesn't affect the others or delete the transcript itself.

## Project detail page

Tabs along the top:

- **Overview** — project-level summary and themes (generated from the combined transcripts)
- **Transcripts** — the member list with add/remove controls
- **Insights** — cross-transcript metrics, sentiment trends, theme evolution
- **Cross-transcript Search** — query across every recording in the project
- **Chat** — project-scoped AI chat
- **Export** — multi-transcript analysis bundles

## Overview and analysis

The project overview runs an AI analysis across the combined text of every member transcript. You'll see:

- **Project summary** — a narrative synthesis of what the transcripts cover
- **Key themes** — recurring topics with counts and example quotes
- **Key insights** — higher-level observations the AI surfaces
- **Last analysis** timestamp — click **Re-analyse** to refresh when you add transcripts

Analysis is cached in the database so you're not paying for it repeatedly. Re-analyse only when the set has changed meaningfully.

## Insights dashboard

The Insights tab shows cross-transcript metrics:

- **Theme evolution** — how often each theme appears across the transcripts, ordered by date
- **Sentiment over time** — the sentiment trajectory across the project
- **Speaker comparison** — for projects where the same speakers appear in multiple recordings
- **Talk-time distribution** — who dominates across the project
- **Concept frequency** — which ideas show up where

The specific panels depend on how your transcripts are structured. Single-speaker-per-recording projects get different views than multi-speaker conversation projects.

## Cross-transcript search

The Cross-transcript Search tab lets you query across every member transcript at once. Three modes:

- **Keyword** — fast literal match
- **Semantic** — vector-based similarity using the embeddings DeepDebrief builds for chat
- **Hybrid** — both, ranked together

Results show which transcript each match came from, the surrounding context, and a jump link to open the transcript at that point.

## Project chat

Project-scoped AI chat, under the **Chat** tab. Unlike a single-transcript chat, this one has access to every transcript in the project. Ask questions like:

- "Which interviews mentioned the Q3 roadmap?"
- "Summarise the customer complaints from the last month of calls"
- "What did each participant say about onboarding?"

Project chat uses the same three conversation modes as regular chat (Quote Lookup / Smart Search / Full Transcript), configured in **Settings → Chat**.

Chat history is saved per-project and survives across sessions.

## Exporting projects

The Export tab bundles:

- The project summary and themes
- Insights from the dashboard
- Optional: the full text of each member transcript
- Optional: per-transcript analysis

Output formats match transcript exports (Markdown, TXT, JSON, PDF). Pick what to include in the export modal.

## Archiving and deleting

Projects have the same archive/trash flow as transcripts. Archiving a project does **not** archive its transcripts — the transcripts stay in the Library, they're just no longer shown on the project page.

Deleting a project removes the project itself but leaves the member transcripts alone. If you want to delete everything, do a bulk delete on the transcripts first.

## Tips

- **Analyse in passes.** Run the project overview analysis once, look at the themes, then dive into specific cross-transcript searches for the ones you care about.
- **Use the description field.** The AI reads the project description when it generates the project summary — giving it context ("these are 1-on-1 interviews about onboarding friction") measurably improves output quality.
- **Don't over-group.** 50-transcript projects are fine. 500-transcript projects make the combined analysis slow and less coherent. Split by theme or time period if a project grows too big.
- **Re-analyse deliberately.** Cached analysis is fine until the set changes. You don't need to re-analyse every time you open the project.

## Next steps

- [Managing Transcripts](managing-transcripts.md)
- [Analysis](../features/analysis.md) — transcript-level analysis views
- [Search](../features/search.md) — full search documentation
- [AI Chat](../features/ai-chat.md) — conversation modes explained
