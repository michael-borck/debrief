import React, { useRef, useState } from 'react';
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

// "auto" means: pass null to pyannote and let it decide. Anything else is
// an exact speaker count hint pyannote will respect.
type SpeakerChoice = 'auto' | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const DiarisationPanel: React.FC<DiarisationPanelProps> = ({
  transcriptId,
  filePath,
  speakerCount,
  onRerunComplete,
}) => {
  const { showToast } = useToast();
  const [choice, setChoice] = useState<SpeakerChoice>('auto');
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const handleRerun = async () => {
    if (!filePath) return;
    setIsRunning(true);
    setLastResult(null);
    const controller = new AbortController();
    controllerRef.current = controller;

    const numSpeakers = choice === 'auto' ? null : choice;

    const result = await rediarisationService.rerun(
      transcriptId,
      filePath,
      { numSpeakers },
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
      body: numSpeakers
        ? `Asked for ${numSpeakers}; detected ${count}.`
        : `Auto-detected ${count} speaker${count === 1 ? '' : 's'}.`,
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
        <label className="text-xs font-medium text-surface-700 block mb-1.5">
          Number of speakers
        </label>
        <select
          value={String(choice)}
          disabled={isRunning || fileMissing}
          onChange={(e) => {
            const v = e.target.value;
            setChoice(v === 'auto' ? 'auto' : (Number(v) as SpeakerChoice));
          }}
          className="text-sm border border-surface-200 rounded px-2 py-1 w-full bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <option value="auto">Auto-detect</option>
          <option value="2">2 speakers</option>
          <option value="3">3 speakers</option>
          <option value="4">4 speakers</option>
          <option value="5">5 speakers</option>
          <option value="6">6 speakers</option>
          <option value="7">7 speakers</option>
          <option value="8">8 speakers</option>
        </select>
        <p className="text-[11px] text-surface-500 mt-1 leading-snug">
          If auto-detect is splitting one person into two (or merging two
          people into one), pick the number you actually expect and rerun.
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
            Rerun
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
