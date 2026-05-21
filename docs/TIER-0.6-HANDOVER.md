# Tier 0.6 Handover — db-query IPC → per-domain RPC migration

**Purpose:** let a fresh session resume this refactor cold. Read this doc +
`docs/AUDIT-2026-05-21.md` (the audit tracker) and you have everything.

**What this closes:** C-SEC-3 / H-1 from the audit — the generic `db-query`
IPC lets the renderer run arbitrary SQL strings against the SQLite DB. The
fix is per-domain RPCs that validate inputs and use prepared statements, so
no SQL crosses the IPC boundary. Once every caller is migrated, the generic
handler gets deleted.

---

## Status snapshot (as of 2026-05-21)

**✅ Tier 0.6 is COMPLETE.** All four phases done. The generic `db-query` IPC
is gone; the renderer can no longer run arbitrary SQL.

- **Branches:** Phases 1 & 2 are on `main`. Phase 3 is on `tier0-db-query-phase3`; Phase 4 is on `tier0-db-query-phase4` (branched off phase3). Neither is merged yet — merge phase3 then phase4 (or fast-forward, since phase4 contains phase3).
- **Done:**
  - Phase 1 (infrastructure + `settings` domain). Merged in `787e628`.
  - Phase 2 (`transcripts` + `projects` single-table domains). Merged in `21e03cf`.
  - Phase 3 (the 8 small domains): `projectTranscripts`, `chat`, `projectChat`, `transcriptSegments`, `topics`, `projectAnalysis`, `modelMetadata`. 7 commits on `tier0-db-query-phase3`.
  - Phase 4 (delete + guard) on `tier0-db-query-phase4`: removed the `db-query` `ipcMain.handle` block in `public/electron.js`, the `database:` key in `public/preload.js`, and its type in `src/types/electron.d.ts`. Guard added (vitest + CI grep). Audit ticked.
- **Verification:** `grep -rnE "electronAPI\.database\b|ipcMain\.handle\(\s*['\"]db-query['\"]" --include="*.ts" --include="*.tsx" --include="*.js" src public` → empty.
- **Tests:** 148 passing (Phase 3 added 44 across 7 files; Phase 4 added the guard test). `npx vitest run`. Health: 18 pre-existing TSC errors (react-router-dom v7 + docx — Tier 2, unrelated) — unchanged throughout.

### Phase 2 notes for the Phase 3 implementer
- `transcripts.update` / `projects.update` are the H-1 allow-list gates. Their column allow-lists live in the module files; the renderer no longer builds any SET clause.
- The `transcripts` domain returns RAW rows; the renderer still hydrates via `hydrateTranscriptRow` / inline `JSON.parse`. Keep that contract for the JOIN reads you move in Phase 3.
- **Booleans:** the modules coerce `boolean → 0/1` themselves (better-sqlite3 v11 would too, but `node:sqlite` in the tests rejects raw booleans). Reuse that `bindValue` pattern for any new domain that writes boolean/JSON columns.
- `TrashPage` project cascade-restore: the per-transcript restore writes now use `transcripts.restore`; only the `SELECT DISTINCT t.id ... JOIN project_transcripts` read stays on the generic IPC — move it into the `project_transcripts` domain (`listTrashedIdsForProject(projectId)`).
- The project list/detail aggregation reads (`ProjectContext` loadProjects/loadProject, `getProjectTranscripts`) are the big `project_transcripts` JOINs — they were intentionally left for Phase 3.

### Dev environment note
`node_modules` was repaired this session (`npm install`). If `npx vitest run`
fails with `Cannot find module 'picomatch'/'acorn'`, run `npm install` again —
`package.json` drifted ahead of the install at some point.

---

## The established pattern (copy this for each domain)

Phase 1 built the scaffold. Each new domain is 6 mechanical steps:

### 1. Write `public/electron/db-rpc/<domain>.js`
Export `register(ipcMain, getDb)` plus a testable `make<Domain>(getDb)` factory.
**Critical:** take a `getDb` *getter*, not a `db` handle — `change-database-location`
closes and reopens the DB, so a captured handle goes stale. See `settings.js`.

```js
function make<Domain>(getDb) {
  return {
    someMethod(arg) {
      assertValid(arg);                 // validate at the boundary
      return getDb().prepare('SELECT ...').all(arg);
    },
  };
}
function register(ipcMain, getDb) {
  const api = make<Domain>(getDb);
  ipcMain.handle('<domain>:some-method', (_e, arg) => api.someMethod(arg));
}
module.exports = { register, make<Domain> };
```

