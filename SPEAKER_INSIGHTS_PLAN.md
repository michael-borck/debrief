# Speaker Insights & Long-Recording Plan

Delivery plan for the speaker-attribution and long-recording work identified in the
2026-10-10 audit. Ordered by dependency: each item unblocks or de-risks the next.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Context

Debrief handles two recording shapes well today: interviews and small discussions that
fit in a model's context window. Two shapes are weak:

- **Long recordings (presentations, webinars, panels).** See item 1.
- **Presentations with Q&A**, where you want to know who asked what. See item 2.

The underlying capability is mostly present — diarization separates voices, the LLM
extracts Q&A pairs, speaker labelling already suggests roles — but it is not wired
together, and several correctness bugs actively work against it.

### Constraints this plan respects

- **Local-first.** Transcription, diarization and embeddings run in the bundled Python
  sidecar. No cloud dependency is introduced by any item here.
- **Provider-agnostic.** Everything goes through the Completion seam
  (`ai:complete`), so it works for Ollama and every hosted provider equally.
- **Additive schema changes only.** No destructive migrations; `schema_migrations`
  is stamped, so a downgrade is refused rather than corrupting.
- **Graceful degradation.** A provider failure must never leave a transcript marked
  `completed` with silently blank analysis. This is item 1's actual point.

---

## 1. [x] Chunk and map-reduce the analysis pipeline

**Problem.** `fileProcessor.ts` interpolates the entire transcript into a single prompt,
five separate times (`basic_analysis`, sentiment, emotion, research analysis, and the
validation pass is the only chunked one). A recording that overflows the model's
context window produces a provider error, which `fileProcessor.ts:356` catches and
converts into empty analysis. The transcript is still saved as `completed`. The user
sees a finished transcript with no summary, no topics, no insights, and no error.

This is the single most likely thing to disappoint on a long presentation, and it is
silent.

**Approach.** Mirror the pattern already proven in `transcriptValidationService.ts:162`
(`performChunkedValidation`), which splits at the last sentence terminator inside a
window.

- Add a shared chunking helper (single responsibility, no overlap, sentence-aligned).
- Each analysis function: if the transcript fits the budget, single call — behaviour
  unchanged. If not, map over chunks, then reduce.
- Reduce **deterministically where possible** so this costs no extra LLM calls:
  - lists (`key_topics`, `action_items`, `qa_pairs`, `notable_quotes`) — concat,
    case-normalised dedupe, cap to a sensible maximum
  - numerics (`sentiment_score`) — mean of per-chunk scores
  - objects (`emotions`, `concept_frequency`) — accumulate weighted by chunk size
  - `summary` — a single synthesis call over the per-chunk summaries (the one place
    an extra call is justified; chunk summaries are short)
- Record per-stage outcome so a partial failure is visible rather than silent.

**Acceptance.** A recording whose transcript exceeds the context window still yields a
summary, topics, insights and sentiment, with no LLM error surfaced to the user.
Single-chunk behaviour is byte-identical to today.

**Risk.** Reducer quality is the risk: chunk summaries can be repetitive. Mitigate by
deduping and by the synthesis pass over summaries only.

---

## 2. [ ] Stop re-diarisation destroying manual speaker labels

**Problem.** `rediarisationService.ts:127` deletes and rebuilds the whole
`speaker_tagged` segment version. Every manual rename and every AI-suggested merge is
discarded; speakers revert to pyannote's raw `SPEAKER_00…`. The user tags speakers
carefully, re-runs diarisation to fix a boundary, and loses all their work — silently,
with no warning beforehand.

**Approach.** Preserve the mapping from old speaker ids to new ones across a
re-diarisation, and offer to re-apply labels when the identity of a speaker is
unambiguous (same voice cluster / same dominant text). Where it is ambiguous, keep the
old name attached to the new cluster and tell the user it needs review.

**Acceptance.** Re-running diarisation on a tagged transcript keeps the user's speaker
names, or explicitly reports which ones it could not map.

**Risk.** Low. Depends on item 4 only for *automatic* mapping; a conservative
"keep names, flag uncertain" behaviour is safe on its own.

---

## 3. [ ] Speaker-attributed Q&A extraction

**Problem.** `qa_pairs` already carries optional `speaker?` and `timestamp?` fields in
`src/types/index.ts` and they are validated by `ResearchAnalysisSchema` — but **no
prompt ever asks for them**, so they are always null. Separately,
`interactionPattern` is inferred *purely from speaker count*
(`projectAnalysisService.ts:653`): 1 ⇒ presentation, 2 ⇒ interview, >2 ⇒ discussion. A
presentation with six audience questioners is therefore labelled **"discussion"** —
wrong for exactly the shape this plan targets.

