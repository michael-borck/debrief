# Speaker Insights & Long-Recording Plan

Delivery plan for the speaker-attribution and long-recording work identified in the
2026-10-10 audit.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Context

Debrief handles two recording shapes well today: interviews and small discussions that
fit in a model's context window. Two shapes are weak:

- **Long recordings (presentations, webinars, panels).** See item 1.
- **Presentations with Q&A**, where you want to know who asked what. See item 3.

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

### Execution order

Items 1–3 are done. The remaining work runs **4 → 5 → 6 → 7**.

This ordering was revised after an initial dependency analysis turned out to be
wrong about word timestamps (item 6). They were treated as a blocker for audio
clipping, but audio clips cut at **turn** level — pyannote diarization turns carry
real timings — so they never needed them. Item 6 therefore moved to the front and
became a precision improvement rather than a prerequisite. It is now last because
most of its value (correct sentence boundaries in exports and clips) already ships
without it.

---

## 1. [x] Chunk and map-reduce the analysis pipeline

**Problem.** `fileProcessor.ts` interpolated the entire transcript into a single
prompt, five separate times. A recording that overflowed the model's context window
produces a provider error, which `fileProcessor.ts:356` caught and converted into
empty analysis. The transcript is still saved as `completed` — the user sees a
finished transcript with no summary, no topics, no insights, and no error.

**Delivered.** `analysisMapReduce.ts` (chunker + generic map-reduce + merge helpers)
and `researchMerge.ts` (research reducer). All four stages wired. Reduction is
deterministic for lists, numerics and objects — no extra LLM call — except the
basic-analysis `summary`, which gets one synthesis call over the per-chunk summaries
because concatenating ten chunk summaries is not a summary.

Three properties matter as much as the merging:

1. A single-chunk transcript makes exactly one call and skips the reducer, so there
   is no cost or behaviour regression for the common case.
2. A failing chunk no longer sinks the run — the others still contribute and the
   failure count is logged. Only an all-chunks-failed outcome degrades.
3. Chunks run sequentially. Local providers (Ollama) are typically single-slot, so
   eight concurrent requests would queue and risk rate limits.

**Verified** by reverting the implementation and confirming the new tests fail —
5 of them, including "produces real analysis for a transcript larger than one
prompt".

---

## 2. [x] Stop re-diarisation destroying manual speaker labels

**Problem.** `rediarisationService.rerun` deleted the whole `speaker_tagged` segment
version and rebuilt it, destroying every manual rename and AI-suggested merge. The
user tags speakers carefully, re-runs diarisation to fix a boundary, and silently
loses all their work.

**Delivered.** `speakerLabelPreservation.ts`. Diarization reassigns `SPEAKER_00…`
arbitrarily each run, so ids cannot be compared — instead each new cluster inherits
the name of the old cluster it overlaps most, and only when one old label dominates
(≥60%). Ambiguity is reported, never guessed: a merge (two voices into one cluster)
is surfaced in the UI as needing review, because a confidently mislabelled speaker
corrupts every downstream per-speaker view and export. A pure split is unambiguous
per cluster, so both halves inherit the name and — since `rerun` tallies by name —
merge back into one speaker, healing the split.

---

## 3. [x] Speaker-attributed Q&A extraction and role inference

**Problem.** The research-analysis prompt has always asked the model to attribute
quotes and Q&A pairs to a speaker, and the schema has always had a `speaker` field
waiting for it — but the prompt was handed plain prose with every label stripped
out, so those fields could never be populated. Separately, `interactionPattern` was
inferred from speaker **count** alone, which classified a presentation with six
audience questioners as a "discussion".

**Delivered.** `speakerTranscript.ts`. Research analysis now receives
speaker-labelled prose (`[SPEAKER_00]: …`) built from the diarised chunk timings,
merging consecutive same-speaker chunks into paragraphs so the model sees prose
rather than one line per 10-second window, and falling back to the flat transcript
when no speaker data exists. The prompt states the convention, requires labels be
copied exactly, forbids inventing absent labels, and its JSON example uses real
`SPEAKER_00` rather than placeholders. `qaPairs` gained `questionSpeaker` /
`answerSpeaker` because one field cannot express a Q&A, where questioner and
answerer are different people; the old field is retained for older model output.

`interactionPattern` now uses how the floor was shared: an overwhelmingly dominant
speaker means a presentation however many people spoke, two people trading turns is
an interview regardless of the split, and only a genuinely shared multi-speaker
conversation is a discussion.

**Note.** The prompt is defined twice — camelCase in the renderer defaults,
snake_case in the `electron.js` seed — and which copy wins depends on whether the
database row already exists. Both are updated and a test asserts they stay
identical, because a one-sided edit behaves differently for new and existing
installs.

---

## 4. [x] Per-speaker audio clips

**Problem.** No audio is ever cut by time range anywhere in the codebase — no
`-ss`, `-to` or `atrim` exists. All the plumbing (`ffmpeg-static`, `execFile` with
an argv array and no shell) is already correct and safe to use.

**Approach.** Cut at **turn** level, using the diarization turns, which carry real
timings. Coalesce each speaker's turns into a single audio file with short padding,
so "everything Alice said" is one playable clip rather than a folder of fragments,
and emit the matching transcript alongside it.

This does **not** wait on word timestamps (item 6): turn boundaries are real
diarization output, so clips land on speaker boundaries, not mid-word. Word
timestamps would only tighten the leading/trailing padding.

Also in scope: auto-load the audio rather than gating seek behind the "Load audio"
button, which currently disables click-to-seek entirely until the user acts.

**Acceptance.** Export a per-speaker audio file with the matching transcript, cut on
speaker boundaries, for any transcript with diarization turned on.