### 2. Add to `public/electron/db-rpc/index.js`
```js
const <domain> = require('./<domain>');
function registerAll(ipcMain, getDb) {
  settings.register(ipcMain, getDb);
  <domain>.register(ipcMain, getDb);   // add this
}
```

### 3. Expose in `public/preload.js` under the `db:` key
```js
db: {
  settings: { ... },
  <domain>: {
    someMethod: (arg) => ipcRenderer.invoke('<domain>:some-method', arg),
  },
},
```

### 4. Add types in `src/types/electron.d.ts` under `db:`

### 5. Write `tests/db-rpc-<domain>.test.ts`
- First line MUST be `// @vitest-environment node` (the default jsdom env can't
  load `node:sqlite`).
- Use `node:sqlite` (`DatabaseSync`), NOT better-sqlite3 — the app's
  better-sqlite3 is built against Electron's Node ABI and won't load under
  host-Node vitest. Same SQLite engine, so behavior matches.
- `node:sqlite` has no `transaction(fn)` helper; if the module uses
  `db.transaction(...)`, pass a shim (see `tests/db-rpc-settings.test.ts`).
- `node:sqlite` defaults `foreign_keys` to ON; better-sqlite3 defaults OFF.
  Set the pragma explicitly in tests if cascade behavior matters.
- Load the real schema: `readFileSync(resolve(__dirname,'..','database','schema.sql'))`.

### 6. Migrate renderer call sites
Replace `electronAPI.database.{all,get,run}('<SQL>', [...])` with the typed
RPC. Then verify:
```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"   # must stay at 18
npx vitest run                                 # must stay green
grep -rn "FROM <table>\|INTO <table>\|UPDATE <table>\|DELETE FROM <table>" --include="*.ts" --include="*.tsx" src/   # must be empty
```
Commit per domain (atomic, bisectable).

### Gotcha: the dynamic-table `UPDATE` in TrashPage
`src/pages/TrashPage.tsx` has two `UPDATE ${table} SET ...` where `table` is
`'transcripts'` or `'projects'` (restore from trash). The RPC must expose
`transcripts.restore(id)` and `projects.restore(id)` separately; the renderer
picks which based on item type. Don't carry the dynamic table name across IPC.

---

## H-1: the column-injection fix (do this in the transcripts domain)

`src/contexts/TranscriptContext.tsx` `updateTranscript` builds
`UPDATE transcripts SET ${Object.keys(updates).join(', ')} ...` from
renderer-controlled keys. That's the column-injection vuln. The RPC's
`transcripts.update(id, fields)` MUST validate every key against an
allow-list of real columns before building the SET clause. The allowed
columns (from `database/schema.sql`):

```
title, filename, file_path, duration, file_size, status,
full_text, validated_text, processed_text, validation_changes, summary,
action_items, key_topics, sentiment_overall, sentiment_score, emotions,
speaker_count, speakers, notable_quotes, research_themes, qa_pairs,
concept_frequency, personal_notes, tags, starred, rating, error_message,
processing_started_at, processing_completed_at,
is_archived, archived_at, is_deleted, deleted_at, updated_at
```
Do NOT allow `id` or `created_at`. The JSON-array/object columns
(action_items, key_topics, tags, speakers, emotions, notable_quotes,
research_themes, qa_pairs, concept_frequency, validation_changes) are
stored as JSON strings — the RPC should `JSON.stringify` them if it
receives objects/arrays, mirroring the current renderer behavior.

`src/contexts/ProjectContext.tsx` has the same pattern for projects —
allow-list those columns too:
```
name, description, themes, key_insights, summary, last_analysis_at,
tags, color, icon, is_archived, archived_at, is_deleted, deleted_at, updated_at
```

---

## Phase 2 — transcripts + projects (~39 sites) — ✅ DONE (branch `tier0-db-query-phase2`)

> The tables below are kept as a record of the RPC surface that shipped.
> Method names that landed: see `public/electron/db-rpc/transcripts.js` and
> `projects.js`. (`getFields` shipped as the specific getters `getForChat` /
> `getMetadata`; `listRecentForDup` shipped as `findDuplicates`;
> `listTrashedIdsForProject` was deferred to the `project_transcripts` domain.)


### transcripts domain (31 sites)
Proposed RPC surface (design against these actual call sites):

