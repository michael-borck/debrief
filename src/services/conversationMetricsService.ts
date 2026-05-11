/**
 * Conversation metrics — pure algorithmic analysis of a transcript.
 *
 * No LLM calls, no network. Adapted from talk-buddy's analysis.ts but
 * reframed for Debrief's audience: people analysing OTHER people's
 * conversations (interviews, meetings, classes), not their own practice.
 *
 * Vocabulary is intentionally observational, not judgemental.
 */

import { SentenceSegment } from '../types';

// ============================================
// Types
// ============================================

export interface FillerWordResult {
  count: number;
  percentage: number;
  topFillers: Array<{ word: string; count: number }>;
}

export interface SpeakerTalkTime {
  speaker: string;
  wordCount: number;
  segmentCount: number;
  percentage: number; // % of total words
  durationSeconds?: number;
}

export interface TalkTimeResult {
  speakers: SpeakerTalkTime[];
  isBalanced: boolean; // true if no speaker dominates >70%
  dominantSpeaker?: string;
}

export interface ConversationQualityFactors {
  clarity: number;       // 0-25, inverse of filler rate
  depth: number;         // 0-25, based on average turn/sentence length
  balance: number;       // 0-25, how evenly speakers contribute
  pace: number;          // 0-25, words per minute against ideal range
}

export interface ConversationQuality {
  score: number; // 0-100
  factors: ConversationQualityFactors;
  ratings: {
    clarity: 'excellent' | 'good' | 'fair' | 'low';
    depth: 'excellent' | 'good' | 'fair' | 'low';
    balance: 'excellent' | 'good' | 'fair' | 'low';
    pace: 'excellent' | 'good' | 'fair' | 'low';
  };
}

export interface ConversationInsights {
  strengths: string[];
  observations: string[];
}

export interface ConversationMetrics {
  wordCount: number;
  sentenceCount: number;
  speakerCount: number;
  averageWordsPerSentence: number;
  wordsPerMinute?: number;
  durationSeconds?: number;
  questionsAsked: number;

  fillerWords: FillerWordResult;
  talkTime?: TalkTimeResult;
  quality: ConversationQuality;
  insights: ConversationInsights;
}

// ============================================
// Constants
// ============================================

const SINGLE_WORD_FILLERS = new Set([
  'um', 'uh', 'er', 'ah', 'hmm', 'mm',
  'like', 'so', 'well', 'actually', 'basically',
  'literally', 'honestly', 'obviously', 'right',
  'okay', 'yeah', 'anyway',
]);

const MULTI_WORD_FILLERS = [
  'you know', 'i mean', 'kind of', 'sort of', 'you see',
  'i guess', 'or something', 'or whatever',
];

const QUESTION_INDICATORS = [
  'what ', 'when ', 'where ', 'who ', 'why ', 'how ', 'which ',
  'would you', 'could you', 'should you', 'can you',
  'do you', 'did you', 'will you', 'are you', 'is it', 'have you',
];

// ============================================
// Filler word detection
// ============================================

export function detectFillerWords(text: string): FillerWordResult {
  if (!text) {
    return { count: 0, percentage: 0, topFillers: [] };
  }

  const lower = text.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const totalWords = tokens.length;

  if (totalWords === 0) {
    return { count: 0, percentage: 0, topFillers: [] };
  }

  const counts = new Map<string, number>();

  // Single-word fillers (strip surrounding punctuation, but keep apostrophes inside)
  for (const tok of tokens) {
    const clean = tok.replace(/^[^\w']+|[^\w']+$/g, '');
    if (SINGLE_WORD_FILLERS.has(clean)) {
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }

  // Multi-word fillers — match against the joined lowercased text with word boundaries
  const joined = ' ' + tokens.join(' ') + ' ';
  for (const phrase of MULTI_WORD_FILLERS) {
    // Simple substring with surrounding spaces to enforce word boundary
    const needle = ' ' + phrase + ' ';
    let idx = 0;
    let n = 0;
    while ((idx = joined.indexOf(needle, idx)) !== -1) {
      n++;
      idx += needle.length - 1; // allow overlap on trailing space
    }
    if (n > 0) {
      counts.set(phrase, (counts.get(phrase) || 0) + n);
    }
  }

  let total = 0;
  for (const v of counts.values()) total += v;

  const topFillers = Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    count: total,
    percentage: (total / totalWords) * 100,
    topFillers,
  };
}

// ============================================
// Talk-time distribution
// ============================================

