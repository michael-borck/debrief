import React, { useContext } from 'react';
import { BarChart3, X, Ban } from 'lucide-react';
import { ProcessingItem, TranscriptionStage } from '../types';
import { ServiceContext } from '../contexts/ServiceContext';

interface ProcessingQueueProps {
  items: ProcessingItem[];
}

const STAGE_LABEL: Record<TranscriptionStage, string> = {
  queued: 'Waiting…',
  analyzing_media: 'Reading file…',
  extracting: 'Extracting audio…',
  loading_model: 'Loading model…',
  transcribing: 'Transcribing…',
  diarising: 'Identifying speakers…',
  validating: 'Validating text…',
  analyzing: 'Analysing…',
  embedding: 'Indexing…',
  saving: 'Saving…',
};

export const ProcessingQueue: React.FC<ProcessingQueueProps> = ({ items }) => {
  const { removeFromProcessingQueue, cancelProcessingItem } = useContext(ServiceContext);

  const getStatusText = (item: ProcessingItem) => {
    if (item.status === 'completed') return 'Complete';
    if (item.status === 'error') return 'Error';
    if (item.status === 'cancelled') return item.error_message === 'Cancelling…' ? 'Cancelling…' : 'Cancelled';
    if (item.stage) return STAGE_LABEL[item.stage] ?? item.stage;
    // Fallback for the brief moment before the first stage event arrives.
    if (item.status === 'queued') return 'Waiting…';
    if (item.status === 'transcribing') return 'Transcribing…';
    if (item.status === 'analyzing') return 'Analysing…';
    return item.status;
  };

  const getProgressBarColor = (status: string) => {
    switch (status) {
      case 'error':
        return 'bg-error';
      case 'completed':
        return 'bg-success';
      case 'cancelled':
        return 'bg-surface-300';
      default:
        return 'bg-primary-500';
    }
  };

  const isInProgress = (status: ProcessingItem['status']) =>
    status === 'queued' || status === 'transcribing' || status === 'analyzing';

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="card-interactive p-5">
      <h2 className="text-base font-display text-surface-900 mb-4 flex items-center gap-2">
        <BarChart3 size={18} className="text-primary-500" />
        Processing Queue
      </h2>

      <div className="space-y-3">
        {items.map(item => {
          const fileName = item.file_path.split('/').pop() || item.file_path;
          return (
            <div key={item.id} className="flex items-center gap-3 min-w-0">
              {/* min-w-0 lets the flex child shrink below its content's
                  intrinsic width so `truncate` actually works inside flex */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span
                    className="text-sm font-medium text-surface-700 truncate min-w-0"
                    title={fileName}
                  >
                    {fileName}
                  </span>
                  <span className="text-xs text-surface-500 whitespace-nowrap flex-shrink-0">
                    {item.progress}% {getStatusText(item)}
                  </span>
                </div>

                <div className="w-full bg-surface-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ease-out ${getProgressBarColor(item.status)}`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>

                {item.error_message && item.status !== 'cancelled' && (
                  <p
                    className="text-xs text-error mt-1 truncate"
                    title={item.error_message}
                  >
                    {item.error_message}
                  </p>
                )}
              </div>

              {isInProgress(item.status) && (
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
