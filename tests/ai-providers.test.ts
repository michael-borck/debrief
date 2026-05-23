// @vitest-environment node
//
// Tests for normaliseBaseUrl — the helper that makes Ollama tolerant of a base
// URL pasted without the /v1 suffix (the OpenAI-compatible endpoints live under
// /v1, and a bare host 404s on /v1/* with a cryptic "404 page not found").

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normaliseBaseUrl } = require('../public/ai-providers.js');

describe('normaliseBaseUrl', () => {
  it('appends /v1 for ollama when missing', () => {
    expect(normaliseBaseUrl('ollama', 'http://localhost:11434')).toBe('http://localhost:11434/v1');
  });

  it('strips a trailing slash before appending /v1 for ollama', () => {
    expect(normaliseBaseUrl('ollama', 'http://localhost:11434/')).toBe('http://localhost:11434/v1');
  });

  it('leaves an ollama URL that already ends in /v1', () => {
    expect(normaliseBaseUrl('ollama', 'http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normaliseBaseUrl('ollama', 'http://localhost:11434/v1/')).toBe('http://localhost:11434/v1');
  });

  it('does not touch non-ollama providers (only strips trailing slash)', () => {
    expect(normaliseBaseUrl('anthropic', 'https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1'
    );
    expect(
      normaliseBaseUrl('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai')
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(normaliseBaseUrl('custom', 'https://my.host/api/')).toBe('https://my.host/api');
    expect(normaliseBaseUrl('openai', 'https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });
});
