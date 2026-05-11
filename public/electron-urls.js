/**
 * CommonJS mirror of src/constants/urls.ts for the main process.
 *
 * Keep these values in sync with src/constants/urls.ts. They're separated
 * because the main process can't import TypeScript modules at runtime.
 */

module.exports = {
  REPO: 'https://github.com/michael-borck/debrief',
  ISSUES: 'https://github.com/michael-borck/debrief/issues',
};
