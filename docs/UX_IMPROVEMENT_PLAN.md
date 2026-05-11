# Debrief UX Improvement Plan

**Created:** 2026-04-13
**Status:** Tier 1 + Tier 2 + Tier 3 complete. Tier 4 Phase 1 + Phase 2 complete — Debrief now runs Whisper transcription AND speaker diarisation entirely in-process. No external server, no LLM guessing speakers from text. Build verified clean.

## Background

Debrief computes substantial analysis (sentiment, 6 emotion dimensions, speaker tagging, notable quotes, Q&A pairs, concept frequency, research themes) but most of it never renders on screen. The gap between "what's in the database" and "what a user sees" is the single biggest UX problem.

This plan addresses that gap in tiers, from highest-impact / lowest-effort first.

---

## Tier 1 — Surface what's already built but invisible

These features exist in the backend/database but aren't shown to users. Pure UI work, no new analysis logic.

### 1.1 Show sentiment + emotions on TranscriptDetailPage
- **Status:** Done (2026-04-13)
- New `SentimentCard` component (`src/components/SentimentCard.tsx`) — compact mode on Overview, full mode on Analysis tab
- Score bar visualisation (-1 to +1)
- Top emotions as horizontal bars
- **Where:** `src/pages/TranscriptDetailPage.tsx`, schema fields `sentiment_overall`, `sentiment_score`, `emotions` (JSON)
- **What to build:**
  - Sentiment card: overall label (positive/neutral/negative) + score bar (-1.0 to 1.0)
  - Emotion bars: 6 dimensions (frustration, excitement, confusion, confidence, anxiety, satisfaction) as horizontal bars
  - Place in the "Analysis" or "Overview" tab, near the summary
- **Acceptance:** Open any analysed transcript → see sentiment/emotions visually without clicking

### 1.2 Show validation changes (what AI corrected)
- **Status:** Done (2026-04-13)
- New `ValidationChangesCard` component (`src/components/ValidationChangesCard.tsx`)
- Shown on Overview tab with collapsed view + count badges by type (spelling/grammar/etc.)
- Expand to see original → corrected pairs (first 20)
- **Where:** `src/pages/TranscriptDetailPage.tsx`, schema field `validation_changes` (JSON)
- **What to build:**
  - Collapsed "AI Corrections" section showing original → corrected text
  - Count badge: "AI made N corrections"
  - User can expand to see specific changes (spelling, grammar, punctuation, capitalization)
- **Acceptance:** Trust signal — users can see what was changed and approve/dismiss

### 1.3 Find-in-transcript search
- **Status:** Done (2026-04-13)
- New `HighlightedText` component (`src/components/HighlightedText.tsx`)
- Search input now lives at the top of the Transcript tab (was previously dead UI at page level)
- Highlights matches inline, shows total match count badge, segments containing matches get a gold border
- Clear button (X) to reset
- **Where:** `src/pages/TranscriptDetailPage.tsx` (currently has `searchQuery` state but it filters Library, not the open transcript)
- **What to build:**
  - Search input at top of transcript view
  - Highlight all matches
  - Cmd/Ctrl+G to jump between matches, match counter ("3 of 12")
  - Cmd/Ctrl+F focuses the search input
- **Acceptance:** Researchers can find every mention of a keyword in the current transcript

### 1.4 Inline speaker labels in transcript view
- **Status:** Done (2026-04-13)
- `TimestampedTranscript` now reads `speaker` from `SentenceSegment` and renders coloured speaker badges per segment
- Stable colour palette across 6 distinct speakers
- Speaker tagging modal still available for editing
- **Where:** `src/components/TimestampedTranscript.tsx` (or wherever transcript is rendered)
- **What to build:**
  - When `speakers` data exists, prefix each segment with the speaker label
  - Color-code or visually distinguish each speaker
  - Speaker tagging modal stays for editing, but labels are visible inline by default
- **Acceptance:** Open a transcript with speaker tagging → labels visible without opening any modal

---

## Tier 2 — Port useful analysis from talk-buddy

Pure algorithmic, no LLM calls, high perceived value. Reference: `/Users/michael/Projects/talk-buddy/src/renderer/services/analysis.ts`.

### 2.1 Filler word detection
- **Status:** Done (2026-04-13)
- `detectFillerWords()` in `src/services/conversationMetricsService.ts`
- 18 single-word fillers + 8 multi-word phrases
- New `FillerWordsCard` shows percentage + top 5 with counts, banded rating
  (Excellent ≤2%, Good ≤5%, Noticeable ≤10%, High >10%)

