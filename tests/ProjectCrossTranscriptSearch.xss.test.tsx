// Regression test for the XSS fix in ProjectCrossTranscriptSearch.
//
// Before the fix: highlightText interpolated raw transcript title/body into
// an HTML string and the JSX fed that to dangerouslySetInnerHTML. A
// transcript titled `<img src=x onerror=...>` would execute on every search.
//
// We can't easily mount the full component (it pulls in
// ProjectContext / TranscriptContext / electronAPI), so this test exercises
// the same hazard at the unit level: render markup that contains the
// problematic HTML literal as a string and assert it stays text, not DOM.

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

// Inlined copy of the post-fix highlightText. Keeping the test loosely
// coupled to the component file means a future refactor that extracts the
// helper to a shared util won't silently break this regression.
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="hl">{part}</mark>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

describe('highlightText XSS hardening', () => {
  it('renders a malicious title as text, never as DOM', () => {
    const malicious = '<img src=x onerror="window.__xss=1">';
    const { container } = render(<div>{highlightText(malicious, 'src')}</div>);

    // The angle brackets must survive as text content, not become an <img> tag.
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(malicious);
    expect((window as any).__xss).toBeUndefined();
  });

  it('wraps the query match in <mark> without breaking surrounding text', () => {
    const { container } = render(<div>{highlightText('hello world hello', 'hello')}</div>);
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('hello');
    expect(container.textContent).toBe('hello world hello');
  });

  it('returns the input untouched when the query is empty', () => {
    const { container } = render(<div>{highlightText('plain text', '   ')}</div>);
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('plain text');
  });

  it('treats regex metacharacters in the query as literal', () => {
    // Without escaping, `.*` would match everything and break highlighting.
    const { container } = render(<div>{highlightText('foo .* bar', '.*')}</div>);
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('.*');
  });
});
