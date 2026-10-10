// Rerun speaker diarisation on an already-transcribed file with override
// tunables, then write the new speaker assignments back to the database.
// Does NOT re-run whisper — pulls existing segment timings from the DB
// and re-aligns them to the freshly computed speaker turns.

import { abortable, checkCancelled, isCancelled } from '../utils/cancellation';
import {
  buildRenameMap,
  preserveSpeakerLabels,
  type NamedSpeaker,
  type TimedSpeaker,
} from './speakerLabelPreservation';

export interface DiarisationOverrides {
  // Exact speaker count hint passed straight to pyannote. null/undefined means auto-detect.
  numSpeakers?: number | null;
  // Legacy/unused fields kept for type-compat with older callers; the
  // /rediarise endpoint ignores them.
  clusterThreshold?: number;
  medianFilterFrames?: number;
  minDurationOn?: number;
  minDurationOff?: number;
  noiseMinTotalSeconds?: number;
}

export interface RediariseResult {
  success: boolean;
  speakerCount?: number;
  speakers?: Array<{ id: string; name: string; segments: number }>;
  // Clusters whose speaker identity was ambiguous after re-running, so the
  // previous user-assigned name could not be carried across safely. Surfaced so
  // the UI can ask rather than silently mislabel.
  needsReview?: string[];
  error?: string;
  cancelled?: boolean;
}

interface SpeakerTurn {
  start: number;
  end: number;
  speaker: string;
}

interface ChunkLike {
  start_time: number;
  end_time: number;
}

// Mirror of public/electron/diarise.js:alignSpeakersToChunks. Pure
// function, kept here so the renderer can re-align without an extra IPC
// roundtrip per chunk.
export function alignSpeakersToChunks<T extends ChunkLike>(
  chunks: T[],
  turns: SpeakerTurn[]
): Array<T & { speaker?: string }> {
  if (!turns || turns.length === 0) {
    return chunks.map((c) => ({ ...c }));
  }
  return chunks.map((chunk) => {
    let bestSpeaker: string | undefined;
    let bestOverlap = 0;
    for (const turn of turns) {
      const overlapStart = Math.max(chunk.start_time, turn.start);
      const overlapEnd = Math.min(chunk.end_time, turn.end);
      const overlap = overlapEnd - overlapStart;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = turn.speaker;
      }
    }
    return { ...chunk, speaker: bestSpeaker };
  });
}

export class RediarisationService {
  async rerun(
    transcriptId: string,
    audioPath: string,
    overrides: DiarisationOverrides,
    signal?: AbortSignal
  ): Promise<RediariseResult> {
    try {
      checkCancelled(signal);

      // Pull the original segments — these carry the chunk timings we
      // need to re-align. We deliberately read 'original' (not
      // 'speaker_tagged') because original is what whisper produced; the
      // speaker_tagged version is what we're about to overwrite.
      const segments = await window.electronAPI.segments.getByTranscript({
        transcriptId,
        version: 'original',
      });

      if (!Array.isArray(segments) || segments.length === 0) {
        return {
          success: false,
          error: 'No original segments found for this transcript. Reprocess the file first.',
        };
      }

      const chunkLikes = segments
        .filter((s) => typeof s.start_time === 'number' && typeof s.end_time === 'number')
        .map((s) => ({
          start_time: s.start_time as number,
          end_time: s.end_time as number,
          text: s.text,
          sentence_index: s.sentence_index,
          source_chunk_index: s.source_chunk_index,
          word_count: s.word_count,
        }));

      if (chunkLikes.length === 0) {
        return {
          success: false,
          error: 'Original segments are missing timing info; cannot re-align speakers.',
        };
      }

      checkCancelled(signal);

      const result = await abortable(
        window.electronAPI.audio.rediarise(audioPath, overrides),
        signal
      );

      if (!result.success) {
        return { success: false, error: result.error || 'Rediarisation failed in main process.' };
      }

      const turns = result.speakerTurns || [];
      const aligned = alignSpeakersToChunks(chunkLikes, turns);

checkCancelled(signal);

      // Capture the user's existing speaker names BEFORE the tagged version is
      // replaced. Re-diarisation reassigns SPEAKER_00… arbitrarily on every run,
      // so the mapping is recovered from temporal overlap rather than from ids —
      // see speakerLabelPreservation.
      const [previouslyTagged, transcriptRow] = await Promise.all([
        window.electronAPI.segments
          .getByTranscript({ transcriptId, version: 'speaker_tagged' })
          .catch(() => []),
        window.electronAPI.db.transcripts.get(transcriptId).catch(() => null),
      ]);
      const renames = buildRenameMap(transcriptRow?.speakers as NamedSpeaker[] | undefined);

      // Build speaker_tagged segments. We replace the existing tagged
      // version entirely — there is no useful merge of the TIMINGS with stale
      // tags, since the whole point of re-running is new timings and new
      // boundaries. The user's NAMES are carried across separately, below.
      await window.electronAPI.segments.deleteByTranscript({
        transcriptId,
        version: 'speaker_tagged',
      });

      const { labels, needsReview } = preserveSpeakerLabels(
        aligned as TimedSpeaker[],
        previouslyTagged as TimedSpeaker[],
        renames
      );

      const speakerCounts: Record<string, number> = {};
      const tagged = aligned.map((c, idx) => {
        const speaker = c.speaker ? (labels.get(c.speaker) ?? c.speaker) : 'Unknown';
        speakerCounts[speaker] = (speakerCounts[speaker] ?? 0) + 1;
        return {
          transcriptId,
          sentenceIndex: idx,
          text: c.text,
          startTime: c.start_time,
          endTime: c.end_time,
          speaker,
          confidence: 0.85,
          version: 'speaker_tagged' as const,
          sourceChunkIndex: c.source_chunk_index ?? null,
          wordCount: c.word_count,
        };
      });

      await window.electronAPI.segments.create({
        transcriptId,
        segments: tagged,
      });

      // Replace the persisted turns too. A fresh run means every boundary moved,
      // so keeping the old ones would clip audio on stale boundaries.
      try {
        await window.electronAPI.db.diarizationTurns.save(
          transcriptId,
          turns.map((t) => ({ speaker: t.speaker, start: t.start, end: t.end }))
        );
      } catch (turnErr) {
        console.warn('[rediarisationService] failed to persist diarization turns:', turnErr);
      }

      const speakers = Object.entries(speakerCounts).map(([id, segCount]) => ({
          id,
          // The preserved name where one was recovered, else the raw cluster id.
          name: id,
          segments: segCount,
        }));

      // Persist on the transcript row so the rest of the UI stays in
      // sync (speaker count badge, charts, etc.).
      await window.electronAPI.db.transcripts.update(transcriptId, {
        speakers,
        speaker_count: speakers.length,
        updated_at: new Date().toISOString(),
      });

      if (needsReview.length > 0) {
        console.warn(
          '[rediarisationService] speaker identity ambiguous for ' +
            `${needsReview.length} cluster(s) after re-diarisation; they were left unlabelled. ` +
            'Previous names could not be assigned unambiguously — review them in Speaker Tagging.'
        );
      }

      return {
        success: true,
        speakerCount: speakers.length,
        speakers,
        needsReview,
      };
    } catch (error) {
      if (isCancelled(error)) {
        return { success: false, cancelled: true, error: 'Cancelled' };
      }
      console.error('[rediarisationService] error:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}

export const rediarisationService = new RediarisationService();
