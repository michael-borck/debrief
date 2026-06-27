// Runtime schemas for the JSON the analysis/correction pipeline gets back
// from the Completion seam. Replaces the untyped `res.data` (`any`) handling
// that previously threaded model output straight into the UI.
//
// Design goal: preserve the pipeline's existing tolerant behaviour. Every
// schema degrades to a safe default rather than throwing — a malformed model
// response yields empty arrays / neutral defaults, never a crash. This mirrors
// the old `Array.isArray(x) ? x : []` / `x || default` guards, but makes the
// resulting values statically typed and validates per element instead of
// passing arbitrary shapes through.

import { z } from 'zod';
import { tolerantArray } from './schemaUtils';

// --- Basic analysis (analyzeTranscript) -----------------------------------

export const BasicAnalysisSchema = z
  .object({
    summary: z.string().transform((s) => s || '').catch(''),
    keyTopics: tolerantArray(z.string()),
    actionItems: tolerantArray(z.string()),
  })
  .catch({ summary: '', keyTopics: [], actionItems: [] });

export type BasicAnalysis = z.infer<typeof BasicAnalysisSchema>;

// --- Sentiment / emotion --------------------------------------------------

export const SentimentResultSchema = z
  .object({
    sentiment: z.string().transform((s) => s || 'neutral').catch('neutral'),
    sentimentScore: z.coerce.number().catch(0),
  })
  .catch({ sentiment: 'neutral', sentimentScore: 0 });

export type SentimentResult = z.infer<typeof SentimentResultSchema>;

export const EmotionResultSchema = z
  .record(z.string(), z.coerce.number())
  .catch({});

export type EmotionResult = z.infer<typeof EmotionResultSchema>;

// --- Research analysis (performResearchAnalysis) --------------------------

const NotableQuoteSchema = z.object({
  text: z.string().catch(''),
  speaker: z.string().optional().catch(undefined),
  timestamp: z.coerce.number().optional().catch(undefined),
  relevance: z.coerce.number().catch(0),
});

const ResearchThemeSchema = z.object({
  theme: z.string().catch(''),
  confidence: z.coerce.number().catch(0),
  examples: tolerantArray(z.string()),
});

const QaPairSchema = z.object({
  question: z.string().catch(''),
  answer: z.string().catch(''),
  speaker: z.string().optional().catch(undefined),
  timestamp: z.coerce.number().optional().catch(undefined),
});

const ConceptEntrySchema = z.object({
  count: z.coerce.number().catch(0),
  contexts: tolerantArray(z.string()),
});

export const ResearchAnalysisSchema = z
  .object({
    notableQuotes: tolerantArray(NotableQuoteSchema),
    researchThemes: tolerantArray(ResearchThemeSchema),
    qaPairs: tolerantArray(QaPairSchema),
    conceptFrequency: z.record(z.string(), ConceptEntrySchema).catch({}),
  })
  .catch({ notableQuotes: [], researchThemes: [], qaPairs: [], conceptFrequency: {} });

export type ResearchAnalysis = z.infer<typeof ResearchAnalysisSchema>;

// --- Transcript validation (transcriptValidationService) ------------------
// Mirrors the ValidationChange interface: the model is prompted to return
// exactly type/original/corrected/position, so we validate into that shape.
// `{...change, position}` spreads a full ValidationChange into storage.
const ValidationChangeSchema = z.object({
  type: z.string().catch(''),
  original: z.string().catch(''),
  corrected: z.string().catch(''),
  position: z.coerce.number().catch(0),
});

export const ValidationResultSchema = z
  .object({
    validatedText: z.string().catch(''),
    changes: tolerantArray(ValidationChangeSchema),
  })
  .catch({ validatedText: '', changes: [] });

export type ValidationResult = z.infer<typeof ValidationResultSchema>;
