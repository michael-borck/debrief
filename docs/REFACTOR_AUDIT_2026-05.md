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

**Recommendation:** B now (low risk), then C as the upgrade path. A is overkill for an Electron app marketed as zero-setup.

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

- [ ] Progress + cancellation for transcription (IPC events, AbortController)
- [ ] Modal stack manager
- [ ] Surface diarisation tuning per-transcript
- [ ] Lazy-mount audio player bar

### Sprint 3 — Analytical Depth (~1 week)

- [ ] Port speech-analyser's metrics (WPM, fillers, silence, balance)
- [ ] Composite quality score with insights engine
- [ ] Embedding-based theme clusters using existing LanceDB
- [ ] Per-operation token cost display

### Sprint 4 — Diarisation Upgrade (Optional)

- [ ] Either Python sidecar or external-service backend
- [ ] Only if accuracy remains a complaint after Sprint 2's UI work + Sprint 3's `num_speakers` hint
