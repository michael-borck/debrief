// Sentence-segment construction from Whisper chunk timings.
//
// Extracted from public/electron.js (2026-10-14 audit, P2-9) so the timing
// logic is unit-testable without booting Electron — and so there is ONE
// place that decides what a sentence's start/end mean.
//
// TWO TIMING MODES
// - Word-aligned (chunk.words present, from the sidecar's /analyse-v2):
//   sentences are built from the words themselves, flushed at sentence
//   punctuation OR at a speaker change, with start/end taken from the
//   first/last word. timing_source='word'. A speaker change mid-chunk
//   therefore produces two correctly-attributed sentences instead of one
//   sentence credited to whichever speaker talked longer.
// - Interpolated (legacy path): the chunk text is sentence-split and the
//   chunk's duration distributed by word count. timing_source='interpolated'.
//
// CONFIDENCE
// Real signals only: mean word probability (word mode) or exp(avg_logprob)
// from Whisper (interpolated mode), else null. The previous heuristic —
// 0.5 plus bonuses for capital letters and word counts — was fabricated
// precision and is gone.

const SENTENCE_END = /[.!?…]+["'”’)\]]*$/;

/**
 * Split text into sentences, KEEPING terminal punctuation and one-word
 * sentences. (The old splitter stripped punctuation and dropped sentences
 * under two words — deleting exactly the "Yes." / "No." backchannels that
 * Q&A analysis depends on.)
 */
function splitIntoSentences(text) {
  if (!text?.trim()) return [];
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*)?/g) ?? [];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function countWords(text) {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function countWordsInText(text) {
  const matches = text.match(/\b\w+\b/g);
  return matches ? matches.length : 0;
}

function confidenceFromLogprob(avgLogprob) {
  if (typeof avgLogprob !== 'number' || !Number.isFinite(avgLogprob)) return null;
  return Math.max(0, Math.min(1, Math.exp(avgLogprob)));
}

/** Sentences for one word-aligned chunk. */
function sentencesFromWords(chunk) {
  const sentences = [];
  let current = null;
  const flush = () => {
    if (current && current.words.length > 0) sentences.push(current);
    current = null;
  };
  for (const w of chunk.words) {
    const text = String(w.word ?? '');
    if (!text.trim()) continue;
    const speaker = w.speaker ?? chunk.speaker ?? null;
    if (current && current.speaker !== speaker) flush();
    if (!current) {
      current = { speaker, words: [], start: Number(w.start), end: Number(w.end) };
    }
    current.words.push(w);
    current.end = Number(w.end);
    if (SENTENCE_END.test(text.trim())) flush();
  }
  flush();

  return sentences.map((s) => {
    const probs = s.words
      .map((w) => w.probability)
      .filter((p) => typeof p === 'number' && Number.isFinite(p));
    return {
      text: s.words.map((w) => String(w.word)).join('').trim(),
      startTime: s.start,
      endTime: Math.max(s.end, s.start),
      speaker: s.speaker,
      confidence: probs.length
        ? probs.reduce((sum, p) => sum + p, 0) / probs.length
        : confidenceFromLogprob(chunk.avgLogprob),
      timingSource: 'word',
      words: s.words,
      wordCount: s.words.length,
    };
  }).filter((s) => s.text.length > 0);
}

/** Sentences for one legacy (interpolated) chunk. */
function sentencesFromText(chunk) {
  const sentences = splitIntoSentences(chunk.text);
  const chunkDuration = chunk.duration || 0;
  const totalWords = countWordsInText(chunk.text);
  const wordsPerSecond = totalWords > 0 && chunkDuration > 0 ? totalWords / chunkDuration : 0;
  const confidence = confidenceFromLogprob(chunk.avgLogprob);
  let currentTime = chunk.startTime || 0;
  return sentences.map((sentence) => {
    const wordCount = countWords(sentence);
    const estimatedDuration = wordsPerSecond > 0 ? wordCount / wordsPerSecond : 1;
    const endTime = currentTime + estimatedDuration;
    const row = {
      text: sentence,
      startTime: currentTime,
      endTime: Math.min(endTime, chunk.endTime || currentTime + estimatedDuration),
      speaker: chunk.speaker || null,
      confidence,
      timingSource: 'interpolated',
      words: null,
      wordCount,
    };
    currentTime = endTime;
    return row;
  });
}

/**
 * Build transcript_segments rows (camelCase IPC shape) from chunk timings.
 * Pure: no DB, no logging. Returns [] for unusable input.
 */
function createSentenceSegmentsFromChunks(transcriptId, chunkTimings, version = 'original') {
  if (!transcriptId) return [];
  if (!chunkTimings || !Array.isArray(chunkTimings) || chunkTimings.length === 0) return [];

  const segments = [];
  let globalSentenceIndex = 0;

  for (const chunk of chunkTimings) {
    if (!chunk || typeof chunk.text !== 'string') continue;
    const rows =
      Array.isArray(chunk.words) && chunk.words.length > 0
        ? sentencesFromWords(chunk)
        : sentencesFromText(chunk);
    for (const row of rows) {
      segments.push({
        transcriptId,
        sentenceIndex: globalSentenceIndex++,
        text: row.text,
        startTime: row.startTime,
        endTime: row.endTime,
        speaker: row.speaker,
        confidence: row.confidence,
        version,
        sourceChunkIndex: chunk.chunkIndex,
        wordCount: row.wordCount,
        timingSource: row.timingSource,
        words: row.words ? JSON.stringify(row.words) : null,
      });
    }
  }

  return segments;
}

module.exports = {
  createSentenceSegmentsFromChunks,
  splitIntoSentences,
  countWords,
  countWordsInText,
  confidenceFromLogprob,
  sentencesFromWords,
  sentencesFromText,
};