| Method | Replaces | Call sites |
|---|---|---|
| `list()` | `SELECT * ... WHERE is_deleted != 1 ... ORDER BY created_at DESC` | TranscriptContext.tsx:82 |
| `listTrashed()` | `SELECT * ... WHERE is_deleted = 1 ORDER BY deleted_at DESC` | TrashPage.tsx:26 |
| `listArchived()` | `SELECT * ... WHERE is_archived = 1 ORDER BY archived_at DESC` | ArchivePage.tsx:31 |
| `get(id)` | `SELECT * ... WHERE id = ?` | TranscriptContext.tsx:97, ChatHistoryPage.tsx:59, chatService.ts:907 |
| `getFields(id, cols)` or specific getters | `SELECT title, full_text, processed_text ...`, `SELECT title, duration, speaker_count ...`, `SELECT id, full_text ...` | chatService.ts:756, chatService.ts:875, sentenceSegmentsService.ts:249 |
| `create(row)` | `INSERT INTO transcripts (...)` | UploadPage.tsx:263 |
| `update(id, fields)` **(H-1 allow-list)** | `UPDATE transcripts SET ${sets} ...` | TranscriptContext.tsx:134, CorrectionTrigger.tsx:115, rediarisationService.ts:164, fileProcessor.ts:144 |
| `archive(id)` | `UPDATE ... SET is_archived = 1, archived_at = ? ...` | TranscriptCard.tsx:72, LibraryPage.tsx:127 |
| `softDelete(id)` | `UPDATE ... SET is_deleted = 1, deleted_at = ? ...` | TranscriptCard.tsx:123, LibraryPage.tsx:158 |
| `restore(id)` | `UPDATE ... SET is_deleted = 0, deleted_at = NULL ...` | TrashPage.tsx:72 |
| `remove(id)` | `DELETE FROM transcripts WHERE id = ?` | TranscriptContext.tsx:150, UploadPage.tsx:136, fileProcessor.ts:234, fileProcessor.ts:261 |
| `searchByText(q)` | `SELECT * ... WHERE title LIKE ? OR full_text LIKE ? OR summary LIKE ?` | TranscriptContext.tsx:172 |
| `listRecentForDup()` | `SELECT id, title, created_at FROM transcripts ...` (UploadPage dedup check) | UploadPage.tsx:94 |
| `listTrashedIdsForProject(projectId)` | `SELECT DISTINCT t.id ... JOIN project_transcripts ...` | TrashPage.tsx:70 (cross-domain — could live in project_transcripts) |

Cross-table reads in ProjectContext.tsx:306, ProjectAnalysisExport.tsx:42,
projectChatService.ts:282, projectAnalysisService.ts:191 are
`SELECT t.* FROM transcripts t JOIN project_transcripts ...` — these belong
in the `project_transcripts` domain (Phase 3), not transcripts. Decide per
case; keep the join logic in main, not the renderer.

**Note:** the renderer hydrates rows via `hydrateTranscriptRow` in
TranscriptContext.tsx. Keep returning raw rows from the RPC and let the
renderer hydrate, OR move hydration into the RPC — pick one and be consistent.
Recommend: RPC returns raw rows, renderer hydrates (smaller change, hydration
stays colocated with the Transcript type).

### projects domain (8 sites) — all in `src/contexts/ProjectContext.tsx` + ArchivePage/TrashPage
| Method | Replaces |
|---|---|
| `get(id)` | `SELECT * FROM projects WHERE id = ? AND is_deleted = 0` |
| `listArchived()` | `SELECT * FROM projects WHERE is_archived = 1 ...` |
| `listTrashed()` | `SELECT * FROM projects WHERE is_deleted = 1 ...` |
| `create(row)` | `INSERT INTO projects (...)` |
| `update(id, fields)` **(allow-list)** | `UPDATE projects SET ${updateFields} ...` |
| `archive(id)` | `UPDATE ... SET is_archived = 1 ...` |
| `restore(id)` | `UPDATE ... SET is_deleted = 0 ...` (TrashPage dynamic-table case) |
| `remove(id)` | `DELETE FROM projects WHERE id = ?` |

---

## Phase 3 — 8 small domains (~33 sites) — ✅ DONE (branch `tier0-db-query-phase3`)

