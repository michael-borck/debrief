// Tests for deterministic research-analysis merging.
//
// This reducer is what makes a long recording work: per-chunk research results get
// combined arithmetically, so a 3-hour presentation still yields themes, quotes,
// Q&A pairs and concept frequencies instead of a provider context-overflow error.
//
// It lives in its own module (rather than inside fileProcessor) precisely so it can
// be tested here with no provider and no module import side effects.

import { describe, it, expect } from 'vitest';
import { reduceResearchAnalysis } from '../src/services/researchMerge';
import { MERGE_LIMITS } from '../src/services/analysisMapReduce';
import type { ResearchAnalysis } from '../src/services/analysisSchemas';

const chunk = (over: Partial<ResearchAnalysis> = {}): ResearchAnalysis => ({
  notableQuotes: [],
  researchThemes: [],
  qaPairs: [],
  conceptFrequency: {},
  ...over,
});

describe('reduceResearchAnalysis', () => {
  it('returns an empty result for no input', () => {
    expect(reduceResearchAnalysis([])).toEqual({
      notableQuotes: [],
      researchThemes: [],
      qaPairs: [],
      conceptFrequency: {},
    });
  });

  describe('notableQuotes', () => {
    it('dedupes the same quote across chunks', () => {
      const merged = reduceResearchAnalysis([
        chunk({ notableQuotes: [{ text: 'Ship it on Friday', relevance: 0.6 }] }),
        chunk({ notableQuotes: [{ text: 'ship it on friday', relevance: 0.9 }] }),
      ]);
      expect(merged.notableQuotes).toHaveLength(1);
      expect(merged.notableQuotes[0].relevance).toBe(0.9);
    });

    it('keeps the highest-relevance version whole (text, speaker and timestamp)', () => {
      // The version we trust most is the one kept, including its exact text — not
      // the highest score grafted onto the first-seen wording.
      const merged = reduceResearchAnalysis([
        chunk({ notableQuotes: [{ text: 'A Quote', relevance: 0.3 }] }),
        chunk({ notableQuotes: [{ text: 'a quote', relevance: 0.8, speaker: 'SPEAKER_01' }] }),
      ]);
      expect(merged.notableQuotes[0]).toMatchObject({
        text: 'a quote',
        relevance: 0.8,
        speaker: 'SPEAKER_01',
      });
    });

    it('sorts by descending relevance', () => {
      const merged = reduceResearchAnalysis([
        chunk({
          notableQuotes: [
            { text: 'low', relevance: 0.1 },
            { text: 'high', relevance: 0.95 },
          ],
        }),
      ]);
      expect(merged.notableQuotes.map((q) => q.text)).toEqual(['high', 'low']);
    });

    it('caps the list', () => {
      const quotes = Array.from({ length: 40 }, (_, i) => ({ text: `quote ${i}`, relevance: 1 - i / 100 }));
      const merged = reduceResearchAnalysis([chunk({ notableQuotes: quotes })]);
      expect(merged.notableQuotes).toHaveLength(MERGE_LIMITS.notableQuotes);
    });

    it('drops blank quotes and keeps speaker/timestamp when present', () => {
      const merged = reduceResearchAnalysis([
        chunk({
          notableQuotes: [
            { text: '   ', relevance: 1 },
            { text: 'real', relevance: 0.5, speaker: 'SPEAKER_00', timestamp: 12.5 },
          ],
        }),
      ]);
      expect(merged.notableQuotes).toHaveLength(1);
      expect(merged.notableQuotes[0]).toMatchObject({ speaker: 'SPEAKER_00', timestamp: 12.5 });
    });
  });

  describe('researchThemes', () => {
    it('groups the same theme named differently across chunks', () => {
      const merged = reduceResearchAnalysis([
        chunk({ researchThemes: [{ theme: 'Scope Creep', confidence: 0.9, examples: ['a'] }] }),
        chunk({ researchThemes: [{ theme: 'scope creep', confidence: 0.5, examples: ['b'] }] }),
      ]);
      expect(merged.researchThemes).toHaveLength(1);
      expect(merged.researchThemes[0].theme).toBe('Scope Creep');
    });

    it('AVERAGES confidence rather than counting appearances', () => {
      // Inflating confidence because a theme appeared in more chunks would make
      // recurrence look like certainty.
      const merged = reduceResearchAnalysis([
        chunk({ researchThemes: [{ theme: 'Risk', confidence: 1, examples: [] }] }),
        chunk({ researchThemes: [{ theme: 'Risk', confidence: 0, examples: [] }] }),
      ]);
      expect(merged.researchThemes[0].confidence).toBe(0.5);
    });

    it('unions and dedupes examples across chunks', () => {
      const merged = reduceResearchAnalysis([
        chunk({ researchThemes: [{ theme: 'Risk', confidence: 0.8, examples: ['x', 'y'] }] }),
        chunk({ researchThemes: [{ theme: 'Risk', confidence: 0.8, examples: ['y', 'z'] }] }),
      ]);
      expect(merged.researchThemes[0].examples.sort()).toEqual(['x', 'y', 'z']);
    });

    it('caps examples per theme', () => {
      const examples = Array.from({ length: 20 }, (_, i) => `ex ${i}`);
      const merged = reduceResearchAnalysis([
        chunk({ researchThemes: [{ theme: 'Risk', confidence: 1, examples }] }),
      ]);
      expect(merged.researchThemes[0].examples).toHaveLength(MERGE_LIMITS.examplesPerTheme);
    });

    it('sorts by confidence and caps the number of themes', () => {
      const themes = Array.from({ length: 30 }, (_, i) => ({
        theme: `theme ${i}`,
        confidence: i / 30,
        examples: [],
      }));
      const merged = reduceResearchAnalysis([chunk({ researchThemes: themes })]);
      expect(merged.researchThemes).toHaveLength(MERGE_LIMITS.researchThemes);
      expect(merged.researchThemes[0].confidence).toBeGreaterThanOrEqual(
        merged.researchThemes[1].confidence
      );
    });
  });

  describe('qaPairs', () => {
    it('dedupes by question across chunks', () => {
      const merged = reduceResearchAnalysis([
        chunk({ qaPairs: [{ question: 'Why ship on Friday?', answer: 'short' }] }),
        chunk({ qaPairs: [{ question: 'why ship on friday?', answer: 'a much longer answer' }] }),
      ]);
      expect(merged.qaPairs).toHaveLength(1);
      // The longer answer is the more complete one.
      expect(merged.qaPairs[0].answer).toBe('a much longer answer');
    });

    it('preserves speaker and timestamp attribution (plan item 3 groundwork)', () => {
      const merged = reduceResearchAnalysis([
        chunk({ qaPairs: [{ question: 'Q1', answer: 'A1', speaker: 'SPEAKER_02', timestamp: 90 }] }),
      ]);
      expect(merged.qaPairs[0]).toMatchObject({ speaker: 'SPEAKER_02', timestamp: 90 });
    });

    it('drops pairs with no question', () => {
      const merged = reduceResearchAnalysis([
        chunk({ qaPairs: [{ question: '  ', answer: 'orphan answer' }] }),
      ]);
      expect(merged.qaPairs).toHaveLength(0);
    });

    it('caps the list', () => {
      const pairs = Array.from({ length: 60 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
      const merged = reduceResearchAnalysis([chunk({ qaPairs: pairs })]);
      expect(merged.qaPairs).toHaveLength(MERGE_LIMITS.qaPairs);
    });
  });

  describe('conceptFrequency', () => {
    it('SUMS counts across chunks, because that is what frequency means', () => {
      const merged = reduceResearchAnalysis([
        chunk({ conceptFrequency: { roadmap: { count: 3, contexts: ['a'] } } }),
        chunk({ conceptFrequency: { roadmap: { count: 4, contexts: ['b'] } } }),
      ]);
      expect(merged.conceptFrequency.roadmap.count).toBe(7);
    });

    it('unions and caps contexts', () => {
      const merged = reduceResearchAnalysis([
        chunk({ conceptFrequency: { roadmap: { count: 1, contexts: ['a', 'b'] } } }),
        chunk({ conceptFrequency: { roadmap: { count: 1, contexts: ['b', 'c'] } } }),
      ]);
      expect(merged.conceptFrequency.roadmap.contexts.sort()).toEqual(['a', 'b', 'c']);
    });

    it('merges concepts whose casing differs', () => {
      const merged = reduceResearchAnalysis([
        chunk({ conceptFrequency: { Roadmap: { count: 1, contexts: [] } } }),
        chunk({ conceptFrequency: { roadmap: { count: 2, contexts: [] } } }),
      ]);
      expect(Object.keys(merged.conceptFrequency)).toHaveLength(1);
      expect(merged.conceptFrequency.Roadmap.count).toBe(3);
    });
  });

  it('merges a realistic multi-chunk result without losing anything', () => {
    const merged = reduceResearchAnalysis([
      chunk({
        notableQuotes: [{ text: 'We should ship small', relevance: 0.9 }],
        researchThemes: [{ theme: 'Risk', confidence: 0.7, examples: ['tight deadline'] }],
        qaPairs: [{ question: 'What is the deadline?', answer: 'Friday' }],
        conceptFrequency: { deadline: { count: 2, contexts: ['Friday'] } },
      }),
      chunk({
        notableQuotes: [{ text: 'We should ship small', relevance: 0.5 }],
        researchThemes: [{ theme: 'Risk', confidence: 0.9, examples: ['no buffer'] }],
        qaPairs: [{ question: 'What changed?', answer: 'Scope grew' }],
        conceptFrequency: { deadline: { count: 1, contexts: ['midweek'] } },
      }),
    ]);

    expect(merged.notableQuotes).toHaveLength(1);
    expect(merged.notableQuotes[0].relevance).toBe(0.9);
    expect(merged.researchThemes).toHaveLength(1);
    expect(merged.researchThemes[0].confidence).toBe(0.8);
    expect(merged.researchThemes[0].examples.sort()).toEqual(['no buffer', 'tight deadline']);
    expect(merged.qaPairs).toHaveLength(2);
    expect(merged.conceptFrequency.deadline.count).toBe(3);
  });
});