/**
 * Speaker label and merge suggestions powered by the local AI service.
 *
 * Takes the current set of diarised speakers (with representative text
 * samples) and asks the configured AI model to:
 *   1. Suggest a more meaningful label for each speaker based on their
 *      speaking role or style (Interviewer, Participant, Dr. Smith, etc.)
 *   2. Identify pairs of speakers that look like they might be the same
 *      person (candidates for merging after diarisation over-split).
 *
 * Nothing is applied automatically — the caller decides what to do with
 * the suggestions (usually: show them in a UI for accept/reject).
 */

import { z } from 'zod';
import { tolerantArray } from './schemaUtils';

export interface SpeakerWithSamples {
  id: string;
  name: string;
  samples: string[]; // representative text samples from this speaker
}

export interface SpeakerLabelSuggestion {
  speakerId: string;
  currentName: string;
  suggestedName: string;
  reasoning: string;
}

export interface SpeakerMergeSuggestion {
  speakerAId: string;
  speakerAName: string;
  speakerBId: string;
  speakerBName: string;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface SpeakerSuggestionsResult {
  success: boolean;
  error?: string;
  labels: SpeakerLabelSuggestion[];
  merges: SpeakerMergeSuggestion[];
}

// Shape the model is prompted to return for speaker suggestions. Tolerant: a
// malformed-but-present response degrades to empty arrays rather than throwing.
const SpeakerSuggestionsSchema = z
  .object({
    labels: tolerantArray(
      z.object({
        speakerId: z.string().catch(''),
        suggestedName: z.string().catch(''),
        reasoning: z.string().optional().catch(undefined),
      })
    ),
    merges: tolerantArray(
      z.object({
        speakerAId: z.string().catch(''),
        speakerBId: z.string().catch(''),
        confidence: z.string().catch('medium'),
        reasoning: z.string().optional().catch(undefined),
      })
    ),
  })
  .catch({ labels: [], merges: [] });

const SYSTEM_PROMPT = `You analyse transcribed conversations to help researchers label speakers meaningfully. You are concise, factual, and never invent names that aren't clearly supported by the samples.`;

const buildPrompt = (speakers: SpeakerWithSamples[]): string => {
  const speakerBlocks = speakers
    .map((s) => {
      const sampleList = s.samples
        .slice(0, 5)
        .map((t) => `  - "${t.replace(/"/g, '\\"')}"`)
        .join('\n');
      return `[${s.id} — current label: "${s.name}"]\n${sampleList}`;
    })
    .join('\n\n');

  return `${SYSTEM_PROMPT}

Below are text samples from each speaker detected in a transcribed conversation. The current labels are generic (Speaker 1, Speaker 2, etc.) because they came from audio-only diarisation.

${speakerBlocks}

Your tasks:

1. LABELS: For each speaker, suggest a descriptive label based on what you observe in their samples. Good labels describe their role ("Interviewer", "Participant"), their speaking style ("Question-asker"), or (only if unambiguously stated by someone) a proper name ("Dr. Smith"). Keep labels short (1-3 words). If you can't tell, keep the current label.

2. MERGES: Identify any pairs of speakers that plausibly might be the same person. Look for overlapping vocabulary, similar topics, shared phrasing, or clear continuations of thought. Only suggest a merge if you are reasonably confident — a false merge is worse than no merge.

Respond with ONLY valid JSON. No markdown, no code fences, no commentary before or after.

Schema:
{
  "labels": [
    { "speakerId": "<id>", "suggestedName": "<label>", "reasoning": "<one short sentence>" }
  ],
  "merges": [
    { "speakerAId": "<id>", "speakerBId": "<id>", "reasoning": "<one short sentence>", "confidence": "high" | "medium" | "low" }
  ]
}

Return empty arrays if there are no suggestions. Do not wrap the JSON in anything.`;
};

/**
 * Extract the JSON object from an LLM response that may or may not
 * have leading/trailing text or markdown fences.
 */
const extractJson = (text: string): unknown => {
  if (!text) return null;

  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fenced ? fenced[1] : text;

  // Find the first { ... } block
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;

  const candidate = body.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

export async function suggestSpeakerImprovements(
  speakers: SpeakerWithSamples[]
): Promise<SpeakerSuggestionsResult> {
  if (speakers.length === 0) {
    return { success: false, error: 'No speakers provided', labels: [], merges: [] };
  }

  const speakersWithSamples = speakers.filter((s) => s.samples.length > 0);
  if (speakersWithSamples.length === 0) {
    return { success: false, error: 'No text samples available for any speaker', labels: [], merges: [] };
  }

  const prompt = buildPrompt(speakersWithSamples);

  try {
    const result = await window.electronAPI.ai.complete({
      prompt,
      expects: 'text',
    });

    if (!result?.ok) {
      return {
        success: false,
        error: result?.error || 'AI service returned no result',
        labels: [],
        merges: [],
      };
    }

    const raw = extractJson(result.text ?? '');
    if (!raw) {
      return {
        success: false,
        error: 'Could not parse AI response as JSON. The model may need a different prompt.',
        labels: [],
        merges: [],
      };
    }

    // Validate the model's JSON into a typed shape, then filter/normalise.
    const parsed = SpeakerSuggestionsSchema.parse(raw);

    // Build label suggestions, filtering out ones that match the current label
    const rawLabels = parsed.labels;
    const speakerById = new Map(speakers.map((s) => [s.id, s]));

    const labels: SpeakerLabelSuggestion[] = rawLabels
      .map((l) => {
        const speaker = speakerById.get(l.speakerId);
        if (!speaker) return null;
        const suggested = String(l.suggestedName || '').trim();
        if (!suggested || suggested.toLowerCase() === speaker.name.toLowerCase()) {
          return null; // no change, skip
        }
        return {
          speakerId: speaker.id,
          currentName: speaker.name,
          suggestedName: suggested,
          reasoning: String(l.reasoning || '').trim() || 'Based on speech patterns.',
        };
      })
      .filter((l): l is SpeakerLabelSuggestion => l !== null);

    const rawMerges = parsed.merges;
    const merges: SpeakerMergeSuggestion[] = rawMerges
      .map((m) => {
        const a = speakerById.get(m.speakerAId);
        const b = speakerById.get(m.speakerBId);
        if (!a || !b || a.id === b.id) return null;
        const confidence = ['high', 'medium', 'low'].includes(m.confidence) ? m.confidence : 'medium';
        return {
          speakerAId: a.id,
          speakerAName: a.name,
          speakerBId: b.id,
          speakerBName: b.name,
          reasoning: String(m.reasoning || '').trim() || 'Similar speaking patterns.',
          confidence: confidence as 'high' | 'medium' | 'low',
        };
      })
      .filter((m): m is SpeakerMergeSuggestion => m !== null);

    return { success: true, labels, merges };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      labels: [],
      merges: [],
    };
  }
}