**Risk.** Low. New IPC handler, new service, new UI panel. Needs a `speaker_audio`
allow-list discipline like the existing `safe-file` protocol.

---

## 5. [ ] Per-speaker transcript export with timestamps

**Problem.** A per-speaker *view* exists (`TranscriptDetailPage.tsx:700`), but
`extractSpeakerText` (`:282`) scrapes `[Name]:` tags out of `processed_text` with
regex, discarding every timestamp. No export path reads `transcript_segments` at
all, so **no export format includes timestamps**.

**Approach.** Build speaker-separated output from `transcript_segments` — which
carry speaker, text and timings — instead of regexing a text blob. Add speaker
filtering to the existing export modal, and add SRT/VTT, both nearly free once
segments carry timings.

**Honest caveat until item 6 lands.** Sentence-level `start_time`/`end_time` are
**interpolated estimates**: `electron.js` distributes each Whisper chunk's duration
across its sentences by word count, because upstream runs with
`word_timestamps=False`. Chunk and turn timings are real; sentence timings are a
linear guess. Exports must therefore either label their precision or emit
turn-level timestamps. Do not present interpolated sentence timings as exact —
they would be wrong by enough to matter if someone used them to cut audio.

**Acceptance.** "Everything Speaker A said" exports, with timestamps, in every
format; the export states whether timestamps are exact or estimated.

---

## 6. [ ] Word-level timestamps (upstream contribution)

**Problem.** Sentence timings are interpolated, so click-to-seek can land
mid-sentence and any fine-grained cutting would be inaccurate.

**Upstream, not a fork.** `speech-analyser` is MIT-licensed, © 2026 Michael Borck —
the same author as Debrief — and its summary describes it as serving "the analyser
family", so it is shared with `lens`. A private fork would mean rebasing on every
upstream release with `lens` drifting away from it.

The change is small and general, not Debrief-specific:

```python
# today — no way to opt in, and the data cannot even come out
def transcribe(self, audio_path: Path) -> TranscriptionResult:
    raw_segments, info = model.transcribe(str(audio_path), word_timestamps=False)
```

- add `word_timestamps: bool = False` to `transcribe()`
- thread `seg.words` through into a `Segment.words` field

Default-off means **zero behaviour change for existing consumers**, including
`lens`. Word-level alignment is a standard faster-whisper capability that any
consumer of this library will need.

**Decision recorded.** PR upstream; no private fork. While it is in flight,
Debrief needs an interim that is not a fork and not runtime monkey-patching — see
the note below.

**Why runtime patching is wrong here**, even though it was right for the CORS fix:
CORS was *removing* a middleware, a coarse policy decision with no config hook.
Word timestamps would mean *extending a dataclass* (`Segment.words`), which cannot
be done at runtime, and `SpeechAnalyser` holds its transcriber in a private
`_transcriber` attribute with no factory hook and a lazily-populated module-level
cache. It would fail on users' machines rather than in CI. If an interim is needed,
a subclass inside Debrief's own tracked `server.py` is the honest option.

**Acceptance.** Segment boundaries correspond to actual speech onsets; exports and
clips stop labelling their timings as estimated.

---

## 7. [ ] Correctness and honesty fixes

Small, independent, ship alongside the above.

- [ ] `projectAnalysisService.ts` — `themeEvolution[].themes[].strength` is
      `Math.random() * 0.5 + 0.5`, commented "Placeholder". Placeholder data is
      being presented as analysis. Either implement it or remove it from the UI.
- [ ] `transcript_segments.sentiment` / `.emotions` are declared in
      `database/schema.sql` and **never written** by any code path. Either populate
      them per-segment or drop the columns.
- [ ] `ProjectAnalysisExport`'s "pdf" option writes `.html`. Rename the label or
      produce a real PDF.
- [ ] `ProjectAnalysisExport` CSV omits speakers, insights and patterns.

---

## Out of scope (deliberately)

- **Cloud sync / multi-user.** Conflicts with the local-first constraint.
- **Speaker identity across recordings** (voiceprints). Useful, but a much larger
  piece of work and a different privacy conversation.
- **Prosody analysis** (pauses, overlap, interruptions, backchannels). Genuinely
  interesting for Q&A detection, but out of scope until the above lands.
- **Real vector-search over analysis.** RAG already exists for Chat and is working;
  extending it to analysis is unnecessary once map-reduce is in place.

---

## Progress log

| Date | Item | Notes |
|------|------|-------|
| 2026-10-10 | Plan written | Follows the 2026-10-10 security audit remediation, merged on `main`. |
| 2026-10-10 | 1 — map-reduce | Shipped. `analysisMapReduce.ts`, `researchMerge.ts`. All four stages wired. 5 tests verified failing against the previous single-prompt implementation. |
| 2026-10-10 | 2 — label preservation | Shipped. `speakerLabelPreservation.ts`. Names carried across by temporal overlap (ids are reassigned every run). Merges flagged for review; splits heal. 13 tests. |
| 2026-10-10 | 3 — Q&A attribution | Shipped. `speakerTranscript.ts`. Research analysis receives speaker-labelled text; prompt demands attribution (both copies verified in sync); `interactionPattern` inferred from talk share rather than speaker count. 29 tests. |
| 2026-10-10 | 4 — audio clips | Shipped. `speaker-audio.js` (turn prep, filter graph, batching), `db-rpc/diarizationTurns.js`, `SpeakerAudioExport.tsx`. Schema v2 adds `diarization_turns` — turns were computed at import and then thrown away. Turns are now persisted at import and on re-diarisation. Auto-load audio. 30 tests. |
| 2026-10-10 | Reorder | Items 6→5→4. The original plan treated word timestamps as a blocker for audio clips, but clips cut at turn level where pyannote timings are real, so it never was one. Word timestamps moved last as a precision improvement. |
