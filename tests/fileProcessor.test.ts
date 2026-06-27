// Tests for the FileProcessor analysis pipeline. The two external seams —
// promptService (prompt text) and aiComplete (the Completion IPC wrapper) —
// are mocked, so these exercise the validation/coercion/fallback logic with
// no Electron, no DB, and no network. The schemas under test live in
// analysisSchemas.ts; these tests pin their tolerant behaviour.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aiComplete } from '../src/services/aiCompletion';
import { fileProcessor } from '../src/services/fileProcessor';

vi.mock('../src/services/promptService', () => ({
  promptService: { getProcessedPrompt: vi.fn(async () => 'MOCK PROMPT') },
}));
vi.mock('../src/services/aiCompletion', () => ({
  aiComplete: vi.fn(),
}));

// Shape a successful Completion result. `data` is the tolerant JSON parse from
// main; `raw` is the raw model text used by the text-fallback path.
function ok(data: unknown, raw = '') {
  return { ok: true, text: '', raw, data };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('analyzeTranscript', () => {
  it('returns typed summary/topics/actions from model JSON', async () => {
    vi.mocked(aiComplete).mockResolvedValue(
      ok({ summary: 'A good talk', keyTopics: ['pricing', 'timeline'], actionItems: ['draft'] })
    );

    const result = await fileProcessor.analyzeTranscript('some transcript');

    expect(result).toEqual({
      summary: 'A good talk',
      keyTopics: ['pricing', 'timeline'],
      actionItems: ['draft'],
    });
    expect(aiComplete).toHaveBeenCalledWith('MOCK PROMPT', 'json', undefined);
  });

  it('returns empty result without calling the model for empty input', async () => {
    const result = await fileProcessor.analyzeTranscript('   ');
    expect(result).toEqual({ summary: '', keyTopics: [], actionItems: [] });
    expect(aiComplete).not.toHaveBeenCalled();
  });

  it('coerces malformed JSON fields into safe defaults', async () => {
    // keyTopics are numbers (not strings), actionItems is a string (not array),
    // summary missing — the schema must not pass garbage through nor throw.
    vi.mocked(aiComplete).mockResolvedValue(
      ok({ keyTopics: [1, 2, 3], actionItems: 'not an array' })
    );

    const result = await fileProcessor.analyzeTranscript('t');

    expect(result.summary).toBe('');
    expect(result.keyTopics).toEqual([]);
    expect(result.actionItems).toEqual([]);
  });

  it('falls back to text parsing when no JSON is returned', async () => {
    vi.mocked(aiComplete).mockResolvedValue(
      ok(
        null,
        'Summary: The team discussed the roadmap.\nKey topics:\n- Pricing\n- Timeline\n\nAction items:\n- Draft proposal'
      )
    );

    const result = await fileProcessor.analyzeTranscript('t');

    expect(result.summary).toBe('The team discussed the roadmap.');
    expect(result.keyTopics).toEqual(['Pricing', 'Timeline']);
  });

  it('returns empty when the model call fails', async () => {
    vi.mocked(aiComplete).mockResolvedValue({
      ok: false,
      error: 'boom',
      text: '',
      raw: '',
      data: null,
    });

    const result = await fileProcessor.analyzeTranscript('t');
    expect(result).toEqual({ summary: '', keyTopics: [], actionItems: [] });
  });

  it('rethrows a cancellation error and does not swallow it as empty', async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(fileProcessor.analyzeTranscript('t', undefined, ac.signal)).rejects.toThrow(
      /cancel/i
    );
    // checkCancelled fires before the model call
    expect(aiComplete).not.toHaveBeenCalled();
  });
});

