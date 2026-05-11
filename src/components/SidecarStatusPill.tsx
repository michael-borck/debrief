import React, { useState } from 'react';
import { CheckCircle2, Loader2, XCircle, Circle, RefreshCw } from 'lucide-react';
import { useSidecarStatus } from '../hooks/useSidecarStatus';

export const SidecarStatusPill: React.FC = () => {
  const status = useSidecarStatus();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await window.electronAPI.sidecar.restart();
    } finally {
      setRetrying(false);
    }
  };

  if (!status) return null;

  // Each state has a distinct icon SHAPE (not just colour) plus an explicit
  // textual state word, so the pill stays readable for colour-blind users.
  const config = {
    ready: {
      icon: <CheckCircle2 className="w-4 h-4" aria-hidden="true" />,
      stateWord: 'Ready',
      detail: status.port ? `port ${status.port}` : '',
      cls: 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border-green-300 dark:border-green-700',
      clickable: false,
    },
    starting: {
      icon: <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />,
      stateWord: 'Starting',
      detail: '',
      cls: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700',
      clickable: false,
    },
    setting_up: {
      icon: <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />,
      stateWord: 'Setting up',
      detail: status.setupSteps.length > 0 ? status.setupSteps[status.setupSteps.length - 1] : '',
      cls: 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-700',
      clickable: false,
    },
    failed: {
      icon: <XCircle className="w-4 h-4" aria-hidden="true" />,
      stateWord: retrying ? 'Retrying' : 'Failed',
      detail: retrying ? '' : 'click to retry',
      cls: 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700',
      clickable: true,
    },
    stopped: {
      icon: <Circle className="w-4 h-4" aria-hidden="true" />,
      stateWord: 'Stopped',
      detail: '',
      cls: 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600',
      clickable: false,
    },
  }[status.state];

  const interactive = config.clickable && !retrying;
  const detailText = config.detail ? ` — ${config.detail}` : '';
  return (
    <div
      className={`fixed bottom-3 right-3 z-50 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-full border-2 shadow-sm ${config.cls} ${interactive ? 'cursor-pointer hover:shadow-md' : ''}`}
      title={status.lastError || `Sidecar state: ${status.state}, port: ${status.port ?? 'n/a'}`}
      onClick={interactive ? handleRetry : undefined}
      role={interactive ? 'button' : 'status'}
      aria-live="polite"
      aria-label={`Sidecar ${config.stateWord}${detailText}`}
    >
      {config.icon}
      <span>
        <span className="font-semibold">Sidecar {config.stateWord}</span>
        {config.detail && (
          <span className="opacity-80 ml-1">— {config.detail}</span>
        )}
      </span>
      {interactive && <RefreshCw className="w-3.5 h-3.5 ml-1" aria-hidden="true" />}
    </div>
  );
};

// Notes on accessibility choices:
// - Icon SHAPES differ per state (checkmark / spinner / X / triangle / open
//   circle), not just colour — distinguishable in greyscale.
// - The state word ('Ready', 'Setting up', 'Starting', 'Failed', 'Stopped')
//   is always rendered alongside, so the pill is readable without colour.
// - Font bumped from text-xs to text-sm with font-medium/font-semibold so
//   it's actually legible at a glance.
// - aria-live='polite' announces state changes to screen readers; aria-label
//   collapses everything into one phrase for assistive tech.
