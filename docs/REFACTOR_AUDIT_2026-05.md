# Debrief Refactor Audit & Sprint Plan

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

**Recommendation (revised 2026-05-07):** A — pyannote 3.1 via Python sidecar bundling `lens/speech-analyser`. Original "B then C" plan was wrong: the "zero-setup Electron app" framing prioritised installer size over accuracy, but for an analytical tool the user opens a few times a week, a one-time ~500MB model download is a non-issue — an inaccurate transcript is a deal-breaker. The JS reimplementation is also a duplication smell: `lens/speech-analyser` already wraps pyannote + faster-whisper + deterministic metrics, and debrief reinvents both halves badly. See revised Sprint 3 below. **No JS fallback** — two pipelines means two bug surfaces; the answer is robust sidecar restart, not graceful degrade.

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

Original Sprint 3 (port metrics into JS) and Sprint 4 (maybe-sidecar) are merged. Driver: code duplication across the lens family. `lens/speech-analyser` already wraps pyannote + faster-whisper + the deterministic metrics. Reimplementing them in Electron-JS produces drift and worse accuracy. The lens becomes the canonical analysis backend; debrief becomes a thin UI over it.

- [x] **3.1 Bundle speech-analyser as a Python sidecar.** Pivoted from PyInstaller (which hit unsolvable polyfill shadowing with torch._dynamo) to `python-build-standalone` (~80 MB extracted) bundled via electron-builder's extraResources, plus a first-launch setup-venv.py that pip-installs `speech-analyser[diarization]>=0.2.0` into `~/Library/Application Support/debrief/venv/` (~1 GB, 3–10 min). `public/electron/sidecar-manager.js` owns lifecycle: detect missing user-data venv → spawn bundled python on setup-venv.py → parse `STEP:` progress lines → spawn server.py on the new venv; ephemeral port from 8765, `GET /healthz` poll for ready, restart with 1/2/5/30s backoff, SIGTERM-then-SIGKILL teardown awaiting child exit. Renderer surface: `<FirstLaunchSetup>` modal (steps + retry on failure) + `<SidecarStatusPill>` (ready/setting_up/starting/failed/stopped). Pyannote model weights bundled in installer at `Contents/Resources/embedded-server/models/` (4 repos, ~150 MB, MIT + CC-BY-4.0). HF_HOME + HF_HUB_OFFLINE=1 set at runtime so the gated repos never get hit. window-all-closed flipped to quit on every platform. Upstream speech-analyser fixes published as 0.2.0 (audio_lens→speech_analyser rename completion, pyannote 4.x compat, cache-friendly token check).
- [x] **3.2a Mount speech-analyser into the sidecar.** `embedded-server/server.py` imports `speech_analyser.app` and adds our `/healthz` route to it, so the sidecar exposes `/healthz`, `/health`, `/`, and `/analyse` (plus `/docs`) all in one. `AUDIO_LENS_MODE=desktop` set before import for CORS. Heavy ML deps installed via pip into the user-data venv (PyTorch + faster-whisper + pyannote.audio).
- [x] **3.2b Route diarisation + transcription through the sidecar.** `public/electron/sidecar-client.js` wraps multipart POST to `/analyse` against the live sidecar port. `local-transcription-transcribe` and `local-transcription-rediarise` IPC handlers rewritten to use it. Renderer return shapes unchanged. **Regression cleanup (2026-05-12):** the cluster-threshold slider is repurposed into a "Number of speakers" dropdown (Auto / 2-8) that passes `num_speakers` to a new debrief-specific `/rediarise` sidecar endpoint; rediarise no longer re-transcribes (whisper skipped). The per-chunk progress UI now uses an indeterminate shimmer + elapsed-time counter instead of a fake percentage. **Remaining:** cancel closes the HTTP connection but the sidecar keeps churning.
- [ ] **3.3 Expose deterministic metrics over the sidecar.** speech-analyser's `/analyse` already returns metrics in the same response (word_count, speaking_rate_wpm, filler_word_rate + words_found, silence_ratio, quality_score with clarity/depth/balance/pace factors, rule-based strengths/observations) — wired via 3.2a. Outstanding: a separate `POST /metrics` taking a transcript JSON for cases where we want to (re)compute metrics on an existing transcript without re-transcribing, plus the renderer-side dashboard panel that fetches and stores on `transcripts.metrics_json`.
- [x] **3.4 Embedding-based theme clusters using existing LanceDB.** Shipped as the **Topics** tab on the transcript detail page. Renderer-side k-means with k-means++ seeding over the 384-dim MiniLM vectors, auto-pick `k` in `[2, 6]` via silhouette score (override dropdown for Auto/2-6), one LLM call per cluster to produce a 3-5 word label + one-sentence summary. Falls back to keyword extraction when no LLM is configured. Results persist to `transcript_topics`; click any passage to jump the audio player. `src/services/topicsService.ts`, `src/components/TopicsTab.tsx`.
- [ ] **3.5 Per-operation token cost display.** Renderer-side, unchanged from original Sprint 3.

