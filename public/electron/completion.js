/**
 * Completion — the single deep module for AI text/JSON generation.
 *
 * Every part of the app that needs the configured AI provider goes through
 * one interface: `complete({ prompt, expects, options, requestId })`. The
 * module resolves provider/url/key/model from settings, decrypts the key,
 * picks the transport (public/ai-providers.js), applies JSON mode, records
 * usage, and exposes mid-flight cancellation via an AbortController registry.
 *
 * Callers know nothing about providers. They pass a prompt and what they
 * expect back ('text' or 'json'); for 'json' the module returns a tolerant
 * parse in `data` and the unparsed string in `raw`, so each caller keeps its
 * own schema-specific recovery without that logic leaking into here.
 *
 * Plain CJS, main-process only. Dependencies are injected so the module is
 * unit-testable without Electron, a real DB, or a live provider.
 *
 * @typedef {Object} CompleteSpec
 * @property {string} prompt
 * @property {'text'|'json'} [expects]
 * @property {{ temperature?: number, maxTokens?: number, timeout?: number }} [options]
 * @property {string} [requestId]  - opaque id; pass the same id to cancel()
 *
 * @typedef {Object} CompleteResult
 * @property {boolean} ok
 * @property {string} [text]   - content (present when ok)
 * @property {string} [raw]    - unparsed content (present when ok)
 * @property {object|null} [data] - tolerant JSON parse when expects:'json', else null
 * @property {object} [usage]
 * @property {string} [error]  - present when !ok
 * @property {string} [provider]
 * @property {string} [model]
 */

const aiProviders = require('../ai-providers');

const JSON_INSTRUCTION =
  '\n\nRespond with only a single valid JSON object. No prose, no markdown, no code fences.';

/**
 * Best-effort JSON extraction: try a straight parse, then strip a ```json
 * fence, then grab the outermost { ... }. Returns null when nothing parses —
 * the caller falls back to its own schema-specific parser.
 */
function tolerantJsonParse(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* try harder below */
  }
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1));
    } catch {
      /* give up */
    }
  }
  return null;
}

/**
 * @param {Object} deps
 * @param {() => any} deps.getDb           - returns the current better-sqlite3 handle (or null)
 * @param {(value: string) => string} deps.decrypt - decrypts a stored setting value
 * @param {(provider: string, model: string, usage: object) => void} deps.recordUsage
 * @param {typeof aiProviders} [deps.providers] - transport layer (injectable for tests)
 */
function makeCompletion({ getDb, decrypt, recordUsage, providers = aiProviders }) {
  // requestId -> AbortController, so cancel() can abort an in-flight fetch.
  const inFlight = new Map();

  function readSetting(key) {
    const db = getDb();
    if (!db) return '';
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value || '';
  }

  /**
   * @param {CompleteSpec} spec
   * @returns {Promise<CompleteResult>}
   */
  async function complete(spec = {}) {
    const { prompt, expects = 'text', options = {}, requestId } = spec;
    if (typeof prompt !== 'string' || prompt.length === 0) {
      return { ok: false, error: 'A prompt is required', text: '', raw: '', data: null };
    }

    const provider = readSetting('aiProvider') || 'ollama';
    const info = providers.getProviderInfo(provider);
    const url = readSetting('aiAnalysisUrl') || info.defaultUrl;
    const storedKey = readSetting('aiApiKey');
    const apiKey = decrypt(storedKey);
    const model = readSetting('aiModel');

    // A key was saved but decrypted to empty -> the OS keychain likely
    // rotated since it was saved. Surface a clear re-enter message instead of
    // a confusing downstream auth error, but only for providers that need a
    // key (local Ollama is unaffected).
    if (info.requiresKey && storedKey && !apiKey) {
      return {
        ok: false,
        error:
          'Your saved API key could not be decrypted (the OS keychain may have changed since you saved it). Please re-enter it in Settings.',
        text: '',
        raw: '',
        data: null,
        provider,
        model,
      };
    }

    const jsonMode = expects === 'json';
    const finalPrompt = jsonMode ? prompt + JSON_INSTRUCTION : prompt;

    let controller;
    let signal;
    if (requestId) {
      controller = new AbortController();
      inFlight.set(requestId, controller);
      signal = controller.signal;
    }

    try {
      const res = await providers.chat(provider, url, apiKey, model, finalPrompt, {
        ...options,
        jsonMode,
        signal,
      });
      if (res.success && res.usage) recordUsage(provider, model, res.usage);
      if (!res.success) {
        return {
          ok: false,
          error: res.error || 'AI request failed',
          text: '',
          raw: '',
          data: null,
          provider,
          model,
        };
      }
      const raw = res.response || '';
      return {
        ok: true,
        text: raw,
        raw,
        data: jsonMode ? tolerantJsonParse(raw) : null,
        usage: res.usage,
        provider,
        model,
      };
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
      return {
        ok: false,
        error: aborted ? 'Cancelled' : err.message,
        text: '',
        raw: '',
        data: null,
        provider,
        model,
      };
    } finally {
      if (requestId) inFlight.delete(requestId);
    }
  }

  /**
   * Abort an in-flight completion by the requestId it was started with.
   * @returns {{ ok: boolean }}
   */
  function cancel(requestId) {
    const controller = inFlight.get(requestId);
    if (!controller) return { ok: false };
    controller.abort();
    inFlight.delete(requestId);
    return { ok: true };
  }

  return { complete, cancel, _inFlight: inFlight };
}

function register(ipcMain, deps) {
  const api = makeCompletion(deps);
  ipcMain.handle('ai:complete', (_e, spec) => api.complete(spec || {}));
  ipcMain.handle('ai:cancel', (_e, requestId) => api.cancel(requestId));
  return api;
}

module.exports = { makeCompletion, register, tolerantJsonParse };
