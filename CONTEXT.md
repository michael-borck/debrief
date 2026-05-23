# Debrief — Context

Domain language for Debrief, an Electron + React desktop app that transcribes, diarises, and AI-analyses conversation recordings locally. This file is seeded from the AI-provider architecture review (2026-05-23); extend it as more areas are sharpened.

## Language

### AI completion

**Completion**:
The single deep module (main process, `public/electron/completion.js`, interface `complete(spec)`) that takes a prompt and a result expectation and returns text or parsed JSON from whatever provider the user has configured. It resolves URL/key/model, selects the transport, applies JSON mode, records usage, and is reached over the one `ai:complete` IPC.
_Avoid_: chat, ask, LLM call, generate (these name an act, not the module).

**Provider transport**:
The per-provider adapter layer (`public/ai-providers.js`) that the **Completion** module calls — the part that actually varies per provider (OpenAI-compatible vs Anthropic request/response shapes). It sits *behind* the Completion seam.
_Avoid_: provider client, AI client, driver.

**Provider**:
A configured AI backend: `ollama`, `openai`, `anthropic`, `groq`, `gemini`, `openrouter`, or `custom`. Identified by the `aiProvider` setting; its URL, key requirement, and defaults come from `PROVIDERS` in the provider transport.
_Avoid_: model, vendor, backend.

**Expects (`'text' | 'json'`)**:
The result shape a caller asks the **Completion** module for. `'json'` makes the module request structured output per-provider and run a generic tolerant parse; schema-specific recovery (e.g. `parseAnalysisText`) stays with the caller, not the module.
_Avoid_: format, mode, response type.

### Caller families

**Analysis pipeline**:
The import-time sequence in `fileProcessor.ts` that validates, summarises, and extracts sentiment/emotion/research from a transcript. Calls **Completion** with `expects: 'json'`. (Historically called Ollama's `/api/generate` directly, ignoring the configured **Provider** — the bug this review targets.)
_Avoid_: processing, analysis service.

**Chat**:
Interactive Q&A over a transcript or project (`chatService`, `projectChatService`). Calls **Completion** with `expects: 'text'`.
_Avoid_: conversation (reserve "conversation" for the recording being analysed).

## Example dialogue

> **Dev:** When a user picks Anthropic in Settings, does the analysis pipeline use it?
> **Owner:** It should — anything that talks to a model goes through the **Completion** module now, so the **Provider** is honoured everywhere, not just in **Chat**.
> **Dev:** And the JSON the analysis needs?
> **Owner:** The caller passes `expects: 'json'`. The **Completion** module asks the **Provider transport** for structured output and does the tolerant parse. If the parse fails, it hands back the raw text and the **Analysis pipeline** runs its own schema fallback.
