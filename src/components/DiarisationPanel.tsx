import React, { useEffect, useRef, useState } from 'react';
import { Users, RefreshCw, AlertCircle, CheckCircle, Ban } from 'lucide-react';
import { rediarisationService } from '../services/rediarisationService';
import { useToast } from '../contexts/ToastContext';

interface DiarisationPanelProps {
  transcriptId: string;
  filePath?: string;
  speakerCount: number;
  // Called after a successful rerun so the parent can reload the
  // transcript and segments to reflect the new speaker assignments.
  onRerunComplete?: () => void | Promise<void>;
}

const SLIDER_MIN = 0.30;
const SLIDER_MAX = 0.75;
const SLIDER_STEP = 0.01;

export const DiarisationPanel: React.FC<DiarisationPanelProps> = ({
  transcriptId,
  filePath,
  speakerCount,
  onRerunComplete,
}) => {
  const { showToast } = useToast();
  const [threshold, setThreshold] = useState<number>(0.50);
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Load the global default threshold once, just to seed the slider so
  // the user's current saved preference is the visible starting point.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await window.electronAPI.database.get(
          'SELECT value FROM settings WHERE key = ?',
          ['diaClusterThreshold']
        );
        const saved = row?.value != null ? parseFloat(row.value) : 0.50;
        if (!cancelled && Number.isFinite(saved)) {
          setThreshold(Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, saved)));
        }
      } catch {
        // Fallback to default; not worth a toast.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRerun = async () => {
    if (!filePath) return;
    setIsRunning(true);
    setLastResult(null);
    const controller = new AbortController();
    controllerRef.current = controller;

    const result = await rediarisationService.rerun(
      transcriptId,
      filePath,
      { clusterThreshold: threshold },
      controller.signal
    );

    setIsRunning(false);
    controllerRef.current = null;

    if (result.cancelled) {
      setLastResult({ ok: false, message: 'Cancelled.' });
      return;
    }

    if (!result.success) {
      setLastResult({ ok: false, message: result.error || 'Rerun failed.' });
      showToast({ kind: 'error', title: 'Rediarisation failed', body: result.error || '', duration: 6000 });
      return;
    }

    const count = result.speakerCount ?? 0;
    setLastResult({
      ok: true,
      message: `Done — ${count} speaker${count === 1 ? '' : 's'} detected.`,
    });
    showToast({
      kind: 'success',
      title: 'Speakers updated',
      body: `${count} speaker${count === 1 ? '' : 's'} detected at threshold ${threshold.toFixed(2)}.`,
      duration: 5000,
    });
    if (onRerunComplete) {
      await onRerunComplete();
    }
  };

  const handleCancel = () => {
    controllerRef.current?.abort();
  };

  const fileMissing = !filePath;

  return (
    <div className="card-static p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-accent-500" />
        <h3 className="text-sm font-semibold text-surface-900">Speaker detection</h3>
        <span className="text-xs text-surface-500 ml-auto">
          Currently {speakerCount} speaker{speakerCount === 1 ? '' : 's'}
        </span>
      </div>

      {fileMissing && (
        <div className="flex items-start gap-2 text-xs text-surface-500 bg-surface-50 rounded p-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Original audio file isn't available — rerun isn't possible.</span>
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-surface-700 flex items-center justify-between mb-1.5">
          <span>Cluster threshold</span>
          <span className="text-surface-500 tabular-nums">{threshold.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={SLIDER_STEP}
          value={threshold}
          disabled={isRunning || fileMissing}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="w-full accent-accent-500 h-1"
        />
        <p className="text-[11px] text-surface-500 mt-1 leading-snug">
          Lower values split speakers more aggressively (more speakers).
          Higher values merge similar voices (fewer speakers).
        </p>
      </div>

      <div className="flex items-center gap-2">
        {!isRunning ? (
          <button
            onClick={handleRerun}
            disabled={fileMissing}
            className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3 disabled:opacity-50"
          >
            <RefreshCw size={12} />
            Rerun with this threshold
          </button>
        ) : (
          <>
            <span className="text-xs text-surface-600 flex items-center gap-1.5">
              <RefreshCw size={12} className="animate-spin" />
              Running…
            </span>
            <button
              onClick={handleCancel}
              className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
            >
              <Ban size={12} />
              Cancel
            </button>
          </>
        )}
      </div>

      {lastResult && !isRunning && (
        <div
          className={`flex items-start gap-2 text-xs rounded p-2 ${
            lastResult.ok ? 'text-success bg-success/10' : 'text-error bg-error/10'
          }`}
        >
          {lastResult.ok ? (
            <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          )}
          <span>{lastResult.message}</span>
        </div>
      )}
    </div>
  );
};
