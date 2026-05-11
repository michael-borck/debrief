import { useEffect, useState } from 'react';

export type SidecarState = 'stopped' | 'setting_up' | 'starting' | 'ready' | 'failed';

export interface SidecarStatus {
  state: SidecarState;
  port: number | null;
  lastError: string | null;
  setupSteps: string[];
}

const DEFAULT_POLL_MS = 5000;

// Subscribes to the sidecar's lifecycle. Polls every `pollMs` (default 5s,
// the pill uses this) — pass a smaller value if you want snappier reactivity
// in a modal that gates user action on readiness.
export function useSidecarStatus(pollMs: number = DEFAULT_POLL_MS): SidecarStatus | null {
  const [status, setStatus] = useState<SidecarStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await window.electronAPI.sidecar.status();
        if (!cancelled) setStatus(s);
      } catch {
        // electronAPI unavailable (e.g. SSR/tests) — leave status null
      }
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollMs]);

  return status;
}
