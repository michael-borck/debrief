/**
 * AI provider abstraction for chat + model listing.
 *
 * Supports three API shapes:
 *   - Ollama-native (POST /api/generate, GET /api/tags)
 *   - OpenAI-compatible (POST /v1/chat/completions, GET /v1/models) —
 *     used by OpenAI, Groq, OpenRouter, Gemini (via its OpenAI-compat
 *     endpoint), and any custom server
 *   - Anthropic-native (POST /v1/messages with x-api-key header)
 *
 * Everything is normalised to a common return shape so callers don't
 * care which provider is in use:
 *   chat: { success: boolean, response: string, error?: string }
 *   listModels: { success: boolean, models: string[], error?: string }
 *   testConnection: { success: boolean, error?: string }
 *
 * This module is plain CJS and runs in the Electron main process only.
 */

const PROVIDERS = {
  ollama: {
    name: 'Ollama (local)',
    defaultUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    isLocal: true,
    description: 'Runs on your computer. Nothing leaves your machine.',
  },
  openai: {
    name: 'OpenAI',
    defaultUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    isLocal: false,
    description: 'GPT-4, GPT-4o, o1. Transcripts sent to OpenAI.',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    defaultUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    isLocal: false,
    description: 'Claude Sonnet, Opus, Haiku. Transcripts sent to Anthropic.',
  },
  gemini: {
    name: 'Google Gemini',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresKey: true,
    isLocal: false,
    description: 'Gemini 1.5 Pro, Flash. Transcripts sent to Google.',
  },
  groq: {
    name: 'Groq',
    defaultUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    isLocal: false,
    description: 'Fast inference for Llama, Mixtral, Gemma. Transcripts sent to Groq.',
  },
  openrouter: {
    name: 'OpenRouter',
    defaultUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    isLocal: false,
    description: 'Gateway to hundreds of models from multiple providers.',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    defaultUrl: '',
    requiresKey: false,
    isLocal: false,
    description: 'Any OpenAI-compatible server. You provide the URL.',
  },
};

function getProviderInfo(provider) {
  return PROVIDERS[provider] || PROVIDERS.ollama;
}

function stripSlash(url) {
  return (url || '').replace(/\/+$/, '');
}

// Ollama's OpenAI-compatible API lives under /v1. Users often paste the bare
// host (http://localhost:11434), which then 404s on /v1/* paths with a cryptic
// "404 page not found". Append /v1 for Ollama when it's missing; other
// providers carry their own correct base, so leave them untouched.
function normaliseBaseUrl(provider, url) {
  const stripped = stripSlash(url);
  if (provider !== 'ollama') return stripped;
  return /\/v1$/.test(stripped) ? stripped : `${stripped}/v1`;
}

// A request always carries a timeout; callers (the Completion module) may
// also pass an AbortSignal for true mid-flight cancellation. Combine them so
// whichever fires first aborts the fetch.
function buildSignal(options) {
  const timeout = AbortSignal.timeout(options.timeout ?? 120000);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

async function safeErrorText(response) {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

// ============================================
// List models
// ============================================

async function listModels(provider, url, apiKey) {
  try {
    const info = getProviderInfo(provider);
    const effectiveUrl = normaliseBaseUrl(provider, url || info.defaultUrl);
    if (!effectiveUrl) {
      return { success: false, models: [], error: 'No URL configured for this provider' };
    }

    // Anthropic uses its own API shape; everything else (including
    // Ollama, which exposes /v1/models and ignores auth on that path)
    // goes through the OpenAI-compatible adapter.
    if (provider === 'anthropic') {
      return await anthropicListModels(effectiveUrl, apiKey);
    }
    return await openaiListModels(effectiveUrl, apiKey);
  } catch (error) {
    return { success: false, models: [], error: error.message };
  }
}

async function openaiListModels(url, apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

  const response = await fetch(`${stripSlash(url)}/models`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    return { success: false, models: [], error: `HTTP ${response.status}: ${await safeErrorText(response)}` };
  }
  const data = await response.json();
  const models = Array.isArray(data.data)
    ? data.data.map((m) => m.id || m.name).filter(Boolean).sort()
    : [];
  return { success: true, models };
}

async function anthropicListModels(url, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, models: [], error: 'Anthropic requires an API key' };
  }
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey.trim(),
    'anthropic-version': '2023-06-01',
  };
  const response = await fetch(`${stripSlash(url)}/models`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    return { success: false, models: [], error: `HTTP ${response.status}: ${await safeErrorText(response)}` };
  }
  const data = await response.json();
  const models = Array.isArray(data.data)
    ? data.data.map((m) => m.id).filter(Boolean)
    : [];
  return { success: true, models };
}

