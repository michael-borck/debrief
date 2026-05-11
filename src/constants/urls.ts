/**
 * Canonical external URLs for Debrief.
 *
 * Centralised so that any future repo move is a one-line change. Renderer
 * code should import from here rather than hard-coding URLs.
 *
 * The mirror values for the main process live in `public/electron-urls.js`
 * (kept in sync manually since the main process uses CommonJS and can't
 * import this TypeScript module).
 */

export const URLS = {
  /** Source repository on GitHub */
  REPO: 'https://github.com/michael-borck/debrief',
  /** Issue tracker */
  ISSUES: 'https://github.com/michael-borck/debrief/issues',
} as const;
