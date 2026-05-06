# Deep-Talk Refactor Audit & Sprint Plan

**Date:** 2026-05-06
**Version at audit:** 1.7.0
**Auditor:** Architecture review against speech-analyser sibling project

## TL;DR

Codebase is functionally rich but architecturally strained. Not a from-scratch rewrite — a focused refactor + UX polish. Three real problems:

1. 3,017-line monolithic `public/electron.js`
2. Custom JS diarisation that's awkward and inaccurate compared to pyannote
3. No tests, no error boundary, no cancellation/progress feedback

Thematic analysis is fine architecturally but thin — easy wins available by adding deterministic computed metrics alongside the LLM passes.

---

## 1. Architecture — Refactor Warranted

### Smell

`public/electron.js` (3,017 lines) bundles DB layer, Whisper pipeline, ~300 lines of diarisation, LanceDB wrapper, embedding code, and 52 IPC handlers in one file. `src/services/` (13 services / ~10k LOC) is in decent shape.

### Refactor (in order)

1. **Split `electron.js` into modules** — `electron/db.js`, `electron/audio.js`, `electron/diarise.js`, `electron/whisper.js`, `electron/vector.js`, `electron/ipc.js`. No behaviour change; unblocks everything else.
2. **Remove dead code** — `sqlite3` dep (never imported), `mcp-proxy.json` + `model_config.json` (no MCP calls anywhere), `scripts/spike-diarisation-full.js` (superseded by v2).
3. **Type the IPC bridge** — 92 preload methods, 179 `any` casts, 10+ `window.electronAPI as any`. Generate a `.d.ts` from a single source-of-truth handler list.
4. **Add an error boundary + structured logging** — 96 raw `console.log` calls, no React error boundary; one renderer crash takes the app down.
5. **Tests** — package.json still says `echo "no test specified" && exit 1`. Smoke tests on `FileProcessor`, `ChatService`, and the diarisation pipeline would protect 25k LOC of logic.

---

## 2. Diarisation — Awkward

### Current

~300 lines in `electron.js` — Xenova/transformers VAD + speaker embeddings + hand-rolled hierarchical clustering with cosine similarity. Tuning knobs (`medianFilterFrames`, `minDurationOn`, `clusterThreshold`) buried under "Advanced" in Settings. v1 over-segmented; v2 is the current improvement.

### Why it's awkward

Maintaining a JS reimplementation of pyannote's pipeline. Will always lag pyannote in accuracy, and the bugs are owned in-house. No `num_speakers` hint, no word-level alignment, segment-to-turn alignment is implicit.

### Options (ranked)

| Option | Effort | Quality | Notes |
|---|---|---|---|
| **A. Python sidecar for diarisation** | Med | High | Spawn pyannote-3.1 subprocess on demand. Same UX, far better accuracy. Packaged Python or optional install. |
| **B. Keep JS, improve alignment** | Low | Med | Steal speech-analyser's overlap-matching (`audio_lens.py:_assign_speakers`). Add `num_speakers` hint. |
| **C. Optional external service** | Low | Hi if running | Treat speech-analyser (or any HTTP diariser) as an optional backend; degrade gracefully if absent. Matches existing AI-provider pattern. |

**Recommendation (revised 2026-05-07):** A — pyannote 3.1 via Python sidecar bundling `lens/speech-analyser`. Original "B then C" plan was wrong: the "zero-setup Electron app" framing prioritised installer size over accuracy, but for an analytical tool the user opens a few times a week, a one-time ~500MB model download is a non-issue — an inaccurate transcript is a deal-breaker. The JS reimplementation is also a duplication smell: `lens/speech-analyser` already wraps pyannote + faster-whisper + deterministic metrics, and deep-talk reinvents both halves badly. See revised Sprint 3 below. **No JS fallback** — two pipelines means two bug surfaces; the answer is robust sidecar restart, not graceful degrade.

**Either way, surface the tuning UI properly.** A small "Diarisation quality" panel on the transcript page (one slider for cluster threshold + "rerun" button) would do more for users than four hidden numeric inputs.

---

## 3. Thematic Analysis — OK, but Thin

### Current

Pure LLM prompt-based via `ProjectAnalysisService.performCollatedAnalysis()` and `FileProcessor.performAdvancedAnalysis()`. Prompts user-editable in settings. Themes stored as JSON on `projects.themes` and `transcripts.research_themes`. LanceDB exists but is **only used for chat RAG, not for thematic analysis**.

### Gaps

- No deterministic baseline — every theme run is at the mercy of the LLM.
- LanceDB embeddings sitting unused for clustering.
- No cross-transcript theme deduplication beyond LLM in one pass.
- `generateThemeEvolution` is also pure LLM.