### 2.2 Talk-time distribution per speaker
- **Status:** Done (2026-04-13)
- `analyzeTalkTime()` reads speaker info from sentence segments
- New `TalkTimeCard` shows stacked horizontal bar + per-speaker breakdown
  with words, duration (when available), and percentage
- Detects imbalance (>70% single speaker) and offers context note

### 2.3 Conversation Quality rubric (0-100 score)
- **Status:** Done (2026-04-13)
- Reframed from talk-buddy's personal "Fluency" to neutral observational
  "Quality" — appropriate for analysing other people's conversations
- Four factors, 0-25 each: **Clarity** (filler rate), **Depth** (turn length),
  **Balance** (talk-time evenness), **Pace** (words/min vs 130-170 ideal)
- New `ConversationQualityCard` shows score + factor bars + auto-generated
  strengths and observations
- Compact version on Overview tab, full version on Analysis tab

### Foundation
- New service `src/services/conversationMetricsService.ts` — pure functions,
  no LLM calls, no network. Exports `analyzeConversation()`, `detectFillerWords()`,
  `analyzeTalkTime()`, `countQuestions()`, `calculateQuality()`, `generateInsights()`.
- TranscriptDetailPage loads sentence segments for the current transcript and
  computes metrics with `useMemo`

---

## Tier 3 — Structural improvements

### 3.1 Audio playback synced to transcript
- **Status:** Done (2026-04-14)
- New `useAudioPlayer` hook (`src/hooks/useAudioPlayer.ts`) — loads local files via Electron IPC `fs.readFile`, wraps in Blob URL, exposes play/pause/seek/currentTime via an HTMLAudioElement ref
- New `AudioPlayerBar` component (`src/components/AudioPlayerBar.tsx`) — renders the `<audio>` element, play/pause button, scrubber, time display, error states
- `TimestampedTranscript` accepts `currentPlaybackTime` and `onSeek` props:
  - Click any segment → seeks audio to that segment's `start_time`
  - Currently playing segment is highlighted with primary border
  - Auto-scrolls into view
- Audio is unloaded when navigating away from a transcript

### 3.2 Export to DOCX and PDF
- **Status:** Done (2026-04-14)
- New `exportService.ts` with `buildDocx()` (using `docx@9.6.1`) and `buildPdf()` (using `jspdf@4.2.1`)
- `ExportModal` extended with two new format options; binary path uses async builder, downloads a Blob
- Both formats include metadata, analysis (sentiment, emotions, topics, action items), and the chosen transcript version
- DOCX uses native heading levels and bullet lists; PDF uses helvetica with hand-rolled layout (auto page breaks)

### 3.3 Move advanced settings into a collapsed section
- **Status:** Done (2026-04-14)
- New reusable `Collapsible` component (`src/components/Collapsible.tsx`) — closed by default
- Wrapped the "Advanced Chat Settings" panel (chunking method, max chunk size, chunk overlap, context chunks, memory limit) in a Collapsible
- Wrapped the Vector Database section in a Collapsible and renamed to "Chat Search Index" with friendlier copy
- Conversation Mode radios renamed: "Quote Lookup" / "Smart Search (Recommended)" / "Full Transcript" — non-developer language
- Removed remaining emoji from chat tab section headers

---

## Tier 4 — Simplify