// ============================================
// Chat / generate
// ============================================

/**
 * Make a single-shot chat/generate call.
 *
 * @param {string} provider
 * @param {string} url
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @param {object} options - { temperature, maxTokens, timeout }
 * @returns {Promise<{success: boolean, response: string, error?: string}>}
 */
async function chat(provider, url, apiKey, model, prompt, options = {}) {
  try {
    const info = getProviderInfo(provider);
    const effectiveUrl = normaliseBaseUrl(provider, url || info.defaultUrl);
    if (!effectiveUrl) {
      return { success: false, response: '', error: 'No URL configured for this provider' };
    }
    if (!model) {
      return { success: false, response: '', error: 'No model selected. Pick one in Settings → Processing.' };
    }

    // Anthropic has its own request/response shape. Everything else
    // (Ollama, OpenAI, Groq, Gemini, OpenRouter, Custom) uses the
    // OpenAI-compatible /v1/chat/completions endpoint. Ollama ignores
    // the Authorization header on its /v1/* paths, so a blank key just
    // works.
    if (provider === 'anthropic') {
      return await anthropicChat(effectiveUrl, apiKey, model, prompt, options);
    }
    return await openaiChat(effectiveUrl, apiKey, model, prompt, options);
  } catch (error) {
    return { success: false, response: '', error: error.message };
  }
}

async function openaiChat(url, apiKey, model, prompt, options) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
  };
  // Structured-output mode: ask OpenAI-compatible servers (incl. Ollama's
  // /v1 endpoint) to return a JSON object. The prompt must also mention JSON,
  // which the Completion module guarantees before calling.
  if (options.jsonMode) body.response_format = { type: 'json_object' };

  const response = await fetch(`${stripSlash(url)}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: buildSignal(options),
  });
  if (!response.ok) {
    return { success: false, response: '', error: `HTTP ${response.status}: ${await safeErrorText(response)}` };
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const u = data?.usage || {};
  const usage = {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
  };
  return { success: true, response: content, usage };
}

async function anthropicChat(url, apiKey, model, prompt, options) {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, response: '', error: 'Anthropic requires an API key' };
  }
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey.trim(),
    'anthropic-version': '2023-06-01',
  };
  // Anthropic has no native JSON-object mode; the Completion module coaxes
  // JSON via the prompt when expects:'json', so nothing extra is set here.
  const response = await fetch(`${stripSlash(url)}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: buildSignal(options),
  });
  if (!response.ok) {
    return { success: false, response: '', error: `HTTP ${response.status}: ${await safeErrorText(response)}` };
  }
  const data = await response.json();
  // Anthropic returns { content: [{ type: 'text', text: '...' }, ...], ... }
  const blocks = Array.isArray(data.content) ? data.content : [];
  const content = blocks
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('');
  const u = data?.usage || {};
  const usage = {
    promptTokens: u.input_tokens ?? 0,
    completionTokens: u.output_tokens ?? 0,
    totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
  };
  return { success: true, response: content, usage };
}

// ============================================
// Test connection
// ============================================

/**
 * Cheap probe — tries to list models, which exercises auth + URL
 * without making an actual completion call.
 */
async function testConnection(provider, url, apiKey) {
  const result = await listModels(provider, url, apiKey);
  return {
    success: result.success,
    error: result.error,
    modelCount: result.success ? result.models.length : 0,
  };
}

module.exports = {
  PROVIDERS,
  getProviderInfo,
  normaliseBaseUrl,
  listModels,
  chat,
  testConnection,
};
