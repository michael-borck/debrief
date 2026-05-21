// Some bundled deps reference the Node-style `global` at runtime. We used to
// set this via an inline <script> in index.html, which forced
// script-src 'unsafe-inline' in the CSP. Importing this first (before any other
// module) sets it inside the bundle instead, so the inline script — and the
// 'unsafe-inline' allowance — can go away.
if (typeof (globalThis as { global?: unknown }).global === 'undefined') {
  (globalThis as { global?: unknown }).global = globalThis;
}

export {};
