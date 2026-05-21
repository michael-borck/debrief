import React, { useEffect, useState } from 'react';
import { Sparkles, Loader, RefreshCw, AlertCircle, ChevronRight, ChevronDown, Clock } from 'lucide-react';
import { topicsService, Topic } from '../services/topicsService';
import { chatService } from '../services/chatService';
import { vectorStoreService } from '../services/vectorStoreService';
import { Transcript } from '../types';

interface TopicsTabProps {
  transcript: Transcript;
  // Optional — when present, clicking a chunk's timestamp will seek the audio.
  onSeek?: (seconds: number) => void;
}

type TopicChoice = 'auto' | 2 | 3 | 4 | 5 | 6;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const TopicsTab: React.FC<TopicsTabProps> = ({ transcript, onSeek }) => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<TopicChoice>('auto');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const existing = await topicsService.load(transcript.id);
        if (!cancelled) setTopics(existing);
      } catch (e) {
        console.error('Failed to load topics:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [transcript.id]);

  const ensurePassagesExist = async (): Promise<void> => {
    // Check the vector store directly — stats.transcripts.includes() can
    // report stale membership from a previous half-completed indexing.
    if (!chatService.isReady()) {
      setProgress('Starting chat service');
      await chatService.initialize();
    }
    const existing = await vectorStoreService.getTranscriptChunks(transcript.id);
    if (existing && existing.length > 0) return;

    setProgress('Preparing passages (one-time)');
    const segments = await window.electronAPI.db.transcriptSegments.listByTranscript(transcript.id);
    if (!segments || segments.length === 0) {
      throw new Error(
        'This transcript has no segments to analyse. Open the transcript and run diarisation, then try again.'
      );
    }
    await chatService.processTranscriptForChat(transcript, segments, (p) => {
      if (p?.message) setProgress(p.message);
    });

    // Verify the indexing actually persisted — if the segments were empty
    // or the embedder failed, processTranscriptForChat returns silently.
    const recheck = await vectorStoreService.getTranscriptChunks(transcript.id);
    if (!recheck || recheck.length === 0) {
      throw new Error(
        'Could not prepare passages. The transcript may be empty, or the embedding service may not be ready.'
      );
    }
  };

  const handleCompute = async () => {
    setComputing(true);
    setError(null);
    setProgress('Preparing');
    try {
      await ensurePassagesExist();
      const numTopics = choice === 'auto' ? null : choice;
      const computed = await topicsService.compute(transcript.id, {
        numTopics,
        onProgress: (s) => setProgress(s),
      });
      setTopics(computed);
      setExpanded(new Set());
    } catch (e: any) {
      setError(e?.message || 'Failed to compute topics');
    } finally {
      setComputing(false);
      setProgress('');
    }
  };

  const toggleExpanded = (topicId: string) => {
    const next = new Set(expanded);
    if (next.has(topicId)) next.delete(topicId);
    else next.add(topicId);
    setExpanded(next);
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-surface-500 text-sm">
        <Loader className="animate-spin mx-auto mb-3" size={20} />
        Loading topics…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent-500" />
            <h2 className="text-lg font-semibold text-surface-900">Topics</h2>
          </div>
          <p className="text-sm text-surface-600 mt-1">
            Groups passages of the conversation into a small number of topics.
            Useful for getting your bearings on a long recording.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={String(choice)}
            onChange={(e) => {
              const v = e.target.value;
              setChoice(v === 'auto' ? 'auto' : (Number(v) as TopicChoice));
            }}
            disabled={computing}
            className="text-sm border border-surface-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option value="auto">Auto</option>
            <option value="2">2 topics</option>
            <option value="3">3 topics</option>
            <option value="4">4 topics</option>
            <option value="5">5 topics</option>
            <option value="6">6 topics</option>
          </select>
          <button
            onClick={handleCompute}
            disabled={computing}
            className="btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3 disabled:opacity-50"
          >
            {computing ? (
              <>
                <Loader size={14} className="animate-spin" />
                {progress || 'Working'}
              </>
            ) : topics.length === 0 ? (
              <>
                <Sparkles size={14} /> Discover topics
              </>
            ) : (
              <>
                <RefreshCw size={14} /> Recompute
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-error bg-error/10 rounded p-3">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {topics.length === 0 && !computing && !error && (
        <div className="text-center py-12 text-surface-500 text-sm">
          <Sparkles size={28} className="mx-auto mb-3 text-surface-300" />
          <p>No topics yet. Click <strong>Discover topics</strong> to analyse this transcript.</p>
          <p className="text-xs mt-2">
            First-time setup takes a few seconds. After that, results are saved
            and load instantly.
          </p>
        </div>
      )}

      {topics.length > 0 && (
        <div className="space-y-2">
          {topics.map((topic) => {
            const isOpen = expanded.has(topic.id);
            const count = topic.chunks?.length ?? topic.chunkIds.length;
            return (
              <div key={topic.id} className="border border-surface-200 rounded-lg bg-white">
                <button
                  onClick={() => toggleExpanded(topic.id)}
                  className="w-full flex items-start gap-3 p-3 hover:bg-surface-50 text-left transition-colors"
                >
                  <div className="mt-0.5 text-surface-400">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-surface-900">{topic.label}</span>
                      <span className="text-xs text-surface-500">
                        · {count} passage{count === 1 ? '' : 's'}
                      </span>
                      {topic.startTime != null && topic.endTime != null && (
                        <span className="text-xs text-surface-500 flex items-center gap-1">
                          <Clock size={11} />
                          {formatTime(topic.startTime)}–{formatTime(topic.endTime)}
                        </span>
                      )}
                    </div>
                    {topic.summary && (
                      <p className="text-sm text-surface-600 mt-1">{topic.summary}</p>
                    )}
                  </div>
                </button>

                {isOpen && topic.chunks && (
                  <div className="border-t border-surface-100 px-3 py-2 space-y-2">
                    {topic.chunks.map((chunk) => (
                      <div key={chunk.id} className="text-sm">
                        <button
                          onClick={() => onSeek?.(chunk.startTime)}
                          disabled={!onSeek}
                          className="text-xs text-primary-700 hover:text-primary-900 tabular-nums disabled:text-surface-400 disabled:cursor-default"
                          title={onSeek ? 'Jump to this point in audio' : 'Load audio to enable jump'}
                        >
                          [{formatTime(chunk.startTime)}]
                        </button>
                        {chunk.speaker && (
                          <span className="text-xs text-surface-500 ml-2">{chunk.speaker}:</span>
                        )}
                        <span className="ml-2 text-surface-800">{chunk.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