### 4.0 Drop Speaches, run Whisper locally
- **Status:** Phase 1 done (2026-04-14). Phase 2 (diarisation) still pending.
- **Why:** Debrief pitched itself as "privacy-first local desktop" but required users to run a separate Speaches server. Bundling makes the marketing literally true and removes a whole category of bugs (CORS, auth, network).
- **Phase 1 — Local Whisper transcription (done):**
  - New spike script `scripts/spike-whisper.js` validated `@xenova/transformers` Whisper running entirely in-process: ~75 MB tiny.en model, 1.5x realtime, correct output, no network after first download.
  - `public/electron.js` — added `getWhisperPipeline()` (lazy singleton, cache in `app.getPath('userData')/models`), `decodeAudioToFloat32()` via bundled ffmpeg, two new IPC handlers: `local-transcription-load-model` and `local-transcription-transcribe`.
  - Deleted ~400 lines of legacy Speaches code: the entire `transcribe-audio` IPC handler, `transcribeSingleFile` helper, ffmpeg chunking pipeline, `get-speaches-models` handler.
  - Simplified `test-service-connection` to ollama-only (no more service branching, no apiKey).
  - `public/preload.js` — `audio.transcribe(audioPath, modelName)`, `audio.loadTranscriptionModel()`, `onTranscriptionProgress`/`offTranscriptionProgress` for download progress streaming. Removed `services.getSpeachesModels` and the old `audio.transcribeAudio` signature.
  - `src/types/index.ts` — updated `audio` and `services` interfaces.
  - `src/services/fileProcessor.ts` — reads `localTranscriptionModel` from settings (defaults to `Xenova/whisper-tiny.en`), calls `audio.transcribe()`. Dropped Speaches URL/key/model lookups.
  - `src/contexts/ServiceContext.tsx` — speech-to-text status is always `connected` (no server to test). Only Ollama is tested now.
  - `src/pages/SettingsPage.tsx` — Transcription tab fully rewritten:
    - Three-option radio picker: tiny.en (default, 75 MB, "Recommended"), base.en (140 MB, "Balanced"), small.en (470 MB, "Best accuracy")
    - "Download model now" button with live progress messages
    - Removed: Speaches server URL field, bearer key field, free-text model name input, Test button, Refresh models button, status indicator, audio chunk size slider
    - Removed state: `speechToTextUrl`, `speechToTextKey`, `speechToTextModel`, `availableSttModels`, `loadingSttModels`, `audioChunkSize`
    - Removed functions: `fetchSttModels`, the speaches branch of `handleTestConnection`
- **Phase 2 — Local diarisation (done 2026-04-14):**
  - Validated with two spike scripts (`scripts/spike-diarisation-full.js`):
    - `hello.mp3` (1.07s, 1 speaker) → correctly identified 1 speaker, 1 turn
    - `sample.wav` (30s, 2 speakers) → correctly identified 2 speakers, 10 turns with overlapping speech detected
  - Migrated transformers.js from `@xenova/transformers` v2 to `@huggingface/transformers` v4 — v3+ added native PyAnnoteFeatureExtractor support which v2 lacked. Both packages currently coexist; @xenova will be removed in a follow-up cleanup.
  - New `electron.js` diarisation module (~250 lines):
    - `getDiarisationModels()` lazy-loads `onnx-community/pyannote-segmentation-3.0` (~6 MB) + `onnx-community/wespeaker-voxceleb-resnet34-LM` (~25 MB), cached in `userData/models/`
    - `segmentWindow()` runs pyannote on a 5-second window, decodes the powerset class indices into per-frame active-speaker arrays
    - `framesToTurns()` converts frame-level activations into `[start, end, localSpeaker]` turns
    - `embedTurn()` runs wespeaker on a turn's audio slice, producing a 256-d voice embedding (pads to ≥250 ms for stability)
    - `clusterTurns()` does agglomerative cosine clustering at threshold 0.5 to assign global speaker IDs
    - `diariseAudio()` ties it all together — windowed segmentation, per-turn embedding, clustering
    - `alignSpeakersToChunks()` joins diarisation turns to whisper text chunks by timestamp overlap
  - `local-transcription-transcribe` IPC now accepts `enableDiarisation` flag (default true), runs both pipelines, and returns chunk timings with `speaker` populated plus a `speakerTurns` array
  - `createSentenceSegmentsFromChunks()` propagates the speaker field per sentence so the existing `transcript_segments.speaker` column gets populated
  - `fileProcessor.processFile()` overrides `advancedAnalysisResult.speakers` and `speakerCount` with the real diarisation output when present, so the database write uses real audio-derived speakers
  - LLM speaker tagging in `performAdvancedAnalysis` is now a no-op — the call to `performSpeakerTagging` is removed from the default path. The legacy methods (`performSpeakerTagging`, the speaker prompts) are dead code, scheduled for deletion in a follow-up cleanup commit
  - Settings → Processing tab: replaced the `Automatic speaker tagging` checkbox with `Detect speakers from audio` (default ON), with non-jargon copy explaining the tradeoff
  - Build verified clean.
- **Cleanup remaining for full Tier 4:**
  - Delete the dead LLM speaker tagging methods in `fileProcessor.ts` (~150 lines)
  - Delete the speaker_count, speaker_segments, speaker_tagging prompt definitions
  - Remove `@xenova/transformers` from package.json once nothing imports it
  - Drop the orphaned `enableSpeakerTagging` setting row (or migrate it)