### Easy wins

1. **Embedding-based theme clusters** — k-means or HDBSCAN on segments, label each cluster with one LLM call, show alongside prompt-based themes. Triangulation, not replacement.
2. **Composite conversation metrics** (port from speech-analyser, ~1 day):
   - Speaking rate (WPM)
   - Filler word rate + which words
   - Silence ratio
   - Talk-time balance (you have speakers — one query)
   - Composite quality score 0–100 with sub-factors
   - Rule-based "strengths" / "observations" insights
3. **LLM cost/tokens per analysis pass** — surface the per-operation cost so users see what each "Run Analysis" costs.

---

## 4. UX Gaps (Highest-Leverage Improvements)

| Gap | Fix |
|---|---|
| Long-running transcription has no progress, no cancel | Progress events over IPC + cancellation tokens |
| No error boundary | One `<ErrorBoundary>` in `App.tsx` with "Report this" button |
| Modal stacking unmanaged | Single `<ModalHost>` with stack; close-on-escape; backdrop clicks |
| Diarisation tuning hidden | Per-transcript panel with threshold slider + rerun |
| Audio player bar always rendered | Lazy-mount |
| No skeletons / optimistic UI | Library, Project Detail load slowly with no feedback |
| One giant settings page | Tabs by category (already partly there, finish it) |
| No keyboard shortcuts | Cmd-K command palette |

---

## 5. Patterns to Port from speech-analyser

Borrow patterns, not stack:

1. **Overlap-based time alignment** (`audio_lens.py:10-24`) — ~30 lines, cleaner segment-to-turn merge.
2. **Composite quality score with sub-factors** — every transcript gets a 0–100 dashboard.
3. **Rule-based insights engine** — strengths/observations from thresholds, no LLM cost.
4. **Lazy model loading + cache-check warnings** — diarisation models could show "downloading…" instead of silent stall.
5. **`num_speakers` hint** — "this is a 1-on-1 interview" constrains clustering.
6. **Optional-dependency error type** — `ModelNotAvailableError`-style hierarchy lets UI show "set this up" cards.

---

## Sprint Plan

### Sprint 1 — Foundation (~1 week)

No user-visible change. Unblocks everything else.

- [x] **1.1 Remove dead code** — `sqlite3` dep, `mcp-proxy.json`, `model_config.json`, `scripts/spike-diarisation-full.js` all gone. Lock file synced.
- [x] **1.2 Split `public/electron.js`** (partial) — extracted `public/electron/diarise.js` (376 lines) and `public/electron/vector-store.js` (~290 lines). electron.js: 3017 → 2273 lines. Verified via `node --check`, `tsc`, webpack build. **Deferred (1.2b):** the remaining IPC handler clusters and createWindow/migrations.
- [x] **1.4 Add `<ErrorBoundary>`** in `App.tsx` — `src/components/ErrorBoundary.tsx` with reload + copy-error-details buttons.
- [x] **1.5 Test infrastructure** — Vitest + jsdom + @testing-library/react. `npm test` runs 6 smoke tests (4 on diarisation alignment, 2 on ErrorBoundary). Test files in `tests/`.
- [x] **1.3 Type the IPC bridge** — `src/types/electron.d.ts` is now the canonical declaration, mirroring `public/preload.js` 1:1. The competing inline declaration in `src/types/index.ts` is gone. All 29 `(window.electronAPI as any)` casts removed; typecheck passes. Cross-reference comments link the two files.

### Sprint 2 — UX Visible (~1 week)

