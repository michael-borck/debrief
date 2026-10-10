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

// ============================================================
// Long-recording behaviour (map-reduce)
// ============================================================
//
// THE BUG THIS COVERS
// Every analysis stage interpolated the ENTIRE transcript into one prompt. A
// transcript that overflowed the model's context window produced a provider error,
// which the stage caught and converted into empty analysis — the transcript still
// saved as 'completed', with a blank summary and no error anywhere. Presentations
// hit this reliably.
//
// These tests drive the mocked seam to fail with a context-overflow error for any
// prompt longer than a realistic window, exactly as a provider does, and assert
// that a long recording now still comes back analysed.

/** ~24k characters of speech — about 45-60 minutes of talk. */
const LONG_TRANSCRIPT = 'This is a sentence of ordinary spoken length. '.repeat(500);

const OVERFLOW_ERROR = { ok: false, text: '', raw: '', data: null, error: 'context length exceeded' };

/** Model that fails when asked to handle more than `maxChars` in one prompt. */
function modelWithWindow(maxChars: number) {
  return vi.fn(async (prompt: string, ...rest: unknown[]) => {
    const transcript = String(prompt);
    if (transcript.length > maxChars) return OVERFLOW_ERROR;
    return ok({ summary: 'section summary', keyTopics: ['scope'], actionItems: [] }, '') as never;
  });
}

describe('long recordings are chunked, not silently dropped', () => {
  it('produces real analysis for a transcript larger than one prompt', async () => {
    // 8000-char window: the old single-prompt code returned empty here.
    vi.mocked(aiComplete).mockImplementation(modelWithWindow(8000) as never);

    const result = await fileProcessor.analyzeTranscript(LONG_TRANSCRIPT);

    expect(aiComplete.mock.calls.length).toBeGreaterThan(1);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.keyTopics.length).toBeGreaterThan(0);
  });

  it('no single request exceeds the chunk budget', async () => {
    vi.mocked(aiComplete).mockImplementation(modelWithWindow(8000) as never);
    await fileProcessor.analyzeTranscript(LONG_TRANSCRIPT);

    for (const [prompt] of vi.mocked(aiComplete).mock.calls) {
      expect(String(prompt).length).toBeLessThanOrEqual(8000);
    }
  });

  it('still makes exactly ONE call for a short transcript (no cost regression)', async () => {
    vi.mocked(aiComplete).mockResolvedValue(
      ok({ summary: 'A good talk', keyTopics: ['pricing'], actionItems: [] })
    );

    const result = await fileProcessor.analyzeTranscript('A short meeting about pricing.');

    expect(aiComplete).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe('A good talk');
  });

  it('merges topics across chunks and dedupes repeats', async () => {
    vi.mocked(aiComplete).mockImplementation(
      vi.fn(async (prompt: string) => {
        // Alternate topics per chunk so the merge has real work to do.
        const topic = String(prompt).includes('ordinary spoken length') ? 'scope' : 'timeline';
        return ok({ summary: 's', keyTopics: [topic, 'scope'], actionItems: [] }) as never;
      }) as never
    );

    const result = await fileProcessor.analyzeTranscript(LONG_TRANSCRIPT);

    expect(result.keyTopics).toContain('scope');
    expect(new Set(result.keyTopics).size).toBe(result.keyTopics.length);
  });

  it('keeps analysis when SOME chunks fail', async () => {
    let call = 0;
    vi.mocked(aiComplete).mockImplementation((async () => {
      call++;
      if (call === 2) return OVERFLOW_ERROR;
      return ok({ summary: 's', keyTopics: ['scope'], actionItems: [] }) as never;
    }) as never);

    const result = await fileProcessor.analyzeTranscript(LONG_TRANSCRIPT);

    // Partial is dramatically better than empty.
    expect(result.keyTopics).toContain('scope');
  });

  it('falls back to empty analysis only when EVERY chunk fails', async () => {
    vi.mocked(aiComplete).mockResolvedValue(OVERFLOW_ERROR as never);

    const result = await fileProcessor.analyzeTranscript(LONG_TRANSCRIPT);

    expect(result).toEqual({ summary: '', keyTopics: [], actionItems: [] });
  });

  it('cancels cleanly mid-run', async () => {
    const controller = new AbortController();
    vi.mocked(aiComplete).mockImplementation((async () => {
      controller.abort();
      return ok({ summary: 's', keyTopics: [], actionItems: [] }) as never;
    }) as never);

    await expect(
      fileProcessor.analyzeTranscript(LONG_TRANSCRIPT, undefined, controller.signal)
    ).rejects.toThrow();
  });
});

describe('long recordings — sentiment, emotion and research', () => {
  it('averages sentiment across chunks and derives a consistent label', async () => {
    const scores = [0.9, -0.5, 0.4];
    let i = 0;
    vi.mocked(aiComplete).mockImplementation((async () => {
      const score = scores[i++ % scores.length];
      return ok({ sentiment: 'positive', sentimentScore: score }) as never;
    }) as never);

    const result = await fileProcessor.performSentimentAnalysis(LONG_TRANSCRIPT);

    expect(aiComplete.mock.calls.length).toBeGreaterThan(1);
    // Mean of 0.9, -0.5, 0.4 across the chunk set -> a positive overall score,
    // and the label must agree with it rather than echoing any single chunk.
    expect(result.sentimentScore).toBeGreaterThan(0);
    expect(result.sentiment).toBe(result.sentimentScore > 0.15 ? 'positive' : 'neutral');
  });

  it('averages emotion per axis across chunks', async () => {
    let i = 0;
    const batches = [
      { frustration: 0.0, excitement: 1.0 },
      { frustration: 0.0, excitement: 0.0 },
    ];
    vi.mocked(aiComplete).mockImplementation((async () => {
      return ok(batches[i++ % batches.length]) as never;
    }) as never);

    const result = await fileProcessor.performEmotionAnalysis(LONG_TRANSCRIPT);

    expect(aiComplete.mock.calls.length).toBeGreaterThan(1);
    expect(result.excitement).toBe(0.5);
    expect(result.frustration).toBe(0);
  });

  it('merges research analysis across chunks instead of losing it', async () => {
    vi.mocked(aiComplete).mockImplementation((async () => {
      return ok({
        notableQuotes: [{ text: 'Ship small', relevance: 0.8 }],
        researchThemes: [{ theme: 'Risk', confidence: 0.6, examples: ['tight deadline'] }],
        qaPairs: [{ question: 'When?', answer: 'Friday' }],
        conceptFrequency: { deadline: { count: 1, contexts: ['Friday'] } },
      }) as never;
    }) as never);

    const result = await fileProcessor.performResearchAnalysis(LONG_TRANSCRIPT);

    expect(aiComplete.mock.calls.length).toBeGreaterThan(1);
    // Concept counts must be summed, not taken from one chunk.
    expect(result.conceptFrequency.deadline.count).toBe(aiComplete.mock.calls.length);
    expect(result.researchThemes[0].theme).toBe('Risk');
    expect(result.qaPairs[0].question).toBe('When?');
  });
});
