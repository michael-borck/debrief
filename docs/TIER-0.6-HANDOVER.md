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

- **Branch:** all merged work is on `main`. No active feature branch — start a fresh one for the next phase.
- **Done:** Phase 1 (infrastructure + `settings` domain). Merged in `787e628`.
- **Remaining:** Phases 2-4 below. **80 `electronAPI.database.*` calls across 23 files**, 12 domains.
- **Tests:** 67 passing. `npx vitest run`. Health: 18 pre-existing TSC errors (react-router-dom v7 + docx — Tier 2, unrelated).

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

## Phase 2 — transcripts + projects (~39 sites)

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

## Phase 3 — 8 small domains (~33 sites)

Inventory by table (run the survey command at the bottom to refresh line numbers):

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

## Phase 4 — delete the generic handler + guard

1. Confirm zero remaining callers:
   ```bash
   grep -rn "electronAPI\.database\." --include="*.ts" --include="*.tsx" src/   # must be empty
   ```
2. Remove the `db-query` `ipcMain.handle` block in `public/electron.js`
   (search for `LEGACY: generic db-query handler`).
3. Remove the `database:` key from `public/preload.js` and its type in
   `src/types/electron.d.ts`.
4. Add a CI guard so it can't come back. Options:
   - a grep step in `.github/workflows/release.yml` that fails if
     `electronAPI.database.` or `ipcMain.handle('db-query'` appears in `src/`/`public/`.
   - or a vitest test that asserts the string is absent from the bundle.
5. Tick C-SEC-3 / Tier 0.6 complete in `docs/AUDIT-2026-05-21.md`.

---

## Suggested cadence
One branch + one merge per phase (matches how Phase 1 landed):
- `tier0-db-query-phase2` → transcripts + projects
- `tier0-db-query-phase3` → the 8 small domains (can split further if a session runs long)
- `tier0-db-query-phase4` → delete + guard

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
