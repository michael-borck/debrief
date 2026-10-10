// Guard: the default research-analysis prompt must ask for speaker attribution,
// and BOTH copies of it must agree.
//
// WHY
// Speaker-attributed Q&A extraction depends entirely on the model being told to
// attribute. Before this, the prompt's JSON example used placeholder labels
// ("Speaker 1"), the instruction to copy real labels was absent, and — the
// actual blocker — the prompt was handed plain prose with every speaker label
// stripped out, so the model could not fill the field even if asked.
//
// The prompt is defined TWICE: once in src/services/promptService.ts (the
// defaults used by the renderer) and once in public/electron.js (the seed for
// fresh databases). Editing only one leaves them silently diverging, and which
// one wins depends on whether the row already exists. These tests pin both.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const PROMPT_SERVICE = readFileSync(
  resolve(__dirname, '..', 'src', 'services', 'promptService.ts'),
  'utf8'
);
const ELECTRON = readFileSync(resolve(__dirname, '..', 'public', 'electron.js'), 'utf8');

const SOURCES: Array<[string, string]> = [
  ['src/services/promptService.ts', PROMPT_SERVICE],
  ['public/electron.js', ELECTRON],
];

/** Isolate the research_analysis prompt TEXT from a source file. */
function researchPromptBody(source: string): string {
  const anchor = source.indexOf("type: 'research_analysis'");
  expect(anchor, 'research_analysis prompt must exist').toBeGreaterThan(-1);
  // The two copies spell the key differently: camelCase in the renderer
  // defaults, snake_case in the SQLite seed column.
  const keyPositions = ['promptText:', 'prompt_text:']
    .map((key) => source.indexOf(key, anchor))
    .filter((i) => i > anchor);
  const keyAt = Math.min(...keyPositions);
  const open = source.indexOf('`', keyAt);
  const close = source.indexOf('`', open + 1);
  expect(keyAt, 'promptText key must exist').toBeGreaterThan(anchor);
  expect(open, 'prompt text must open with a backtick').toBeGreaterThan(keyAt);
  expect(close, 'prompt text must be terminated').toBeGreaterThan(open);
  // Return only the literal's contents so the two copies can be compared
  // regardless of the key spelling or surrounding indentation.
  return source.slice(open + 1, close);
}

describe.each(SOURCES)('research_analysis prompt in %s', (_label, source) => {
  const body = researchPromptBody(source);

  it('instructs the model to attribute quotes and questions to a speaker', () => {
    expect(body).toMatch(/attribute every quote and every question to the speaker/i);
  });

  it('tells the model the transcript is speaker-labelled, and how', () => {
    expect(body).toMatch(/prefixed with speaker labels in square brackets/i);
    expect(body).toMatch(/\[SPEAKER_00\]/);
  });

  it('forbids inventing labels not present in the transcript', () => {
    expect(body).toMatch(/do not invent speaker labels/i);
  });

  it('shows real diarisation labels in the JSON example, not placeholders', () => {
    // Placeholder examples ("Speaker 1") invite the model to emit those
    // regardless of what the transcript actually contains.
    expect(body).toContain('"speaker": "SPEAKER_00"');
    expect(body).not.toContain('"Speaker 1"');
    expect(body).not.toContain('"Speaker 2"');
  });

  it('asks for the questioner and answerer separately', () => {
    // In a Q&A these are different people; a single field cannot express which
    // is which.
    expect(body).toContain('"questionSpeaker"');
    expect(body).toContain('"answerSpeaker"');
  });
});

describe('the two copies of the research prompt agree', () => {
  it('have identical prompt bodies', () => {
    // Divergence here is invisible: the seeded row wins on a fresh database, the
    // renderer default wins otherwise, so a one-sided edit behaves differently
    // for new and existing installs.
    expect(researchPromptBody(ELECTRON).replace(/\s+/g, ' ').trim()).toBe(
      researchPromptBody(PROMPT_SERVICE).replace(/\s+/g, ' ').trim()
    );
  });
});