### Sprint 4 — Removal & unification (~3–5 days)

Goal: delete the duplicated JS code paths now that the sidecar is canonical.

- [x] **Delete `public/electron/diarise.js`** (376 lines) and the `@huggingface/transformers` dep from package.json (package-lock.json shrunk ~744 lines covering torch/onnx-runtime-web/protobuf). Also removed the in-process whisper pipeline block in electron.js (getTransformers, getWhisperPipeline, DEFAULT_WHISPER_MODEL, decodeAudioToFloat32) — ~95 lines. `local-transcription-load-model` IPC becomes a renderer-compat no-op since faster-whisper loads lazily on first /analyse call. The renderer-side `alignSpeakersToChunks` mirror stays — it's still useful for realigning sidecar-returned speaker turns to existing chunks during rediarise (the canonical copy, tested via tests/diarise.test.ts).
- [x] **Whisper routed through sidecar too** — implicit win from the above. Only one transcription pipeline left.

### Build polish (done alongside Sprint 4)

- [x] `embedded-server/prefetch-models.sh` — build-time wrapper that pulls all 5 model repos (pyannote-3.1 + segmentation + community-1 + wespeaker + faster-whisper-base) via pure huggingface_hub.snapshot_download, ~218 MB on disk. Sources `embedded-server/.env` locally; CI uses repo secret `HF_TOKEN`.
- [x] `scripts/notarize.js` — afterSign hook reading `NOTARIZE_APPLE_ID / _PASSWORD / _TEAM_ID` (renamed from APPLE_* so electron-builder's auto-wrapper doesn't fire alongside ours). electron-builder.json: `hardenedRuntime: true`, identity removed (auto-detects from CSC_LINK), `notarize: false` (hook handles it), arch narrowed to arm64 to match bundle-python.sh.
- [x] `.github/workflows/release.yml` — macOS arm64 release pipeline on `macos-14` runner: setup-node + setup-python, `npm run build:sidecar` (chains bundle-python.sh + prefetch-models.sh) with HF_TOKEN secret, CSC_LINK + NOTARIZE_APPLE_* secrets feeding electron-builder + notarize.js, draft release promoted to latest on success. Triggers on tag push v* and workflow_dispatch.
- [x] **Rename: deep-talk → Debrief.** ~500 substitutions across two passes (deep-talk → deep-debrief → Debrief), appId `app.borck.debrief`, productName `Debrief`. `migrateLegacyUserDataDir()` walks every legacy slug so existing data survives. GitHub repo renamed `michael-borck/deep-talk` → `michael-borck/debrief`.
- [x] **User docs refresh** — quick-start / first-use / transcription / settings / system-requirements / README rewritten to describe the sidecar architecture honestly, including a "Known limitations" section for the regressions noted under 3.2b.