export function analyzeTalkTime(segments: SentenceSegment[]): TalkTimeResult | undefined {
  if (!segments || segments.length === 0) return undefined;

  const withSpeakers = segments.filter(s => s.speaker && s.speaker.trim());
  if (withSpeakers.length === 0) return undefined;

  const bySpeaker = new Map<string, { words: number; count: number; duration: number }>();

  for (const seg of withSpeakers) {
    const speaker = seg.speaker!.trim();
    const words = seg.word_count || (seg.text ? seg.text.trim().split(/\s+/).filter(Boolean).length : 0);
    const duration = seg.end_time != null && seg.start_time != null
      ? Math.max(0, seg.end_time - seg.start_time)
      : 0;

    const cur = bySpeaker.get(speaker) || { words: 0, count: 0, duration: 0 };
    cur.words += words;
    cur.count += 1;
    cur.duration += duration;
    bySpeaker.set(speaker, cur);
  }

  const totalWords = Array.from(bySpeaker.values()).reduce((acc, v) => acc + v.words, 0);
  if (totalWords === 0) return undefined;

  const speakers: SpeakerTalkTime[] = Array.from(bySpeaker.entries())
    .map(([speaker, data]) => ({
      speaker,
      wordCount: data.words,
      segmentCount: data.count,
      percentage: (data.words / totalWords) * 100,
      durationSeconds: data.duration > 0 ? data.duration : undefined,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const dominant = speakers[0];
  const isBalanced = dominant.percentage <= 70;

  return {
    speakers,
    isBalanced,
    dominantSpeaker: !isBalanced ? dominant.speaker : undefined,
  };
}

// ============================================
// Question counting
// ============================================

export function countQuestions(text: string): number {
  if (!text) return 0;

  // Count explicit question marks first
  const qMarks = (text.match(/\?/g) || []).length;

  // Also count sentences starting with question indicators (covers transcripts
  // where punctuation is missing or unreliable)
  const lower = text.toLowerCase();
  let indicatorMatches = 0;
  for (const indicator of QUESTION_INDICATORS) {
    const regex = new RegExp(`(^|[.!?]\\s+)${indicator}`, 'g');
    indicatorMatches += (lower.match(regex) || []).length;
  }

  // Take the larger of the two — they should overlap heavily in well-punctuated
  // transcripts and indicators catch the unpunctuated case
  return Math.max(qMarks, indicatorMatches);
}

// ============================================
// Quality scoring
// ============================================

function rate(score: number): 'excellent' | 'good' | 'fair' | 'low' {
  if (score >= 22) return 'excellent';
  if (score >= 17) return 'good';
  if (score >= 12) return 'fair';
  return 'low';
}

export function calculateQuality(input: {
  fillerPercentage: number;
  averageWordsPerSentence: number;
  talkTime?: TalkTimeResult;
  wordsPerMinute?: number;
}): ConversationQuality {
  const factors: ConversationQualityFactors = {
    clarity: 0,
    depth: 0,
    balance: 0,
    pace: 0,
  };

  // Clarity — inverse of filler rate
  if (input.fillerPercentage <= 2) factors.clarity = 25;
  else if (input.fillerPercentage <= 5) factors.clarity = 21;
  else if (input.fillerPercentage <= 8) factors.clarity = 16;
  else if (input.fillerPercentage <= 12) factors.clarity = 11;
  else factors.clarity = 6;

  // Depth — average sentence/turn length
  const w = input.averageWordsPerSentence;
  if (w >= 12 && w <= 25) factors.depth = 25;
  else if (w >= 8 && w <= 30) factors.depth = 20;
  else if (w >= 5 && w <= 40) factors.depth = 15;
  else if (w >= 3) factors.depth = 10;
  else factors.depth = 5;

  // Balance — only meaningful if we have speaker data
  if (input.talkTime && input.talkTime.speakers.length > 1) {
    const dominantPct = input.talkTime.speakers[0].percentage;
    const speakerCount = input.talkTime.speakers.length;
    const idealShare = 100 / speakerCount;
    const deviation = Math.abs(dominantPct - idealShare);

    if (deviation <= 10) factors.balance = 25;
    else if (deviation <= 20) factors.balance = 20;
    else if (deviation <= 30) factors.balance = 15;
    else if (deviation <= 45) factors.balance = 10;
    else factors.balance = 5;
  } else {
    // Single speaker or no speaker data — neutral score (don't penalise)
    factors.balance = 18;
  }

  // Pace — words per minute, if duration available
  // Conversational ideal range: 130-170 wpm (adult English baseline)
  if (input.wordsPerMinute && input.wordsPerMinute > 0) {
    const wpm = input.wordsPerMinute;
    if (wpm >= 130 && wpm <= 170) factors.pace = 25;
    else if (wpm >= 110 && wpm <= 190) factors.pace = 20;
    else if (wpm >= 90 && wpm <= 210) factors.pace = 15;
    else if (wpm >= 60 && wpm <= 240) factors.pace = 10;
    else factors.pace = 5;
  } else {
    // No timing data — neutral score
    factors.pace = 18;
  }

  const score = factors.clarity + factors.depth + factors.balance + factors.pace;

  return {
    score,
    factors,
    ratings: {
      clarity: rate(factors.clarity),
      depth: rate(factors.depth),
      balance: rate(factors.balance),
      pace: rate(factors.pace),
    },
  };
}

// ============================================
// Insights generation
// ============================================

export function generateInsights(metrics: {
  quality: ConversationQuality;
  fillerPercentage: number;
  averageWordsPerSentence: number;
  talkTime?: TalkTimeResult;
  wordsPerMinute?: number;
  questionsAsked: number;
}): ConversationInsights {
  const strengths: string[] = [];
  const observations: string[] = [];

  // Strengths — observational, not flattering
  if (metrics.quality.ratings.clarity === 'excellent') {
    strengths.push('Speech is clear with very few filler words');
  }
  if (metrics.quality.ratings.depth === 'excellent') {
    strengths.push('Turns have substantive depth (12-25 words on average)');
  }
  if (metrics.talkTime && metrics.quality.ratings.balance === 'excellent') {
    strengths.push('Speakers contribute roughly evenly');
  }
  if (metrics.quality.ratings.pace === 'excellent') {
    strengths.push('Speaking pace is in the natural conversational range');
  }
  if (metrics.questionsAsked >= 5) {
    strengths.push(`${metrics.questionsAsked} questions asked — strong inquiry pattern`);
  }

  // Observations — neutral phrasing of things to note
  if (metrics.fillerPercentage > 8) {
    observations.push(`Filler words make up ${metrics.fillerPercentage.toFixed(1)}% of all spoken words`);
  }
  if (metrics.averageWordsPerSentence < 5) {
    observations.push('Sentences are very short — could indicate hesitation or quick exchanges');
  }
  if (metrics.averageWordsPerSentence > 30) {
    observations.push('Sentences are very long — may be a monologue or lecture format');
  }
  if (metrics.talkTime && !metrics.talkTime.isBalanced && metrics.talkTime.dominantSpeaker) {
    const dom = metrics.talkTime.speakers[0];
    observations.push(
      `${metrics.talkTime.dominantSpeaker} dominates with ${dom.percentage.toFixed(0)}% of all spoken words`
    );
  }
  if (metrics.wordsPerMinute && metrics.wordsPerMinute < 90) {
    observations.push(`Slow pace (${Math.round(metrics.wordsPerMinute)} words/min) — may include long pauses`);
  }
  if (metrics.wordsPerMinute && metrics.wordsPerMinute > 200) {
    observations.push(`Fast pace (${Math.round(metrics.wordsPerMinute)} words/min) — speakers talking quickly`);
  }
  if (metrics.questionsAsked === 0) {
    observations.push('No questions detected — this is a statement-heavy conversation');
  }

  if (strengths.length === 0) {
    strengths.push('Transcript analysed successfully');
  }

  return { strengths, observations };
}

// ============================================
// Top-level analyzer
// ============================================

export function analyzeConversation(
  text: string,
  segments?: SentenceSegment[],
  durationSeconds?: number
): ConversationMetrics {
  const cleanText = (text || '').trim();
  const tokens = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = tokens.length;

  // Use segments if available for sentence count + average length, fall back to text-based split
  let sentenceCount: number;
  let averageWordsPerSentence: number;

  if (segments && segments.length > 0) {
    sentenceCount = segments.length;
    const totalWords = segments.reduce(
      (acc, s) => acc + (s.word_count || (s.text ? s.text.trim().split(/\s+/).filter(Boolean).length : 0)),
      0
    );
    averageWordsPerSentence = sentenceCount > 0 ? totalWords / sentenceCount : 0;
  } else {
    // Naive sentence split — period/?/! followed by space or end
    const sentences = cleanText
      .split(/[.!?]+\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    sentenceCount = sentences.length;
    averageWordsPerSentence = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  }

  const fillerWords = detectFillerWords(cleanText);
  const talkTime = segments ? analyzeTalkTime(segments) : undefined;
  const speakerCount = talkTime ? talkTime.speakers.length : 1;
  const questionsAsked = countQuestions(cleanText);

  const wordsPerMinute = durationSeconds && durationSeconds > 0
    ? (wordCount / durationSeconds) * 60
    : undefined;

  const quality = calculateQuality({
    fillerPercentage: fillerWords.percentage,
    averageWordsPerSentence,
    talkTime,
    wordsPerMinute,
  });

  const insights = generateInsights({
    quality,
    fillerPercentage: fillerWords.percentage,
    averageWordsPerSentence,
    talkTime,
    wordsPerMinute,
    questionsAsked,
  });

  return {
    wordCount,
    sentenceCount,
    speakerCount,
    averageWordsPerSentence,
    wordsPerMinute,
    durationSeconds,
    questionsAsked,
    fillerWords,
    talkTime,
    quality,
    insights,
  };
}
