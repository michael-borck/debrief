// Transcript validation — the single implementation used by both the import
// pipeline (fileProcessor) and manual re-validation (CorrectionTrigger).
//
// validate() reads the validation settings, optionally removes duplicate
// sentences, builds the configurable validation prompt, chunks long
// transcripts, runs them through the AI Completion seam, and guards against a
// model that truncates the text. The pure helpers (duplicate removal +
// similarity) are exported for unit testing.

import { promptService } from './promptService';
import { aiComplete } from './aiCompletion';
import { checkCancelled, isCancelled } from '../utils/cancellation';

export interface ValidationChange {
  type: string;
  original: string;
  corrected: string;
  position: number;
}

export interface ValidationResult {
  validatedText: string;
  changes: ValidationChange[];
}

const CHUNK_SIZE = 3500; // Safe size for most models
const LONG_TRANSCRIPT_THRESHOLD = 4000; // Above this, validate in chunks

// ============================================================
// Pure helpers (exported for tests)
// ============================================================

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[str2.length][str1.length];
}

export function calculateSimilarity(str1: string, str2: string): number {
  // Simple similarity calculation using Levenshtein distance
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

export function removeDuplicateSentences(transcriptText: string): {
  cleanedText: string;
  removedCount: number;
  removedSentences: string[];
} {
  try {
    if (!transcriptText || transcriptText.trim() === '') {
      return { cleanedText: transcriptText, removedCount: 0, removedSentences: [] };
    }

    // Split into sentences
    const sentences = transcriptText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (sentences.length <= 1) {
      return { cleanedText: transcriptText, removedCount: 0, removedSentences: [] };
    }

    const uniqueSentences: string[] = [];
    const removedSentences: string[] = [];
    const seenSentences = new Set<string>();

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();

      // Normalize sentence for comparison (lowercase, remove extra spaces, common words)
      const normalized = sentence
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .trim();

      // Skip very short sentences (likely fragments)
      if (normalized.length < 10) {
        uniqueSentences.push(sentence);
        continue;
      }

      // Check for exact or near-exact duplicates
      let isDuplicate = false;

      // Check against all previously seen sentences
      for (const seenNormalized of seenSentences) {
        const similarity = calculateSimilarity(normalized, seenNormalized);

        // Consider duplicates if >85% similar
        if (similarity > 0.85) {
          isDuplicate = true;
          removedSentences.push(sentence);
          break;
        }
      }

      if (!isDuplicate) {
        seenSentences.add(normalized);
        uniqueSentences.push(sentence);
      }
    }

    // Rebuild text with proper punctuation
    const cleanedText = uniqueSentences
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join('. ')
      .replace(/\.\s*\./g, '.') // Remove double periods
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();

    console.log(`Removed ${removedSentences.length} duplicate sentences from transcript`);

    return {
      cleanedText: cleanedText + (cleanedText.endsWith('.') ? '' : '.'),
      removedCount: removedSentences.length,
      removedSentences,
    };
  } catch (error) {
    console.error('Error removing duplicate sentences:', error);
    return { cleanedText: transcriptText, removedCount: 0, removedSentences: [] };
  }
}

// ============================================================
// Chunked validation for long transcripts
// ============================================================