### 4.1 Decide on project-level analysis
- `projectAnalysisService.ts` computes theme evolution, speaker interactions, sentiment trends, cross-transcript patterns
- Most never render — either build the UI or delete the dead code

### 4.2 Pick one analysis architecture
- `performAdvancedAnalysis` → `performLegacyAdvancedAnalysis` → 6 separate AI calls
- `oneTaskAtATime` toggle adds branching complexity
- Keep one path, delete the other

---

## Other UX issues identified (not yet tiered)

- Upload page forces project selection up front — should be "transcribe first, assign later"
- No bulk operations (export many, batch tag, select all)
- Analysis has no "done" feedback after transcription progress finishes
- STT confidence scores collected (`confidence` field) but never displayed
- Speaker diarisation has no quality feedback or "re-run with hints"
- No diff view for original vs corrected vs speaker-tagged versions

---

## Progress log

- **2026-04-13** — Plan created. Tier 1 complete: SentimentCard + ValidationChangesCard + HighlightedText components added; in-transcript search wired up; inline speaker labels in TimestampedTranscript; emoji icons replaced with Lucide throughout TranscriptDetailPage. Build verified.
- **2026-04-13** — Tier 2 complete: ported talk-buddy's algorithmic conversation analysis, reframed for Debrief's audience. New `conversationMetricsService.ts` (pure, no LLM). Three new cards: ConversationQualityCard, FillerWordsCard, TalkTimeCard. Surfaces appear on both Overview and Analysis tabs. Build verified.
- **2026-04-14** — Tier 3 complete: audio playback synced to transcript (useAudioPlayer hook + AudioPlayerBar component, click segments to seek, auto-scroll playing segment), DOCX/PDF export (new exportService using docx + jspdf), advanced settings collapsed under reusable Collapsible component. Build verified.
- **2026-04-14** — Tier 4 Phase 1 complete: dropped the Speaches dependency entirely. Whisper now runs in-process via @xenova/transformers (already installed). Validated end-to-end with the spike script — `hello.mp3` transcribed correctly in ~700 ms at 1.5x realtime with the tiny.en model. Settings page rewritten with a simple model picker (tiny.en/base.en/small.en) and a "Download now" button. ~400 lines of legacy Speaches code deleted from electron.js. Build verified clean. Spike script kept in `scripts/spike-whisper.js` as a reproducible validation tool.
- **2026-04-14** — Tier 4 Phase 2 complete: real audio-level speaker diarisation. Pyannote-segmentation-3.0 + wespeaker-voxceleb-resnet34-LM running in-process via @huggingface/transformers v4 (had to upgrade from @xenova v2 because v2 lacked the PyAnnoteFeatureExtractor). Validated on a real 30-second 2-speaker file — pipeline correctly identified both speakers and produced 10 turns including overlap detection. Algorithm: pyannote per 5s window → frame-level powerset classes → per-turn 256-d wespeaker embedding → agglomerative cosine clustering at threshold 0.5 → align by timestamp with whisper segments. Spike kept in `scripts/spike-diarisation-full.js`. LLM speaker tagging is now a dead-code no-op in the default path; will be deleted in a focused cleanup commit. Settings now has a single "Detect speakers from audio" toggle in plain language. Build verified clean.
- **2026-04-14** — Diarisation quality fixes + audio playback rewrite. The first diarisation release produced 66 speakers on a tough 5-speaker file due to (a) frame-level jitter in pyannote output creating micro-fragments, (b) unreliable wespeaker embeddings on sub-500ms clips, (c) single fixed threshold unable to handle both clean and noisy audio. Fixes: median filter (11 frames) over pyannote channels before turn extraction, min_duration_on (0.5s) with short-turn reassignment by nearest neighbour, min_duration_off (0.2s) gap merging within a channel, and a final noise-cluster pass that reassigns clusters totalling less than 3 seconds to the nearest substantial cluster by time. Validated results: 30s clean 2-speaker sample → 2 speakers (correct). 5-min noisy 5-speaker file → 6 speakers (dominant 4 = 98.4% of audio, tail is defensible). 14-min structured qualitative interview → 2 speakers with 52.7/38.0 interviewer/interviewee split (correct). Separately: rewrote audio playback from "fs.readFile → Buffer → Blob URL" to a custom `safe-file://` Electron protocol that streams files directly from disk via net.fetch, fixing the hang on large video files. Spike kept at `scripts/spike-diarisation-v2.js`.
- **2026-04-14** — AI Correction for speaker labels. New `src/services/speakerLabelService.ts` pure function that collects 5 representative text samples per speaker, sends them to the configured Ollama model with a structured JSON prompt, and parses the response into label suggestions + merge candidates. Added "AI Correction" button in SpeakerTaggingModal alongside the existing "Extend Manual Tags" button (the original button is unchanged, the new one is a different workflow). Shows a dedicated suggestions panel with accept/reject checkboxes per suggestion; high-confidence merges are pre-accepted by default. Applying runs the renames + merges in a single transaction, with transitive merge resolution so chained merges work. Nothing is written to disk until the user clicks "Save Tagged Transcript" as before.
- **2026-04-14** — Multi-provider AI support. New `public/ai-providers.js` module abstracts chat + model listing across 7 providers: Ollama (local), OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, Custom. Only 2 code paths under the hood (OpenAI-compatible for 6 providers since Ollama ignores auth on /v1/*, plus Anthropic-native for the /v1/messages endpoint with x-api-key header). Added IPC handlers `ai-list-models`, `ai-test-connection`, `ai-get-providers`. The existing `chat-with-ollama` IPC now dispatches through the provider module, so every existing caller (fileProcessor, speakerLabelService, researcher prompts, etc.) automatically gains multi-provider support with no other code changes. Settings → Processing tab: AI Analysis Service section rewritten with provider dropdown (auto-fills default URL on change), API key field (hidden for Ollama local, password input for cloud providers), Test Connection button, Refresh Models button, and a proper model dropdown populated from the provider. Privacy messaging per provider so users see "🔒 Private — runs on your machine" or "☁ Cloud — transcripts sent to X" before choosing.
- **2026-04-14** — Cleanup pass after the local-first migration. Deleted ~330 lines of dead LLM-based speaker code from `fileProcessor.ts`: `performSpeakerDetection` (which was still being called in the one-task analysis path but its results were silently overridden by the diarisation pipeline downstream — pure waste of LLM tokens), `preprocessTranscriptForSpeakers` (only used by the deleted methods), and `performSpeakerTagging` (already orphaned). The `performAdvancedAnalysis` one-task branch now returns placeholder speaker fields that are overridden in `processFile` by the audio-derived results. Removed `@xenova/transformers` dependency entirely (we migrated to `@huggingface/transformers` v4 during the diarisation work; v4 still loads the `Xenova/whisper-*` model IDs from HF Hub, so the existing settings/values continue to work). Updated `scripts/spike-whisper.js` to import from `@huggingface/transformers` and re-validated end-to-end (still transcribes hello.mp3 correctly, now at 2.46x realtime). Stale comments referencing `@xenova/transformers` updated. Build clean.
- **2026-04-14** — Tier 4.2 complete: dual analysis path consolidation. The legacy monolithic `performLegacyAdvancedAnalysis` (one giant prompt asking for sentiment+emotion+speakers in a single call) was unreliable on smaller models, and its speaker output was discarded by the diarisation override anyway. Deleted it along with `parseAdvancedAnalysisText` and four `extract*` helpers (~123 lines). Also deleted the `oneTaskAtATime` setting from the Settings UI and removed the toggle handlers. The remaining single path runs sentiment + emotion as two focused calls. Build clean.
- **2026-04-14** — Tier 4.1 done a different way. Investigation showed all 6 main `projectAnalysisService` methods are LIVE and rendered — the dead code was actually a few leaf-level fields. Surfaced the two highest-value ones in `ProjectInsightsDashboard`: (a) `mergedActionItems` as a "Project Action Items" card on the overview tab, and (b) `keyQuotes` per speaker as italicised quote blocks on the Speakers tab. Both already populated by `projectAnalysisService`, just never displayed. ~50 lines of JSX, no new computation, no schema changes.
- **2026-04-14** — Toast notification system. New `ToastContext` + `ToastContainer` component. `useToast()` hook lets any component fire `success`/`error`/`info` toasts with a title, body, and duration (0 = sticky). Wired into `UploadPage` so completed transcriptions show a "Transcript ready" toast and failed ones show a sticky "Processing failed" with the error. Bottom-right placement, slide-up animation, dismiss button. Uses the existing accent border + lucide icons for kind differentiation.
- **2026-04-14** — Upload-then-assign-project flow + bulk operations.
  - **Assign-after-upload:** TranscriptDetailPage's Projects card always renders now (even when the transcript isn't in any project), with a "+ Assign to project..." dropdown listing every project the transcript isn't already in. Each existing chip gets a hover X to remove. Refactored the project-loader into a reusable `reloadTranscriptProjects` callback so add/remove can refresh the list without an effect dependency loop.
  - **Bulk operations:** Library page now supports multi-select. TranscriptCard accepts `selectable`/`selected`/`onToggleSelect` props and renders a small checkbox at the top when selectable. Selected cards get an accent ring. The Library header has a Select All / Deselect All toggle. When ≥1 transcript is selected, a sticky bulk action bar slides in with: "+ Add to project..." dropdown, Archive, Delete (move to trash). Each operation processes the selection sequentially with try/catch per item, then fires a toast with N-of-M counts. After each bulk op, the selection clears and the transcript list reloads.
  - **STT confidence (dropped):** transformers.js' whisper pipeline doesn't expose per-chunk logprobs/confidence in its standard output. Surfacing it would require dropping to a lower-level API and computing logprobs manually — cost > value for now. Noted for future work.
  - **Three-way diff view (deferred):** real work, needs a diff library or hand-rolled algorithm + side-by-side viewer. Better as a focused session.
- **2026-04-14** — In-app docs (Option B chosen). The user discovered that clicking docs links in Debrief was opening **child Electron BrowserWindows** (not the system browser as I'd previously claimed) and showing 404s on stale Jekyll pages. Both broken. Fixed by:
  - Installing `react-markdown` + `remark-gfm`
  - Adding webpack rule `test: /\.md$/, type: 'asset/source'` so markdown files become raw string imports
  - Adding `src/declarations.d.ts` so TS understands `*.md` imports
  - New `src/docs/structure.ts` registry — imports all 22 markdown files at build time, defines categories and ordering, provides `searchDocs()` for client-side search
  - Rewriting `src/pages/DocsPage.tsx` from a card grid into a proper three-pane layout: left sidebar with category nav, main content pane with rendered markdown, breadcrumbs, prev/next page nav, client-side search box
  - Adding a `.docs-prose` style block to `index.css` for h1/h2/h3, paragraphs, lists, code blocks, blockquotes, tables, etc.
  - New `/docs/:category/:page` route in `App.tsx` for deep linking
  - Main process: `setWindowOpenHandler` on `mainWindow.webContents` that catches every `window.open` from the renderer and forwards it to `shell.openExternal`. Also a `will-navigate` belt-and-braces handler. **Fixes the "child window" bug for every link in the app, not just docs.**
  - `src/constants/urls.ts` + `public/electron-urls.js` (CJS mirror) — single source of truth for the GitHub repo and issues URLs. Future repo move = one-line change in two files.
  - Help menu "User Guide" now navigates to in-app `/docs` via the existing `navigate` IPC channel — no more system browser hop
  - Sidebar "Help & Support" → internal nav to `/docs/troubleshooting/common-issues`
  - Removed dead `external` branch in Sidebar's helpItems map
  - AboutDialog imports URLs from constants
  - **Content refresh:** rewrote 5 most-stale markdown files to reflect current architecture — `getting-started/first-use.md`, `user-guide/settings.md`, `user-guide/uploading-files.md`, `features/transcription.md`, `features/ai-chat.md`. All Speaches references gone. Multi-provider AI documented. Pyannote/wespeaker diarisation explained. Drag-and-drop, bulk operations, AI Correction button, toast notifications, assign-project-after-upload all covered.
  - Cleaned up stale `@xenova/transformers` reference in `webpack.config.js` externals
- **Backlog:**
  - STT confidence display (would need lower-level transformers.js API)
  - Three-way diff view: original vs corrected vs speaker-tagged
  - Refresh remaining stale docs: `getting-started/quick-start.md`, `getting-started/installation.md`, `user-guide/interface-overview.md`, `user-guide/managing-transcripts.md`, `user-guide/projects.md`, `features/analysis.md`, `features/search.md`, `features/export.md`, `tutorials/*.md`, `troubleshooting/*.md`, `reference/*.md` (lower priority — they're less stale than the 5 already done)
  - Diarisation tuning UI (expose median filter, min duration, cluster threshold as Settings)
  - Cost tracking for cloud providers (token counter + spend estimate)
  - API key encryption via Electron's `safeStorage`
  - First-run modal pointing to in-app docs (now that the docs are actually good)
