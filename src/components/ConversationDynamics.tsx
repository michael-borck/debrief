// Conversation dynamics (prosody phase 1): overlap, pauses, interruption
// and backchannel candidates computed from stored diarization turns and
// sentence segments. Heuristics over turn boundaries only — definitions
// are shown in the footer so the numbers are never read as ML judgements.

import React, { useEffect, useMemo, useState } from 'react';
import { Waves } from 'lucide-react';
import { computeDynamics, type ConversationDynamics as Dynamics } from '../utils/prosody';
import type { SentenceSegment } from '../types';

interface ConversationDynamicsProps {
  transcriptId: string;
  segments: SentenceSegment[];
  durationSeconds?: number;
}

function secs(v: number): string {
  return `${v.toFixed(1)}s`;
}

export const ConversationDynamics: React.FC<ConversationDynamicsProps> = ({
  transcriptId,
  segments,
  durationSeconds,
}) => {
  const [turns, setTurns] = useState<Array<{ speaker: string; start: number; end: number }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await window.electronAPI.db.diarizationTurns.listByTranscript(transcriptId);
        if (!cancelled) {
          setTurns(rows.map((r) => ({
            speaker: r.speaker, start: r.start_time, end: r.end_time,
          })));
        }
      } catch {
        if (!cancelled) setTurns([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [transcriptId]);

  const dynamics: Dynamics | null = useMemo(
    () => computeDynamics(turns, segments, durationSeconds),
    [turns, segments, durationSeconds]
  );

  if (!loaded) return null;

  return (
    <div className="bg-white rounded-lg border border-surface-200 p-6">
      <h3 className="section-title flex items-center gap-2 mb-1">
        <Waves size={16} className="text-primary-500" />
        Conversation dynamics
      </h3>
      {!dynamics ? (
        <p className="text-sm text-surface-600">
          No diarization turns are stored for this transcript yet, so there is
          nothing accurate to measure. Re-run diarisation from the panel above.
        </p>
      ) : (
        <>
          <div className="text-sm text-surface-700 space-y-1 mb-4">
            <div>
              Overlap: {secs(dynamics.overlapSeconds)} (
              {(dynamics.overlapShare * 100).toFixed(1)}% of the recording)
            </div>
            <div>
              Pauses: {dynamics.pauseCount} (median {secs(dynamics.medianPauseSeconds)},{' '}
              {dynamics.longPauses} over 1s)
            </div>
          </div>
          <div className="space-y-2">
            {dynamics.speakers.map((s) => (
              <div
                key={s.speaker}
                className="py-2 border-b border-surface-100 last:border-b-0"
              >
                <div className="text-sm font-medium text-surface-800">{s.speaker}</div>
                <div className="text-xs text-surface-500">
                  {(s.talkShare * 100).toFixed(0)}% of speech · {s.turns} turns · avg{' '}
                  {secs(s.avgTurnSeconds)}
                  {s.wordsPerMinute !== null && ` · ${s.wordsPerMinute} wpm`}
                </div>
                <div className="text-xs text-surface-500">
                  Started during another speaker {s.interruptionsMade}× · was spoken
                  over {s.timesInterrupted}× · backchannel candidates {s.backchannels}×
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-surface-400 mt-4">
            Computed from diarization turn boundaries: overlap is time two or more
            speakers sound together; “started during” means a turn began while
            another speaker’s turn was still running; backchannel candidates are
            turns ≤1s (≤3 words) inside another speaker’s stretch. Heuristics,
            not judgements — natural turn-taking can produce all three.
          </p>
        </>
      )}
    </div>
  );
};
