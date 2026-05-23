// @vitest-environment node
//
// Tests for the Completion module — the single deep seam every AI call goes
// through. Dependencies (db, key decrypt, usage recorder, provider transport)
// are injected, so these run with no Electron, no real DB, and no network.
//
// Covered:
//   - tolerantJsonParse: plain / fenced / prose-wrapped / garbage
//   - config resolution: provider/url/key/model read from settings and
//     forwarded to the transport
//   - JSON mode: prompt is coaxed, jsonMode flag set, data is parsed
//   - text mode: no coax, data is null, raw text returned
//   - decrypt-empty guard: key-requiring provider with an undecryptable key
//     fails closed without calling the transport
//   - usage is recorded on success
//   - transport error is surfaced as { ok: false }
//   - cancel(): aborts the in-flight request and clears the registry

import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { makeCompletion, tolerantJsonParse } = require('../public/electron/completion.js');

const PROVIDER_INFO: Record<string, { defaultUrl: string; requiresKey: boolean }> = {
  ollama: { defaultUrl: 'http://localhost:11434/v1', requiresKey: false },
  openai: { defaultUrl: 'https://api.openai.com/v1', requiresKey: true },
  anthropic: { defaultUrl: 'https://api.anthropic.com/v1', requiresKey: true },
};

function fakeDb(settings: Record<string, string>) {
  return {
    prepare: (_sql: string) => ({
      get: (key: string) =>
        settings[key] !== undefined ? { value: settings[key] } : undefined,
    }),
  };
}

function makeDeps(opts: {
  settings?: Record<string, string>;
  decrypt?: (v: string) => string;
  chat?: ReturnType<typeof vi.fn>;
}) {
  const recordUsage = vi.fn();
  const chat =
    opts.chat ||
    vi.fn(async () => ({ success: true, response: '{"summary":"ok"}', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } }));
  const providers = {
    getProviderInfo: (p: string) => PROVIDER_INFO[p] || PROVIDER_INFO.ollama,
    chat,
  };
  return {
    getDb: () => fakeDb(opts.settings || {}),
    decrypt: opts.decrypt || ((v: string) => v),
    recordUsage,
    providers,
    chat,
  };
}

