import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Modal } from './Modal';

type State = 'stopped' | 'setting_up' | 'starting' | 'ready' | 'failed';

interface Status {
  state: State;
  port: number | null;
  lastError: string | null;
  setupSteps: string[];
}

const POLL_DURING_SETUP_MS = 1000;
const POLL_IDLE_MS = 5000;

export const FirstLaunchSetup: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const s = await window.electronAPI.sidecar.status();
        if (cancelled) return;
        setStatus(s);
        const next = s.state === 'setting_up' || s.state === 'starting'
          ? POLL_DURING_SETUP_MS : POLL_IDLE_MS;
        timer = setTimeout(tick, next);
      } catch {
        if (!cancelled) timer = setTimeout(tick, POLL_IDLE_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  // Reset dismissal whenever a setup phase begins fresh.
  useEffect(() => {
    if (status?.state === 'setting_up') setDismissed(false);
  }, [status?.state]);

  if (!status) return null;

  // Setup-failed is shown only if there are setupSteps (failure during install)
  // — otherwise it's a regular sidecar runtime failure handled by the pill.
  const setupFailed = status.state === 'failed' && status.setupSteps.length > 0;
  const isOpen = !dismissed && (status.state === 'setting_up' || setupFailed);
  if (!isOpen) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const s = await window.electronAPI.sidecar.restart();
      setStatus(s);
    } finally {
      setRetrying(false);
    }
  };

  const completed = status.setupSteps.slice(0, -1);
  const current = status.state === 'setting_up'
    ? status.setupSteps[status.setupSteps.length - 1]
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setDismissed(true)}
      closeOnBackdrop={!setupFailed}
      closeOnEscape={!setupFailed}
      ariaLabel="First-time setup"
      contentClassName="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-lg w-full mx-4 p-6"
    >
      <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
        First-time setup
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        deep-talk is downloading and installing the speech analysis engine.
        This is a one-time process, ~1 GB on disk, that takes 3–10 minutes
        depending on your connection. You can keep using the app — features
        that need transcription will become available once setup completes.
      </p>

      <div className="space-y-2 mb-4">
        {completed.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <span>{step}</span>
          </div>
        ))}
        {current && (
          <div className="flex items-start gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 animate-spin" />
            <span>{current}</span>
          </div>
        )}
      </div>

      {setupFailed && (
        <div className="flex items-start gap-2 text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded p-3 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Setup failed</p>
            <p className="mt-1 text-xs">{status.lastError || 'Unknown error.'}</p>
            <p className="mt-2 text-xs">Check your internet connection and try again. Common causes: corporate proxy, antivirus blocking, or a temporary PyPI outage.</p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {setupFailed && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
        )}
        {!setupFailed && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-3 py-1.5 text-sm rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Hide
          </button>
        )}
      </div>
    </Modal>
  );
};
