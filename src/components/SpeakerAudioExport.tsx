// Per-speaker audio export.
//
// Asks the main process which speakers have diarization turns for this
// transcript, offers one export action per speaker (plus export-all), and
// reports the outcome. The heavy lifting (path resolution, dialogs, ffmpeg,
// sidecar transcripts) happens in the main process — this component only
// ever passes a transcript id and a speaker name.

import React, { useCallback, useEffect, useState } from 'react';
import { AudioLines, Download, FolderDown, Loader2 } from 'lucide-react';
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
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const SpeakerAudioExport: React.FC<SpeakerAudioExportProps> = ({ transcriptId }) => {
  const { showToast } = useToast();
  const [speakers, setSpeakers] = useState<SpeakerClip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busySpeaker, setBusySpeaker] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await window.electronAPI.speakerAudio.speakers(transcriptId);
      if (!result.success) throw new Error(result.error || 'Could not read speaker turns');
      setSpeakers(result.speakers);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not read speaker turns');
    } finally {
      setLoaded(true);
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
        body:
          `${speaker}: ${result.turns} clip(s) saved.` +
          (result.transcriptPath ? ' Transcript saved alongside it.' : ''),
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

  const exportAll = async () => {
    setExportingAll(true);
    try {
      const result = await window.electronAPI.speakerAudio.exportAll(transcriptId);
      if (result.cancelled) return;
      if (result.error) throw new Error(result.error);
      const results = result.results ?? [];
      const failed = results.filter((r) => r.error);
      showToast({
        kind: failed.length === 0 ? 'success' : 'error',
        title: failed.length === 0 ? 'Speakers exported' : 'Some speakers failed',
        body:
          `${results.length - failed.length} of ${results.length} speaker(s) saved` +
          (failed.length ? ` — failed: ${failed.map((f) => f.speaker).join(', ')}` : '') +
          '.',
        duration: 8000,
      });
    } catch (error) {
      showToast({
        kind: 'error',
        title: 'Export failed',
        body: error instanceof Error ? error.message : 'Unknown error',
        duration: 8000,
      });
    } finally {
      setExportingAll(false);
    }
  };

  const busy = busySpeaker !== null || exportingAll;

  return (
    <div className="bg-white rounded-lg border border-surface-200 p-6">
      <h3 className="section-title flex items-center gap-2 mb-1">
        <AudioLines size={16} className="text-primary-500" />
        Per-speaker audio
      </h3>
      <p className="text-xs text-surface-500 mb-4">
        Save everything one speaker said as a single audio file, cut on diarization
        boundaries, with the matching transcript beside it.
      </p>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {loaded && !loadError && speakers.length === 0 && (
        <p className="text-sm text-surface-600">
          No speaker turns are stored for this transcript yet, so there is nothing
          accurate to cut on. Re-run diarisation from the panel above — newer
          imports keep the turns automatically, but older ones did not.
        </p>
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
              disabled={busy}
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

      {speakers.length > 1 && (
        <button
          onClick={() => void exportAll()}
          disabled={busy}
          className="mt-4 flex items-center gap-1.5 px-3 py-1.5 text-sm border border-primary-600 text-primary-700 rounded hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {exportingAll ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FolderDown size={14} />
          )}
          {exportingAll ? 'Exporting all…' : 'Export all speakers to a folder'}
        </button>
      )}
    </div>
  );
};
