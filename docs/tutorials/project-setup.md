# Tutorial: Project Setup

A walkthrough of building a project from scratch to run cross-transcript analysis. We'll use an interview study as the running example, but the same flow applies to lecture series, meeting cadences, or podcast archives.

**Time needed:** 20 minutes, plus whatever time it takes to transcribe your recordings.

## Scenario

You've got six 15-minute interviews from a UX study on onboarding friction. Each interview is a separate recording file. You want to:

- Transcribe each one
- Identify recurring themes across all six
- Ask questions across the whole study ("which participants mentioned password resets?")
- Export a research report

## 1. Set up the project first

Sidebar → **Projects** → **New Project**.

- **Name**: `Onboarding UX Study`
- **Description**: `Six 1-on-1 interviews about first-time signup friction, conducted March 2026`
- **Color / icon**: pick something distinctive so it stands out on the Projects page

Write a good description — the AI reads it when generating the project-level summary, and a specific description measurably improves output quality.

Click Create.

## 2. Upload all recordings to the project

From the new project page, click **Upload & Process**. Drag all six files into the drop zone at once.

Each file becomes a card in the processing queue. Processing is sequential (one at a time) so they won't all complete instantly. You can navigate away — the queue runs in the background.

Because you uploaded from inside a project, the recordings are automatically assigned to it. You don't have to add them manually later.

**Tip:** if you already have the transcripts in your Library, use **Add Transcripts** on the project page instead. Tick the ones you want, click Add.

## 3. Tag speakers consistently

This matters a lot for cross-transcript analysis. If the interviewer is "Sarah" in recording 1 but "Speaker 1" in recording 2, the project can't tell they're the same person.

Open each transcript in turn and:

1. Click **Speaker Tagging**
2. Rename speakers to consistent labels (`Interviewer`, `P1`, `P2`, etc.)
3. Save

For the interviewer specifically, use the same name across every recording — that's what lets the project speaker comparison view work.

## 4. Run project analysis

Back on the project page, click the **Overview** tab. If it's empty, click **Run Analysis**. Debrief will:

1. Pull the text of every member transcript
2. Send it to your AI provider with the project-level prompt
3. Generate a project summary, themes, and insights
4. Cache the results

You'll get back:

- A **summary** synthesising the whole study
- **Key themes** recurring across interviews, with counts and examples
- **Key insights** the AI has surfaced

Re-analyse whenever the set of transcripts changes meaningfully.

## 5. Explore the Insights dashboard

Click the **Insights** tab. You'll see cross-transcript panels:

- **Theme evolution** — how often each theme appears across recordings, ordered by date
- **Sentiment over time** — the sentiment trajectory across the study
- **Speaker comparison** — if you used consistent speaker names, this shows how much each participant talked and how their sentiment differed
- **Concept frequency** — top concepts across all six interviews

Spend some time here. The Insights dashboard is where a project earns its keep — you can't get these views from a single transcript.

## 6. Cross-transcript search

Click the **Cross-transcript Search** tab. Try queries like:

- `password reset` (keyword)
- `"frustration with setup"` (semantic — finds conceptually similar passages even with different wording)
- `which participants mentioned email verification` (hybrid)

Each result shows which transcript it came from, with a jump link to open that transcript at the match point.

## 7. Chat across the project

Click the **Chat** tab. This is project-scoped chat with access to every member transcript. Ask things like:

- "What were the most common complaints across all six interviews?"
- "Which participants gave positive feedback about the email verification step?"
- "Summarise the recurring themes in two paragraphs"

Chat answers pull from the relevant transcripts and tell you which ones they came from. Chat history is saved per-project.

## 8. Export the project

Click the **Export** tab. Pick a format — PDF is a reasonable format to hand to stakeholders who don't use Debrief.

Include:

- Project summary and themes
- Insights dashboard
- Per-transcript analysis (not full text, unless they need it)

The resulting document is a readable research bundle you can share directly.

## Tips for running bigger studies

- **Keep projects focused.** 10-30 transcripts is a sweet spot. 100+ makes combined analysis slow and less coherent — split by theme or time period.
- **Update the description when scope changes.** The AI re-reads it on every analysis run.
- **Name speakers early.** It's much easier to rename during the initial review than to fix it after you've done cross-transcript analysis with generic labels.
- **Don't re-analyse on every upload.** The cached analysis is fine until the set changes meaningfully. Re-run deliberately, not automatically.
- **Use tags for cross-project filtering.** If you run multiple UX studies a year, tag each project (`ux`, `q1-2026`, `onboarding`) so you can filter the Projects page later.

## Where to go from here

- [Projects reference](../user-guide/projects.md) — every feature in depth
- [Advanced Features Tutorial](advanced-features.md) — prompt customisation, diarisation tuning
- [Search](../features/search.md) — the search modes explained
- [Analysis](../features/analysis.md) — the analysis views explained