> Shipped as `projectTranscripts`, `chat`, `projectChat`, `transcriptSegments`,
> `topics`, `projectAnalysis`, `modelMetadata` (7 modules — chat folded the
> three chat tables together as planned; project_chat became its own module).
> Notes on what differed from the plan below:
> - **projectTranscripts** absorbed the project list/detail aggregate JOINs,
>   the per-project transcript lists (one `listTranscriptsForProject(projectId,
>   {includeDeleted,completedOnly,orderBy})` with a whitelisted orderBy enum
>   covering all 4 call-site variants), link/unlink, project-id lookups, the
>   trashed-id cascade, and `countForProject`.
> - **transcriptSegments** (not `segments`) — named to avoid colliding with the
>   pre-existing version-aware `electronAPI.segments` IPC, which was left
>   untouched. Only the all-versions read (start_time order) + all-versions
>   delete that used db-query were moved.
> - **topics** `replaceForTranscript` made the old DELETE+N-INSERT save atomic
>   (transaction). `transcript_topics` is created in electron.js, not
>   schema.sql, so its test creates the table itself.
> - **projectAnalysis** `insert` keeps both original write paths (explicit
>   created_at vs schema default) to preserve "latest" ordering byte-for-byte.

Original inventory by table (kept for reference):

| Domain / table(s) | Sites | Notable files |
|---|---|---|
| `project_transcripts` (junction) | 11 | ProjectContext.tsx, TrashPage.tsx, project*Service.ts (the `JOIN transcripts` reads live here) |
| `transcript_segments` | 6 | sentenceSegmentsService.ts, fileProcessor.ts, SpeakerTaggingModal.tsx |
| `chat_conversations` | 5 | chatService.ts, ChatHistoryPage.tsx, TranscriptChatModal.tsx |
| `chat_messages` | 3 | chatService.ts |
| `conversation_memory` | 3 | chatService.ts |
| `project_chat_conversations` | 4 | projectChatService.ts |
| `project_chat_messages` | 3 | projectChatService.ts |
| `project_analysis` | 4 | projectAnalysisService.ts, ProjectAnalysisExport.tsx, ProjectInsightsDashboard.tsx |
| `transcript_topics` | 4 | topicsService.ts, TopicsTab.tsx |
| `model_metadata` | 2 | modelMetadataService.ts |

Group the chat tables (`chat_conversations` + `chat_messages` +
`conversation_memory`) into one `chat` module, and the two project_chat
tables into one `projectChat` module — they're always used together.

**Note:** `ai_prompts` and `processing_queue` show 0 `database.*` calls —
`ai_prompts` is already behind `promptService`; confirm `processing_queue`
isn't accessed from the renderer (it may be main-process-only). No work
needed unless the survey turns up callers.

---

## Phase 4 — delete the generic handler + guard — ✅ DONE (branch `tier0-db-query-phase4`)

What shipped:
1. Removed the `db-query` `ipcMain.handle` block in `public/electron.js` (and
   reworded the surrounding RPC-modules comment).
2. Removed the `database:` key from `public/preload.js` and its `database`
   member from `src/types/electron.d.ts`.
3. Added the guard **both** ways (defense in depth — release.yml doesn't run
   the test suite, so the vitest test alone wouldn't gate CI):
   - `tests/no-generic-db-query.test.ts` — runs every `npx vitest run`.
   - a grep step in `release.yml`'s `security-audit` job.
   Both fail if `electronAPI.database` or `ipcMain.handle('db-query'` reappear.
   The regexes match precise call shapes, so doc-comment prose mentioning
   "db-query" doesn't trip them.
4. Ticked C-SEC-3 / H-1 complete in `docs/AUDIT-2026-05-21.md`.

**`ai_prompts` / `processing_queue`:** confirmed 0 renderer SQL callers — no
work needed (`ai_prompts` is behind `promptService`; `processing_queue` is
main-process only).

---

## Suggested cadence
One branch + one merge per phase (matches how Phase 1 landed):
- `tier0-db-query-phase2` → transcripts + projects ✅ merged (`21e03cf`)
- `tier0-db-query-phase3` → the 8 small domains ✅ done (awaiting merge)
- `tier0-db-query-phase4` → delete + guard ✅ done (awaiting merge; built on phase3)

Commit per domain within a phase. Keep `npx tsc --noEmit` at 18 errors and
`npx vitest run` green before each commit.

---

## Refresh the inventory (line numbers drift as you edit)
```bash
# All remaining raw-SQL renderer call sites:
grep -rn "electronAPI\.database\.\(all\|get\|run\|query\)" --include="*.ts" --include="*.tsx" src/

# Per-table counts:
for tbl in transcripts projects project_transcripts transcript_segments \
  transcript_topics chat_conversations chat_messages conversation_memory \
  project_chat_conversations project_chat_messages project_analysis model_metadata; do
  n=$(grep -rhA 6 "electronAPI\.database\." --include="*.ts" --include="*.tsx" src/ \
      | grep -cE "(FROM|INTO|UPDATE|DELETE FROM|JOIN) ${tbl}\b")
  printf "%-32s %s\n" "$tbl" "$n"
done
```
