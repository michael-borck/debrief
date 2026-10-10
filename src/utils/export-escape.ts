// Escaping for generated export files (HTML and CSV).
//
// React escapes for us when rendering JSX. It does NOT escape a string we
// build by hand and hand to `new Blob([content], { type: 'text/html' })`, and
// exports are written to disk and opened outside the app — the app's CSP does
// not apply to the downloaded file.
//
// The taint here is not only the user: analysis summaries, themes, key insights
// and concept names all come from the AI provider, so a transcript containing
// an injection payload can steer the model into emitting HTML that later
// executes when the user opens the export. Every value that reaches an export
// must go through one of these.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Ampersand first: escaping it after the others would double-escape the
// entities introduced below.
const HTML_UNSAFE = /[&<>"']/g;

/**
 * Escape text for interpolation into an HTML string.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(HTML_UNSAFE, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Escape one CSV field for a spreadsheet.
 *
 * Two distinct hazards, both reachable from AI-generated analysis text:
 *
 *  - Quote breaking: a value containing `"` escapes the wrapping quotes and can
 *    add columns or rows to the sheet.
 *  - Formula injection: Excel, LibreOffice and Sheets evaluate a cell whose
 *    first character is `=`, `+`, `-` or `@` (or which begins with a tab or CR)
 *    as a formula. A theme named `=HYPERLINK("http://evil","click")` becomes a
 *    live link — or an exfiltration primitive — the moment the user opens the
 *    file. Prefixing an apostrophe forces literal-text treatment.
 *
 * Applied to every field rather than only suspicious-looking ones: the taint is
 * model output, so there is no reliable "is this user input?" test.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}