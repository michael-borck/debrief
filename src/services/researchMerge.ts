// Deterministic merge of per-chunk research analyses.
//
// Lives outside fileProcessor so it can be unit-tested without a provider or the
// module's import side effects. Every field here merges arithmetically — no LLM
// call, nothing that can fail, and nothing that depends on provider behaviour.
// Only the basic-analysis summary needs a synthesis call (see
// fileProcessor.reduceBasicAnalysis), because concatenating ten chunk summaries is
// not a summary.

import { mergeNumbers, MERGE_LIMITS } from './analysisMapReduce';
import type { ResearchAnalysis } from './analysisSchemas';

/** Case/whitespace-insensitive key, so "Scope" and "scope " collapse. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The first spelling we saw for a normalised key — used to keep display casing. */
function preferredSpelling(candidates: string[], key: string): string {
  return candidates.find((c) => norm(c) === key) ?? key;
}

export function reduceResearchAnalysis(results: ResearchAnalysis[]): ResearchAnalysis {
  // --- notableQuotes: dedupe by text, highest relevance wins ---
  const quotes = new Map<
    string,
    { text: string; relevance: number; speaker?: string; timestamp?: number }
  >();
  for (const result of results) {
    for (const quote of result.notableQuotes ?? []) {
      const text = (quote.text ?? '').trim();
      if (!text) continue;
      const key = norm(text);
      const existing = quotes.get(key);
      if (!existing || (quote.relevance ?? 0) > existing.relevance) {
        quotes.set(key, {
          text,
          relevance: quote.relevance ?? 0,
          ...(quote.speaker ? { speaker: quote.speaker } : {}),
          ...(quote.timestamp != null ? { timestamp: quote.timestamp } : {}),
        });
      }
    }
  }
  const notableQuotes = [...quotes.values()]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MERGE_LIMITS.notableQuotes);

  // --- researchThemes: group by name, MEAN confidence, union examples ---
  // Mean, not "count of chunks that mentioned it": a theme named once with 0.9 and
  // once with 0.5 should score 0.7, not inflate because it appeared twice.
  const themes = new Map<string, { confidences: number[]; examples: string[] }>();
  const themeNames: string[] = [];
  for (const result of results) {
    for (const theme of result.researchThemes ?? []) {
      const name = (theme.theme ?? '').trim();
      if (!name) continue;
      themeNames.push(name);
      const key = norm(name);
      const bucket = themes.get(key);
      if (bucket) {
        bucket.confidences.push(theme.confidence ?? 0);
        bucket.examples.push(...(theme.examples ?? []));
      } else {
        themes.set(key, { confidences: [theme.confidence ?? 0], examples: [...(theme.examples ?? [])] });
      }
    }
  }
  const researchThemes = [...themes.entries()]
    .map(([key, bucket]) => ({
      theme: preferredSpelling(themeNames, key),
      confidence: mergeNumbers(bucket.confidences, 0),
      examples: [...new Set(bucket.examples.map((e) => (e ?? '').trim()).filter(Boolean))].slice(
        0,
        MERGE_LIMITS.examplesPerTheme
      ),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MERGE_LIMITS.researchThemes);

  // --- qaPairs: dedupe by question, keep the most complete answer ---
  const pairs = new Map<
    string,
    { question: string; answer: string; speaker?: string; timestamp?: number }
  >();
  for (const result of results) {
    for (const pair of result.qaPairs ?? []) {
      const question = (pair.question ?? '').trim();
      const answer = (pair.answer ?? '').trim();
      if (!question) continue;
      const key = norm(question);
      const existing = pairs.get(key);
      if (!existing || answer.length > existing.answer.length) {
        pairs.set(key, {
          question,
          answer,
          ...(pair.speaker ? { speaker: pair.speaker } : {}),
          ...(pair.timestamp != null ? { timestamp: pair.timestamp } : {}),
        });
      }
    }
  }
  const qaPairs = [...pairs.values()].slice(0, MERGE_LIMITS.qaPairs);

  // --- conceptFrequency: counts are additive, contexts are unioned ---
  const conceptNames: string[] = [];
  const concepts = new Map<string, { count: number; contexts: string[] }>();
  for (const result of results) {
    for (const [concept, entry] of Object.entries(result.conceptFrequency ?? {})) {
      const name = (concept ?? '').trim();
      if (!name) continue;
      conceptNames.push(name);
      const key = name.toLowerCase();
      const bucket = concepts.get(key);
      if (bucket) {
        bucket.count += entry?.count ?? 0;
        bucket.contexts.push(...(entry?.contexts ?? []));
      } else {
        concepts.set(key, { count: entry?.count ?? 0, contexts: [...(entry?.contexts ?? [])] });
      }
    }
  }
  const conceptFrequency: Record<string, { count: number; contexts: string[] }> = {};
  for (const [key, bucket] of concepts) {
    conceptFrequency[preferredSpelling(conceptNames, key)] = {
      count: bucket.count,
      contexts: [...new Set(bucket.contexts.map((c) => (c ?? '').trim()).filter(Boolean))].slice(
        0,
        MERGE_LIMITS.contextsPerConcept
      ),
    };
  }

  return { notableQuotes, researchThemes, qaPairs, conceptFrequency };
}