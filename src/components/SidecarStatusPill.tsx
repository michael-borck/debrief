import React, { useEffect, useState } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';

type State = 'stopped' | 'setting_up' | 'starting' | 'ready' | 'failed';

interface Status {
  state: State;
  port: number | null;
  lastError: string | null;
  setupSteps: string[];
}

const POLL_MS = 5000;

export const SidecarStatusPill: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await window.electronAPI.sidecar.status();
        if (!cancelled) setStatus(s);
      } catch {
        // electronAPI unavailable (e.g. test env) — keep status null
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const s = await window.electronAPI.sidecar.restart();
      setStatus(s);
    } finally {
      setRetrying(false);
    }
  };

  if (!status) return null;

  const config = {
    ready: {
      icon: <Check className="w-3 h-3" />,
      label: `Sidecar :${status.port}`,
      cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
      clickable: false,
    },
    starting: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: 'Sidecar starting…',
      cls: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
      clickable: false,
    },
    setting_up: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: status.setupSteps.length > 0
        ? `Setup: ${status.setupSteps[status.setupSteps.length - 1]}`
        : 'Setting up Python environment…',
      cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
      clickable: false,
    },
    failed: {
      icon: <AlertCircle className="w-3 h-3" />,
      label: retrying ? 'Retrying…' : 'Sidecar failed — retry',
      cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
      clickable: true,
    },
    stopped: {
      icon: <AlertCircle className="w-3 h-3" />,
      label: 'Sidecar stopped',
      cls: 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
      clickable: false,
    },
  }[status.state];

  const interactive = config.clickable && !retrying;
  return (
    <div
      className={`fixed bottom-3 right-3 z-50 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border ${config.cls} ${interactive ? 'cursor-pointer hover:opacity-80' : ''}`}
      title={status.lastError || `state: ${status.state}, port: ${status.port}`}
      onClick={interactive ? handleRetry : undefined}
      role={interactive ? 'button' : undefined}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
};