**Approach.**
- Prompt `research_analysis` to attribute each Q&A pair to a speaker and a timestamp.
- Infer roles properly: use talk-time distribution plus turn structure (one dominant
  speaker who holds the floor ⇒ presentation-with-Q&A), not raw speaker count.
- Reuse the existing role vocabulary from `speakerLabelService.ts:90`
  ("Interviewer", "Question-asker", …) so roles are consistent across features.

**Acceptance.** A presentation + Q&A classifies as presentation-with-Q&A, and each
extracted question names its speaker.

**Note.** Diarization alone cannot answer this — pyannote clusters voiceprints and
knows nothing about roles. This must be a semantic (LLM) feature.

---

## 4. [ ] Enable word-level timestamps

**Problem.** Sentence timings in `transcript_segments` are **interpolated estimates**,
not real alignments. `electron.js:1851` distributes each chunk's duration across its
sentences by word count; upstream runs `word_timestamps=False`
(`transcriber.py:90`), so no ground truth exists. Consequences: click-to-seek can land
mid-sentence, and any future audio clipping would cut mid-word.

**Approach.** Turn on word timestamps in the transcriber, align sentence boundaries to
real word timings, and keep the interpolation as a fallback for older data.

**Acceptance.** Segment boundaries correspond to actual speech onsets rather than a
linear word-count guess.

**Why fourth.** It blocks nothing above, but it is the enabler for item 6 — accurate
per-speaker audio clips are impossible without it.

---

## 5. [ ] Per-speaker transcript export with timestamps

**Problem.** A per-speaker *view* exists (`TranscriptDetailPage.tsx:700`), but
`extractSpeakerText` (`:282`) scrapes `[Name]:` tags out of `processed_text` with
regex, discarding every timestamp. No export path reads `transcript_segments` at all,
so **no export format includes timestamps**.

**Approach.** Build speaker-separated output from `transcript_segments` (which have
speaker, text and timings) instead of regexing a text blob. Add speaker filtering to
the existing export modal, and add SRT/VTT — both are nearly free once segments carry
real timings from item 4.

**Acceptance.** "Everything Speaker A said" exports, with timestamps, in every format.

---

## 6. [ ] Per-speaker audio clips

**Problem.** No audio is ever cut by time range anywhere in the codebase — no `-ss`,
`-to` or `atrim` exists. All the plumbing (ffmpeg-static, `execFile` with an argv
array, no shell) is already correct and safe to use.

**Approach.** Cut at **turn level** (pyannote turns are real timings), not sentence
level, until item 4 lands. Follow item 4 for finer granularity. Also auto-load audio
rather than gating seek behind the "Load audio" button.

**Acceptance.** Export a concatenated per-speaker audio file (and/or individual clips)
with the matching transcript alongside it.

---

## 7. [ ] Correctness and honesty fixes

Small, independent, ship alongside the above.

- [ ] `projectAnalysisService.ts:771` — `themeEvolution[].themes[].strength` is
      `Math.random() * 0.5 + 0.5`, commented "Placeholder". Placeholder data is being
      presented as analysis. Either implement it or remove it from the UI.
- [ ] `transcript_segments.sentiment` / `.emotions` are declared in
      `database/schema.sql:149-150` and **never written** by any code path. Either
      populate them per-segment or drop the columns.
- [ ] `ProjectAnalysisExport`'s "pdf" option writes `.html`
      (`ProjectAnalysisExport.tsx:117`). Rename the label or produce a real PDF.
- [ ] `ProjectAnalysisExport` CSV omits speakers, insights and patterns.

---

## Out of scope (deliberately)

- **Cloud sync / multi-user.** Conflicts with the local-first constraint.
- **Speaker identity across recordings** (voiceprints). Useful, but a much larger
  piece of work and a different privacy conversation.
- **Prosody analysis** (pauses, overlap, interruptions, backchannels). Genuinely
  interesting for Q&A detection, but out of scope until the above lands.
- **Real vector-search over analysis.** RAG already exists for Chat and is working;
  extending it to analysis is not needed once map-reduce is in place.

---

## Progress log

| Date | Item | Notes |
|------|------|-------|
| 2026-10-10 | Plan written | Follows the 2026-10-10 security audit remediation; all of that is merged on `main`. |
| 2026-10-10 | 1 — map-reduce | Shipped. `analysisMapReduce.ts` (chunker + generic map-reduce + merge helpers), `researchMerge.ts` (research reducer). All four stages wired: basic, sentiment, emotion, research. 58 new tests. Five of them verified to fail against the previous single-prompt implementation. |