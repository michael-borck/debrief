import React, { useContext, useEffect, useState } from 'react';
import { BarChart3, X, Ban } from 'lucide-react';
import { ProcessingItem, TranscriptionStage } from '../types';
import { ServiceContext } from '../contexts/ServiceContext';
import { getBasename } from '../utils/helpers';

interface ProcessingQueueProps {
  items: ProcessingItem[];
}

const STAGE_LABEL: Record<TranscriptionStage, string> = {
  queued: 'Waiting',
  analyzing_media: 'Reading file',
  extracting: 'Extracting audio',
  loading_model: 'Loading model',
  transcribing: 'Transcribing',
  diarising: 'Identifying speakers',
  validating: 'Validating text',
  analyzing: 'Analysing',
  embedding: 'Indexing',
  saving: 'Saving',
};

const formatElapsed = (sec: number): string => {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
};

const isInProgress = (status: ProcessingItem['status']) =>
  status === 'queued' || status === 'transcribing' || status === 'analyzing';

export const ProcessingQueue: React.FC<ProcessingQueueProps> = ({ items }) => {
  const { removeFromProcessingQueue, cancelProcessingItem } = useContext(ServiceContext);

  // Tick once a second so elapsed-time counters refresh while items are
  // in-progress. Cheap re-render; skipped entirely when nothing's running.
  const [, setTick] = useState(0);
  const anyInProgress = items.some(i => isInProgress(i.status));
  useEffect(() => {
    if (!anyInProgress) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [anyInProgress]);

  const getStatusText = (item: ProcessingItem): string => {
    if (item.status === 'completed') return 'Complete';
    if (item.status === 'error') return 'Error';
    if (item.status === 'cancelled') return item.error_message === 'Cancelling…' ? 'Cancelling…' : 'Cancelled';
    if (item.stage) return STAGE_LABEL[item.stage] ?? item.stage;
    if (item.status === 'queued') return 'Waiting';
    if (item.status === 'transcribing') return 'Transcribing';
    if (item.status === 'analyzing') return 'Analysing';
    return item.status;
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="card-interactive p-5">
      {/* Indeterminate progress animation keyframes scoped to this component. */}
      <style>{`
        @keyframes debrief-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .debrief-progress-indeterminate {
          position: relative;
          overflow: hidden;
        }
        .debrief-progress-indeterminate::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          width: 25%;
          background: linear-gradient(90deg, transparent, currentColor, transparent);
          opacity: 0.6;
          animation: debrief-indeterminate 1.4s linear infinite;
        }
      `}</style>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-display text-surface-900 flex items-center gap-2">
          <BarChart3 size={18} className="text-primary-500" />
          Processing Queue
        </h2>
        {items.some(i =>
          i.status === 'completed' || i.status === 'error' || i.status === 'cancelled'
        ) && (
          <button
            type="button"
            onClick={() => {
              items
                .filter(i =>
                  i.status === 'completed' || i.status === 'error' || i.status === 'cancelled'
                )
                .forEach(i => {
                  removeFromProcessingQueue(i.id);
                });
            }}
            className="text-xs text-surface-500 hover:text-surface-700 transition-colors"
            title="Remove all completed, errored, and cancelled items"
          >
            Clear completed
          </button>
        )}
      </div>

      <div className="space-y-3">
        {items.map(item => {
          const fileName = getBasename(item.file_path);
          const inProgress = isInProgress(item.status);
          const createdAt = new Date(item.created_at).getTime();
          const elapsedSec = inProgress && !Number.isNaN(createdAt)
            ? Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
            : null;

          let statusLine: string;
          if (inProgress) {
            const stageText = getStatusText(item);
            statusLine = elapsedSec !== null
              ? `${stageText}… ${formatElapsed(elapsedSec)}`
              : `${stageText}…`;
          } else {
            statusLine = getStatusText(item);
          }

          return (
            <div key={item.id} className="flex items-center gap-3 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span
                    className="text-sm font-medium text-surface-700 truncate min-w-0"
                    title={fileName}
                  >
                    {fileName}
                  </span>
                  <span className="text-xs text-surface-500 whitespace-nowrap flex-shrink-0">
                    {statusLine}
                  </span>
                </div>

                {/* In-progress: animated indeterminate sweep. The bar is solid-
                    coloured behind a moving glow so the user reads it as
                    "still working" without seeing a percentage. Terminal
                    states (completed / error / cancelled) get a flat
                    full-width bar in the appropriate colour. */}
                {inProgress ? (
                  <div
                    className="w-full bg-primary-200 rounded-full h-1.5 debrief-progress-indeterminate text-primary-600"
                    role="progressbar"
                    aria-valuetext={statusLine}
                    aria-busy="true"
                  />
                ) : (
                  <div className="w-full bg-surface-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ease-out ${
                        item.status === 'completed' ? 'bg-success' :
                        item.status === 'error' ? 'bg-error' :
                        'bg-surface-300'
                      }`}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}

                {item.error_message && item.status !== 'cancelled' && (
                  <p
                    className="text-xs text-error mt-1 truncate"
                    title={item.error_message}
                  >
                    {item.error_message}
                  </p>
                )}
              </div>

              {inProgress && (
                <button
                  onClick={() => cancelProcessingItem(item.id)}
                  className="text-surface-400 hover:text-error transition-colors flex-shrink-0"
                  title="Cancel"
                  aria-label={`Cancel processing of ${fileName}`}
                >
                  <Ban size={14} />
                </button>
              )}

              {(item.status === 'completed' || item.status === 'error' || item.status === 'cancelled') && (
                <button
                  onClick={() => removeFromProcessingQueue(item.id)}
                  className="text-surface-400 hover:text-surface-600 transition-colors flex-shrink-0"
                  title="Dismiss"
                  aria-label={`Dismiss ${fileName}`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
