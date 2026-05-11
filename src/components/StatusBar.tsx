import React, { useContext } from 'react';
import { ServiceContext } from '../contexts/ServiceContext';
import type { ServiceStatus } from '../types';

// Map ServiceStatus state -> {label shown to the user, dot colour, dot icon
// shape semantic}. State words avoid jargon (no "sidecar", no "venv") — this
// is the surface the user reads, not a debug panel.
const STT_STATES: Record<ServiceStatus['speechToText'], { label: string; dot: string; pulse: boolean }> = {
  connected: { label: 'Ready', dot: 'bg-emerald-500', pulse: false },
  setting_up: { label: 'Installing…', dot: 'bg-blue-500', pulse: true },
  starting: { label: 'Starting…', dot: 'bg-yellow-500', pulse: true },
  error: { label: 'Error', dot: 'bg-red-500', pulse: false },
  disconnected: { label: 'Offline', dot: 'bg-surface-400', pulse: false },
};

const AI_STATES: Record<ServiceStatus['aiAnalysis'], { label: string; dot: string }> = {
  connected: { label: 'Ready', dot: 'bg-emerald-500' },
  error: { label: 'Error', dot: 'bg-red-500' },
  disconnected: { label: 'Offline', dot: 'bg-surface-400' },
};

export const StatusBar: React.FC = () => {
  const { serviceStatus, processingQueue } = useContext(ServiceContext);

  const activeProcessing = processingQueue.filter(item =>
    item.status === 'transcribing' || item.status === 'analyzing'
  ).length;

  const stt = STT_STATES[serviceStatus.speechToText];
  const ai = AI_STATES[serviceStatus.aiAnalysis];
  const sttDetail = serviceStatus.speechToTextDetail;

  return (
    <div className="bg-surface-50 border-t border-surface-200 px-6 py-1.5">
      <div className="flex items-center justify-between text-xs font-sans">
        <div className="flex items-center space-x-5">
          <div
            className="flex items-center space-x-1.5"
            title={sttDetail ? `Speech-to-Text: ${stt.label} — ${sttDetail}` : `Speech-to-Text: ${stt.label}`}
          >
            <span className="text-surface-500">Speech-to-Text</span>
            <div className={`w-1.5 h-1.5 rounded-full ${stt.dot} ${stt.pulse ? 'animate-pulse' : ''}`} />
            <span className="text-surface-700 font-medium">{stt.label}</span>
            {sttDetail && serviceStatus.speechToText === 'setting_up' && (
              <span className="text-surface-500 italic truncate max-w-[280px]">— {sttDetail}</span>
            )}
          </div>

          <div className="flex items-center space-x-1.5" title={`AI Analysis: ${ai.label}`}>
            <span className="text-surface-500">AI Analysis</span>
            <div className={`w-1.5 h-1.5 rounded-full ${ai.dot}`} />
            <span className="text-surface-700 font-medium">{ai.label}</span>
          </div>
        </div>

        {activeProcessing > 0 && (
          <div className="flex items-center space-x-1.5">
            <div className="w-1.5 h-1.5 bg-accent-500 rounded-full animate-pulse" />
            <span className="text-surface-700 font-medium">
              Processing {activeProcessing} file{activeProcessing > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