describe('tolerantJsonParse', () => {
  it('parses plain JSON', () => {
    expect(tolerantJsonParse('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses JSON wrapped in a code fence', () => {
    expect(tolerantJsonParse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('parses JSON embedded in prose', () => {
    expect(tolerantJsonParse('Sure! Here you go: {"a":1} — hope that helps')).toEqual({ a: 1 });
  });
  it('returns null for unparseable input', () => {
    expect(tolerantJsonParse('not json at all')).toBeNull();
    expect(tolerantJsonParse('')).toBeNull();
  });
});

describe('complete — config resolution', () => {
  it('forwards provider/url/key/model from settings to the transport', async () => {
    const deps = makeDeps({
      settings: {
        aiProvider: 'openai',
        aiAnalysisUrl: 'https://example.test/v1',
        aiApiKey: 'sk-123',
        aiModel: 'gpt-4o',
      },
    });
    const { complete } = makeCompletion(deps);
    await complete({ prompt: 'hello', expects: 'text' });

    expect(deps.chat).toHaveBeenCalledTimes(1);
    const [provider, url, key, model] = deps.chat.mock.calls[0];
    expect(provider).toBe('openai');
    expect(url).toBe('https://example.test/v1');
    expect(key).toBe('sk-123');
    expect(model).toBe('gpt-4o');
  });

  it('falls back to the provider default URL when none is set', async () => {
    const deps = makeDeps({ settings: { aiProvider: 'ollama' } });
    const { complete } = makeCompletion(deps);
    await complete({ prompt: 'hi', expects: 'text' });
    const [, url] = deps.chat.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1');
  });
});

describe('complete — JSON vs text mode', () => {
  it('coaxes JSON, sets jsonMode, and returns parsed data', async () => {
    const deps = makeDeps({
      settings: { aiProvider: 'ollama' },
      chat: vi.fn(async () => ({ success: true, response: '{"summary":"done"}' })),
    });
    const { complete } = makeCompletion(deps);
    const res = await complete({ prompt: 'analyse this', expects: 'json' });

    const [, , , , finalPrompt, options] = deps.chat.mock.calls[0];
    expect(finalPrompt).toContain('analyse this');
    expect(finalPrompt.toLowerCase()).toContain('json');
    expect(options.jsonMode).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ summary: 'done' });
    expect(res.raw).toBe('{"summary":"done"}');
  });

  it('text mode does not coax, returns null data', async () => {
    const deps = makeDeps({
      settings: { aiProvider: 'ollama' },
      chat: vi.fn(async () => ({ success: true, response: 'plain answer' })),
    });
    const { complete } = makeCompletion(deps);
    const res = await complete({ prompt: 'chat please', expects: 'text' });

    const [, , , , finalPrompt, options] = deps.chat.mock.calls[0];
    expect(finalPrompt).toBe('chat please');
    expect(options.jsonMode).toBe(false);
    expect(res.data).toBeNull();
    expect(res.text).toBe('plain answer');
  });

  it('returns data:null (not an error) when JSON mode output is unparseable', async () => {
    const deps = makeDeps({
      settings: { aiProvider: 'ollama' },
      chat: vi.fn(async () => ({ success: true, response: 'totally not json' })),
    });
    const { complete } = makeCompletion(deps);
    const res = await complete({ prompt: 'x', expects: 'json' });
    expect(res.ok).toBe(true);
    expect(res.data).toBeNull();
    expect(res.raw).toBe('totally not json');
  });
});

describe('complete — key handling + usage', () => {
  it('fails closed when a required key cannot be decrypted', async () => {
    const deps = makeDeps({
      settings: { aiProvider: 'anthropic', aiApiKey: 'enc:v1:garbage', aiModel: 'claude' },
      decrypt: () => '', // keychain rotated -> decrypts to empty
    });
    const { complete } = makeCompletion(deps);
    const res = await complete({ prompt: 'x', expects: 'text' });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be decrypted/i);
    expect(deps.chat).not.toHaveBeenCalled();
  });

  it('does not trip the guard for keyless providers', async () => {
    const deps = makeDeps({ settings: { aiProvider: 'ollama' }, decrypt: () => '' });
    const { complete } = makeCompletion(deps);
    const res = await complete({ prompt: 'x', expects: 'text' });
    expect(res.ok).toBe(true);
    expect(deps.chat).toHaveBeenCalledTimes(1);
  });

  it('records usage on success', async () => {
    const deps = makeDeps({
      settings: { aiProvider: 'openai', aiApiKey: 'k', aiModel: 'gpt-4o' },
      chat: vi.fn(async () => ({ success: true, response: 'hi', usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 } })),
    });
    const { complete } = makeCompletion(deps);
    await complete({ prompt: 'x', expects: 'text' });
    expect(deps.recordUsage).toHaveBeenCalledWith('openai', 'gpt-4o', { promptTokens: 5, completionTokens: 7, totalTokens: 12 });
  });

  it('surfaces a transport error as { ok: false }', async () => {
    const deps = makeDeps({
      settings: { aiProvider: 'ollama' },
      chat: vi.fn(async () => ({ success: false, error: 'HTTP 500' })),
    });
    const { complete } = makeCompletion(deps);
    const res = await complete({ prompt: 'x', expects: 'text' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('HTTP 500');
    expect(deps.recordUsage).not.toHaveBeenCalled();
  });

  it('rejects an empty prompt before calling the transport', async () => {
    const deps = makeDeps({ settings: { aiProvider: 'ollama' } });
    const { complete } = makeCompletion(deps);
    const res = await complete({ prompt: '', expects: 'text' });
    expect(res.ok).toBe(false);
    expect(deps.chat).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it('aborts an in-flight request by requestId and clears the registry', async () => {
    // Transport that only settles when its AbortSignal fires.
    const chat = vi.fn(
      (_p: string, _u: string, _k: string, _m: string, _prompt: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true }
          );
        })
    );
    const deps = makeDeps({ settings: { aiProvider: 'ollama' }, chat });
    const api = makeCompletion(deps);

    const pending = api.complete({ prompt: 'long one', expects: 'text', requestId: 'req-1' });
    // Give the microtask queue a tick so the request registers.
    await Promise.resolve();
    expect(api._inFlight.has('req-1')).toBe(true);

    expect(api.cancel('req-1')).toEqual({ ok: true });
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Cancelled');
    expect(api._inFlight.has('req-1')).toBe(false);
  });

  it('cancel on an unknown requestId is a no-op', () => {
    const api = makeCompletion(makeDeps({ settings: {} }));
    expect(api.cancel('nope')).toEqual({ ok: false });
  });
});
