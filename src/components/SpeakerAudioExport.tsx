// Per-speaker audio export.
//
// Asks the main process which speakers have diarization turns for this transcript,
// offers one export action per speaker, and reports the outcome. The heavy lifting
// (path resolution, save dialog, ffmpeg) happens in the main process — this
// component only ever passes a transcript id and a speaker name.

import React, { useCallback, useEffect, useState } from 'react';
import { AudioLines, Download, Loader2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

export interface SpeakerClip {
  speaker: string;
  turns: number;
  seconds: number;
}

interface SpeakerAudioExportProps {
  transcriptId: string;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const SpeakerAudioExport: React.FC<SpeakerAudioExportProps> = ({ transcriptId }) => {
  const { showToast } = useToast();
  const [speakers, setSpeakers] = useState<SpeakerClip[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busySpeaker, setBusySpeaker] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.electronAPI.speakerAudio.speakers(transcriptId);
      if (!result.success) throw new Error(result.error || 'Could not read speaker turns');
      setSpeakers(result.speakers);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not read speaker turns');
    }
  }, [transcriptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportSpeaker = async (speaker: string) => {
    setBusySpeaker(speaker);
    try {
      const result = await window.electronAPI.speakerAudio.export(transcriptId, speaker);
      if (result.cancelled) return;
      if (result.error) throw new Error(result.error);
      showToast({
        kind: 'success',
        title: 'Audio exported',
        body: `${speaker}: ${result.turns} clip(s) saved.`,
        duration: 6000,
      });
    } catch (error) {
      showToast({
        kind: 'error',
        title: 'Export failed',
        body: error instanceof Error ? error.message : 'Unknown error',
        duration: 8000,
      });
    } finally {
      setBusySpeaker(null);
    }
  };

  // No turns at all: the transcript predates turn persistence or diarisation is
  // off. Explain the fix instead of rendering a dead control.
  if (!loadError && speakers.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-surface-200 p-6">
      <h3 className="section-title flex items-center gap-2 mb-1">
        <AudioLines size={16} className="text-primary-500" />
        Per-speaker audio
      </h3>
      <p className="text-xs text-surface-500 mb-4">
        Save everything one speaker said as a single audio file, cut on diarization
        boundaries.
      </p>

      {loadError && (
        <p className="text-sm text-red-600">{loadError}</p>
      )}

      <div className="space-y-2">
        {speakers.map(({ speaker, turns, seconds }) => (
          <div
            key={speaker}
            className="flex items-center justify-between gap-3 py-2 border-b border-surface-100 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-surface-800 truncate">{speaker}</div>
              <div className="text-xs text-surface-500">
                {formatSeconds(seconds)} across {turns} turn{turns === 1 ? '' : 's'}
              </div>
            </div>
            <button
              onClick={() => void exportSpeaker(speaker)}
              disabled={busySpeaker !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 transition-colors"
            >
              {busySpeaker === speaker ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {busySpeaker === speaker ? 'Exporting…' : 'Export'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};