async function performChunkedValidation(
  text: string,
  options: any,
  signal?: AbortSignal
): Promise<ValidationResult> {
  const chunks: string[] = [];
  let currentPos = 0;

  // Split into chunks at sentence boundaries
  while (currentPos < text.length) {
    let chunkEnd = currentPos + CHUNK_SIZE;

    if (chunkEnd >= text.length) {
      chunks.push(text.substring(currentPos));
      break;
    }

    // Find the last sentence ending within chunk size
    const chunk = text.substring(currentPos, chunkEnd);
    const lastSentenceEnd = Math.max(
      chunk.lastIndexOf('.'),
      chunk.lastIndexOf('!'),
      chunk.lastIndexOf('?')
    );

    if (lastSentenceEnd > 0) {
      chunkEnd = currentPos + lastSentenceEnd + 1;
    }

    chunks.push(text.substring(currentPos, chunkEnd));
    currentPos = chunkEnd;
  }

  console.log(`Processing ${chunks.length} chunks for validation`);

  const validatedChunks: string[] = [];
  const allChanges: ValidationChange[] = [];

  for (let i = 0; i < chunks.length; i++) {
    checkCancelled(signal);
    const chunk = chunks[i];
    console.log(`Validating chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);

    try {
      const validationPrompt = `Please validate and correct the following text segment. Focus on:
${options.spelling !== false ? '- Spelling errors' : ''}
${options.grammar !== false ? '- Grammar mistakes' : ''}
${options.punctuation !== false ? '- Punctuation' : ''}
${options.capitalization !== false ? '- Proper capitalization' : ''}

Important:
- Preserve the original meaning and speaker intent
- Do not change technical terms or proper nouns unless clearly misspelled
- Return the corrected text and a list of changes made

Text segment:
${chunk}

Please format your response as JSON:
{
  "validatedText": "The corrected text segment",
  "changes": [
    {
      "type": "spelling|grammar|punctuation|capitalization",
      "original": "original text",
      "corrected": "corrected text",
      "position": 0
    }
  ]
}`;

      const res = await aiComplete(validationPrompt, 'json', signal);

      if (res.ok && res.data) {
        const chunkData = res.data;
        validatedChunks.push(chunkData.validatedText || chunk);

        if (Array.isArray(chunkData.changes)) {
          // Adjust positions for the full text
          const adjustedChanges = chunkData.changes.map((change: any) => ({
            ...change,
            position: change.position + (i > 0 ? validatedChunks.slice(0, i).join('').length : 0),
          }));
          allChanges.push(...adjustedChanges);
        }
      } else {
        console.warn(`Failed to validate chunk ${i + 1}, using original`);
        validatedChunks.push(chunk);
      }
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.warn(`Error validating chunk ${i + 1}:`, error);
      validatedChunks.push(chunk);
    }

    // Small delay to be nice to the AI service
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return {
    validatedText: validatedChunks.join(''),
    changes: allChanges,
  };
}

// ============================================================
// Public interface
// ============================================================

export const transcriptValidationService = {
  /**
   * Validate and correct a transcript. Honours the enableTranscriptValidation,
   * validationOptions and enableDuplicateRemoval settings, runs through the AI
   * Completion seam, and never throws except on cancellation — on any failure
   * it falls back to the duplicate-cleaned (or original) text.
   */
  async validate(transcriptText: string, signal?: AbortSignal): Promise<ValidationResult> {
    // Initialize variables outside try block for catch block access
    let processedText = transcriptText;
    let duplicateRemovalChanges: ValidationChange[] = [];

    try {
      // Get validation settings in one batch
      const valSettings = await window.electronAPI.db.settings.getMany([
        'enableTranscriptValidation',
        'validationOptions',
        'enableDuplicateRemoval',
      ]);

      if (valSettings.enableTranscriptValidation !== 'true') {
        return { validatedText: transcriptText, changes: [] };
      }

      let options: any = {};
      if (valSettings.validationOptions) {
        try {
          options = JSON.parse(valSettings.validationOptions);
        } catch (err) {
          console.warn('validationOptions: malformed JSON, using defaults', err);
        }
      }

      // First, remove duplicate sentences if enabled (separate setting)
      if (valSettings.enableDuplicateRemoval !== 'false') {
        const duplicateResult = removeDuplicateSentences(transcriptText);
        processedText = duplicateResult.cleanedText;

        if (duplicateResult.removedCount > 0) {
          duplicateRemovalChanges = duplicateResult.removedSentences.map((sentence) => ({
            type: 'duplicate_removal',
            original: sentence,
            corrected: '[REMOVED]',
            position: -1,
          }));
        }
      }

      // Create validation options string
      const validationOptions = [
        options.spelling !== false ? '- Spelling errors' : '',
        options.grammar !== false ? '- Grammar mistakes' : '',
        options.punctuation !== false ? '- Punctuation' : '',
        options.capitalization !== false ? '- Proper capitalization' : '',
      ]
        .filter((opt) => opt !== '')
        .join('\n');

      // Create validation prompt using configurable prompt
      const validationPrompt = await promptService.getProcessedPrompt(
        'validation',
        'transcript_validation',
        {
          validation_options: validationOptions,
          transcript: processedText,
        }
      );

      console.log(`Validation input length: ${processedText.length} characters`);

      // For very long transcripts, use chunked validation
      if (processedText.length > LONG_TRANSCRIPT_THRESHOLD) {
        console.log('Using chunked validation for long transcript');
        const chunkResult = await performChunkedValidation(processedText, options, signal);
        return {
          validatedText: chunkResult.validatedText,
          changes: [...duplicateRemovalChanges, ...chunkResult.changes],
        };
      }

      // Run via the Completion module (provider/key/model resolved in main).
      const res = await aiComplete(validationPrompt, 'json', signal);
      console.log(`Validation output length: ${res.raw?.length || 0} characters`);

      if (!res.ok) {
        throw new Error(res.error || 'AI service error');
      }

      const validationData = res.data;
      if (!validationData) {
        console.warn('Failed to parse validation response as JSON');
        return {
          validatedText: processedText, // Use duplicate-cleaned text as fallback
          changes: duplicateRemovalChanges,
        };
      }

      // Check if AI returned full text (within 10% of original length)
      const originalLength = processedText.length;
      const validatedLength = validationData.validatedText?.length || 0;
      const lengthRatio = validatedLength / originalLength;

      if (lengthRatio < 0.9) {
        console.warn(
          `AI validation may have truncated text. Original: ${originalLength}, Validated: ${validatedLength}`
        );
        // Return original text with duplicate removal only
        return {
          validatedText: processedText,
          changes: duplicateRemovalChanges,
        };
      }

      return {
        validatedText: validationData.validatedText || processedText,
        changes: [
          ...duplicateRemovalChanges,
          ...(Array.isArray(validationData.changes) ? validationData.changes : []),
        ],
      };
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Validation error:', error);
      // Return duplicate-cleaned text if validation fails, or original if duplicate removal also failed
      return {
        validatedText: processedText || transcriptText,
        changes: duplicateRemovalChanges || [],
      };
    }
  },
};