describe('performSentimentAnalysis', () => {
  it('coerces numeric strings and keeps provided values', async () => {
    vi.mocked(aiComplete).mockResolvedValue(
      ok({ sentiment: 'positive', sentimentScore: '0.9' })
    );

    const result = await fileProcessor.performSentimentAnalysis('t');
    expect(result).toEqual({ sentiment: 'positive', sentimentScore: 0.9 });
  });

  it('defaults to neutral / 0 when fields are missing', async () => {
    vi.mocked(aiComplete).mockResolvedValue(ok({}));

    const result = await fileProcessor.performSentimentAnalysis('t');
    expect(result).toEqual({ sentiment: 'neutral', sentimentScore: 0 });
  });
});

describe('performEmotionAnalysis', () => {
  it('returns a coerced emotion map', async () => {
    vi.mocked(aiComplete).mockResolvedValue(ok({ joy: '0.8', anger: 0.2 }));

    const result = await fileProcessor.performEmotionAnalysis('t');
    expect(result).toEqual({ joy: 0.8, anger: 0.2 });
  });

  it('returns an empty object when there is no data', async () => {
    vi.mocked(aiComplete).mockResolvedValue(ok(null));
    expect(await fileProcessor.performEmotionAnalysis('t')).toEqual({});
  });
});

describe('performResearchAnalysis', () => {
  it('returns validated research structures from model JSON', async () => {
    vi.mocked(aiComplete).mockResolvedValue(
      ok({
        notableQuotes: [{ text: 'quote one', relevance: '0.8', speaker: 'A' }],
        researchThemes: [{ theme: 'growth', confidence: 0.7, examples: ['x'] }],
        qaPairs: [{ question: 'why?', answer: 'because' }],
        conceptFrequency: { strategy: { count: '3', contexts: ['c'] } },
      })
    );

    const result = await fileProcessor.performResearchAnalysis('t');

    expect(result.notableQuotes).toEqual([
      { text: 'quote one', relevance: 0.8, speaker: 'A' },
    ]);
    expect(result.researchThemes[0]).toMatchObject({ theme: 'growth', confidence: 0.7 });
    expect(result.qaPairs).toEqual([{ question: 'why?', answer: 'because' }]);
    expect(result.conceptFrequency.strategy).toEqual({ count: 3, contexts: ['c'] });
  });

  it('drops malformed array elements but keeps valid ones', async () => {
    vi.mocked(aiComplete).mockResolvedValue(
      ok({
        notableQuotes: [
          { text: 'good', relevance: 0.5 }, // valid
          'a bare string', // wrong shape — dropped
          { relevance: 0.1 }, // valid (text defaults to '')
        ],
      })
    );

    const result = await fileProcessor.performResearchAnalysis('t');
    expect(result.notableQuotes).toHaveLength(2);
    expect(result.notableQuotes[0].text).toBe('good');
    expect(result.notableQuotes[1].text).toBe('');
  });

  it('returns empty-shaped result for empty input without calling the model', async () => {
    const result = await fileProcessor.performResearchAnalysis('');
    expect(result).toEqual({
      notableQuotes: [],
      researchThemes: [],
      qaPairs: [],
      conceptFrequency: {},
    });
    expect(aiComplete).not.toHaveBeenCalled();
  });

  it('falls back to heuristic parsing and still returns a typed shape', async () => {
    vi.mocked(aiComplete).mockResolvedValue(ok(null, 'some raw model text'));

    const result = await fileProcessor.performResearchAnalysis('Hello world. What is AI?');

    // The fallback parser produces arrays / a record; the schema re-validates.
    expect(Array.isArray(result.notableQuotes)).toBe(true);
    expect(Array.isArray(result.researchThemes)).toBe(true);
    expect(Array.isArray(result.qaPairs)).toBe(true);
    expect(typeof result.conceptFrequency).toBe('object');
  });
});

describe('performAdvancedAnalysis', () => {
  it('returns neutral defaults for empty input', async () => {
    const result = await fileProcessor.performAdvancedAnalysis('  ');
    expect(result).toEqual({
      sentiment: 'neutral',
      sentimentScore: 0,
      emotions: {},
      speakerCount: 1,
      speakers: [],
      processedText: '  ',
    });
    expect(aiComplete).not.toHaveBeenCalled();
  });
});
