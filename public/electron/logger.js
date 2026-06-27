// Main-process logger. Mirrors the renderer logger (src/utils/logger.ts):
// log/info/debug/warn are dev-gated (NODE_ENV !== 'production') so production
// builds stay quiet; error() always emits — startup/migration failures are
// worth diagnosing in the field.
//
// Extracted so main-process modules (DB migrations, prompt seeding, …) log
// through one place instead of raw `console`, matching the renderer's
// convention. Add new methods here rather than calling console directly.

const isDev = process.env.NODE_ENV !== 'production';

/* eslint-disable no-console */
module.exports = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },
  info: (...args) => {
    if (isDev) console.info(...args);
  },
  debug: (...args) => {
    if (isDev) console.debug(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};