- [x] **Progress + cancellation for transcription** — Renderer-side `AbortController`, threaded through `fileProcessor.processFile` and all LLM HTTP calls. Stage union (`analyzing_media` → `extracting` → `loading_model` → `transcribing` → `diarising` → `validating` → `analyzing` → `embedding` → `saving`). `ProcessingItem.status` gains `'cancelled'`. `ProcessingQueue` shows the live stage label and a Cancel button while in progress. Cancellation rejects with `CancelledError`; LLM `fetch` calls accept `signal`. Whisper/diarise inference itself isn't abortable mid-IPC — `abortable()` returns control to the renderer immediately and the orphaned IPC completes harmlessly in main. Cancelled transcripts are persisted as `status='error', error_message='Cancelled by user'` (no schema change).
- [x] **Modal stack manager** — New `<Modal>` wrapper + `<ModalStackProvider>` (mounted at `App.tsx`). Each `<Modal>` registers itself in a stack, picks up an index for layered z-index, listens for Escape only when it's the top modal, dismisses on backdrop click (configurable per modal), uses a portal, and locks body scroll while any modal is open. Migrated 7 simple modals: ShortcutsModal, AboutDialog, LicensesModal, ExportModal, EnhancedDeleteModal, WelcomeModal, AddExistingModal. Complex stateful modals (TranscriptChatModal, ProjectChatModal, GlobalUploadModal, SpeakerTaggingModal, TranscriptEditor, ProjectAnalysisExport) are deferred to a follow-up — same API, just need careful inspection. 11 unit tests cover stack-top escape behaviour, backdrop click flag, z-index layering, and the missing-provider error.
- [x] **Surface diarisation tuning per-transcript** — New `<DiarisationPanel>` on the transcript detail page with a cluster-threshold slider (0.30–0.75), current speaker count, and "Rerun" button. Clicking rerun calls a new `audio.rediarise(audioPath, overrides)` IPC that re-decodes the audio and runs ONLY the diarisation pipeline (no whisper). The renderer pulls existing original segments from the DB, calls IPC, re-aligns chunks via the renderer-side `alignSpeakersToChunks` mirror, replaces `speaker_tagged` segments, and updates `transcripts.speakers`/`speaker_count`. Reuses Sprint 2.A's `AbortController`/`abortable` pattern so the rerun is cancellable. `loadDiarisationSettings()` in `public/electron/diarise.js` now accepts per-call overrides without touching the user's saved global settings.
- [x] **Lazy-mount audio player bar** — Already met by current code. `AudioPlayerBar` is only rendered inside `TranscriptDetailPage`, and only when `transcript.file_path` exists (`TranscriptDetailPage.tsx:611`). The `<audio>` element starts in `loadState='idle'` with no `src`, so no audio is fetched until the user clicks "Load audio". The originally-feared "always rendered" cost is negligible — the audit was conservative. No change required; closing as verified.

### Sprint 3 — Sidecar architecture (revised 2026-05-07, ~1–2 weeks)

Original Sprint 3 (port metrics into JS) and Sprint 4 (maybe-sidecar) are merged. Driver: code duplication across the lens family. `lens/speech-analyser` already wraps pyannote + faster-whisper + the deterministic metrics. Reimplementing them in Electron-JS produces drift and worse accuracy. The lens becomes the canonical analysis backend; deep-talk becomes a thin UI over it.

- [ ] **3.1 Bundle speech-analyser as a Python sidecar.** Ship a Python runtime via `python-build-standalone` inside the .app bundle, install `speech-analyser` into a managed venv on first launch (or pre-bake into the build). Main process owns lifecycle: spawn on app start, health-check via `GET /healthz` on a chosen local port, restart on crash with backoff (1s → 2s → 5s → 30s), surface persistent failures in UI with a "retry" affordance and diagnostic copy. **No JS-pipeline fallback.** First-run model download (~500MB) shown as an explicit progress UI, not a silent stall — same pattern speech-analyser already uses for missing models. Lifecycle is fiddly; budget ~2–3 days for it alone.
- [ ] **3.2 Route diarisation through the sidecar.** Replace `public/electron/diarise.js` calls with HTTP calls into the sidecar. Pass `num_speakers` hint from UI when known. Per-transcript tuning panel (Sprint 2.C) re-wires to the new endpoint without UI changes. Existing transcripts remain valid; the rerun action upgrades them in-place.
- [ ] **3.3 Expose deterministic metrics over the sidecar.** WPM, filler rate + which words, silence ratio, talk-time balance, composite quality score (clarity/depth/balance/pace), rule-based strengths/observations — all already implemented in `speech_analyser/speech_analyzer.py`. Add `POST /metrics` to FastAPI taking a transcript JSON, returning `{score, factors, ratings, insights}`. deep-talk renderer fetches once per transcript, stores on `transcripts.metrics_json`, displays in a quality dashboard panel.
- [ ] **3.4 Embedding-based theme clusters using existing LanceDB.** Renderer-side, unchanged from original Sprint 3. Triangulates the LLM theme pass with k-means/HDBSCAN over segment embeddings, one LLM call per cluster to label.
- [ ] **3.5 Per-operation token cost display.** Renderer-side, unchanged from original Sprint 3.

### Sprint 4 — Removal & unification (~3–5 days)

Done after 3.1–3.3 has soaked for one release. Goal: delete the duplicated JS code paths now that the sidecar is canonical.

- [ ] Delete `public/electron/diarise.js` and the JS Xenova/transformers diarisation deps from package.json. Remove the renderer-side `alignSpeakersToChunks` mirror used by Sprint 2.C's rerun (sidecar does alignment).
- [ ] **Optional:** route whisper transcription through the sidecar too — `speech-analyser` already exposes faster-whisper. Removes another large dep from the renderer bundle and unifies the pipeline end-to-end. Defer if 3.1–3.3 is enough win for now.
