// Dev-gated logger for the renderer. log/warn/info/debug only emit in
// development; webpack's DefinePlugin inlines process.env.NODE_ENV at build
// time, so in a production bundle these collapse to no-ops and the calls are
// dead-code-eliminated. error() always emits — production diagnostics for
// user-reported issues are worth keeping (and ErrorBoundary relies on it).
const isDev = process.env.NODE_ENV !== 'production';

/* eslint-disable no-console */
export const logger = {
  log: (...args: unknown[]): void => {
    if (isDev) console.log(...args);
  },
  warn: (...args: unknown[]): void => {
    if (isDev) console.warn(...args);
  },
  info: (...args: unknown[]): void => {
    if (isDev) console.info(...args);
  },
  debug: (...args: unknown[]): void => {
    if (isDev) console.debug(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};
