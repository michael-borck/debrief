import React, { useState, useMemo, useEffect, useRef } from 'react';
import { logger } from '../utils/logger';
import { Clock, Copy, ExternalLink, User } from 'lucide-react';
import { sentenceSegmentsService } from '../services/sentenceSegmentsService';
import { SentenceSegment } from '../types';
import { HighlightedText, countMatches } from './HighlightedText';

interface TimestampSegment {
  timestamp: string;
  text: string;
  startSeconds?: number;
  speaker?: string;
}

interface TimestampedTranscriptProps {
  transcript: string;
  transcriptId?: string;
  version?: 'original' | 'corrected' | 'speaker_tagged';
  showTimestamps?: boolean;
  editable?: boolean;
  onTextChange?: (newText: string) => void;
  className?: string;
  searchQuery?: string;
  currentPlaybackTime?: number;
  onSeek?: (seconds: number) => void;
}

// Stable colour palette for speaker labels
const SPEAKER_COLORS = [
  'bg-primary-100 text-primary-800 border-primary-200',
  'bg-accent-100 text-accent-800 border-accent-200',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-rose-50 text-rose-700 border-rose-200',
  'bg-violet-50 text-violet-700 border-violet-200',
];

const speakerColorFor = (speaker: string, allSpeakers: string[]): string => {
  const idx = allSpeakers.indexOf(speaker);
  return SPEAKER_COLORS[idx >= 0 ? idx % SPEAKER_COLORS.length : 0];
};

export const TimestampedTranscript: React.FC<TimestampedTranscriptProps> = ({
  transcript,
  transcriptId,
  version = 'original',
  showTimestamps = true,
  editable = false,
  onTextChange,
  className = "",
  searchQuery = "",
  currentPlaybackTime,
  onSeek,
}) => {
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  const [sentenceSegments, setSentenceSegments] = useState<SentenceSegment[]>([]);
  const [useSegments, setUseSegments] = useState(false);
  const [loadingSegments, setLoadingSegments] = useState(false);

  // Load sentence segments if available, create them if they don't exist
  useEffect(() => {
    const loadSegments = async () => {
      if (transcriptId) {
        setLoadingSegments(true);
        logger.log(`Loading segments for transcript ${transcriptId}, version ${version}`);
        
        let segments = await sentenceSegmentsService.getSegments(transcriptId, version);
        logger.log(`Found ${segments.length} existing segments for version ${version}`);
        
        // If no segments found for the requested version, try 'original' as fallback
        if (segments.length === 0 && version !== 'original') {
          logger.log(`No segments found for version ${version}, trying 'original' as fallback`);
          segments = await sentenceSegmentsService.getSegments(transcriptId, 'original');
          logger.log(`Found ${segments.length} original segments as fallback`);
        }
        
        if (segments.length > 0) {
          setSentenceSegments(segments);
          setUseSegments(true);
          logger.log('Using existing segments with timestamps:', segments.some(s => s.start_time != null));
        } else {
          // Try to create segments on-demand for existing transcripts
          if (version === 'original' && transcript) {
            logger.log('No segments found, attempting to create segments on-demand for existing transcript');
            try {
              // For existing transcripts, we create basic segments without chunk timing
              const created = await sentenceSegmentsService.createBasicSegments(transcriptId, transcript);
              if (created) {
                // Reload segments after creation
                const newSegments = await sentenceSegmentsService.getSegments(transcriptId, version);
                logger.log(`Created ${newSegments.length} new basic segments`);
                if (newSegments.length > 0) {
                  setSentenceSegments(newSegments);
                  setUseSegments(true);
                  logger.log('Successfully created and loaded basic segments');
                  setLoadingSegments(false);
                  return;
                }
              }
            } catch (error) {
              logger.warn('Failed to create segments on-demand:', error);
            }
          }
          setUseSegments(false);
        }
        setLoadingSegments(false);
      }
    };

    loadSegments();
  }, [transcriptId, version, transcript]);

  const formatTimestampFromSeconds = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  };

  const segments = useMemo(() => {
    logger.log('Processing segments:', { useSegments, sentenceSegmentsLength: sentenceSegments.length });
    
    // Use sentence segments if available
    if (useSegments && sentenceSegments.length > 0) {
      const processedSegments = sentenceSegments.map(segment => ({
        timestamp: segment.start_time ? formatTimestampFromSeconds(segment.start_time) : '',
        text: segment.text,
        startSeconds: segment.start_time,
        speaker: segment.speaker,
      }));
      
      logger.log('Processed sentence segments:', {
        total: processedSegments.length,
        withTimestamps: processedSegments.filter(s => s.timestamp).length,
        firstSegment: processedSegments[0]
      });
      
      return processedSegments;
    }

    // Fallback to parsing existing timestamps in text
    if (!transcript) return [];

    // Parse timestamps in various formats:
    // [MM:SS], [HH:MM:SS], (MM:SS), (HH:MM:SS), MM:SS, HH:MM:SS
    const timestampRegex = /(\[|\()?(\d{1,2}:\d{2}(?::\d{2})?)\]?/g;
    
    const parts = transcript.split(timestampRegex);
    const segments: TimestampSegment[] = [];
    
    for (let i = 0; i < parts.length; i += 3) {
      const beforeTimestamp = parts[i] || '';
      const timestamp = parts[i + 2] || '';
      
      if (timestamp?.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) {
        // This is a timestamp
        const nextText = parts[i + 3] || '';
        
        segments.push({
          timestamp,
          text: nextText.trim(),
          startSeconds: parseTimestampToSeconds(timestamp)
        });
      } else if (beforeTimestamp.trim()) {
        // This is text without a timestamp
        segments.push({
          timestamp: '',
          text: beforeTimestamp.trim(),
          startSeconds: undefined
        });
      }
    }

    return segments.filter(seg => seg.text || seg.timestamp);
  }, [transcript, useSegments, sentenceSegments]);

  const parseTimestampToSeconds = (timestamp: string): number => {
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  const formatTimestamp = (timestamp: string): string => {
    return `[${timestamp}]`;
  };

  const copyTimestamp = (timestamp: string) => {
    navigator.clipboard.writeText(timestamp);
  };

  const generateExternalToolFormat = () => {
    // Generate format suitable for external audio tools
    const formatted = segments
      .filter(seg => seg.timestamp)
      .map(seg => `${seg.timestamp}: ${seg.text}`)
      .join('\n');

    navigator.clipboard.writeText(formatted);
    alert('Timestamp format copied to clipboard for external tools!');
  };

  // Determine which segment is currently playing based on playback time.
  // Computed unconditionally so the hooks below are always called in the
  // same order on every render (no early-return hook violations).
  const playingSegmentIndex = (() => {
    if (currentPlaybackTime == null || currentPlaybackTime < 0) return -1;
    let last = -1;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (s.startSeconds == null) continue;
      if (s.startSeconds <= currentPlaybackTime) last = i;
      else break;
    }
    return last;
  })();

  // Auto-scroll the currently playing segment into view.
  // MUST stay above any early returns to keep the hook order stable.
  const segmentRefs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    if (playingSegmentIndex >= 0) {
      const el = segmentRefs.current[playingSegmentIndex];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [playingSegmentIndex]);

  // Show loading state while creating segments
  if (loadingSegments) {
    return (
      <div className={`prose max-w-none ${className}`}>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          <span className="ml-2 text-surface-600">Creating sentence segments...</span>
        </div>
      </div>
    );
  }

  // If no segments available, show plain text
  if (segments.length === 0) {
    return (
      <div className={`prose max-w-none ${className}`}>
        <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-surface-800">
          <HighlightedText text={transcript} query={searchQuery} />
        </div>
      </div>
    );
  }

  // Collect unique speakers for stable colour assignment
  const uniqueSpeakers = Array.from(
    new Set(segments.map(s => s.speaker).filter((s): s is string => !!s))
  );

  // When searching, count total matches across all segments
  const totalMatches = searchQuery
    ? segments.reduce((acc, s) => acc + countMatches(s.text, searchQuery), 0)
    : 0;

  const isInteractive = !!onSeek;

  // Count segments with actual timestamps
  const segmentsWithTimestamps = segments.filter(s => s.timestamp && s.timestamp.length > 0);
  logger.log('Segments analysis:', { 
    total: segments.length, 
    withTimestamps: segmentsWithTimestamps.length,
    showTimestamps
  });

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Controls */}
      <div className="flex items-center justify-between bg-surface-50 rounded-lg p-3">
        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-primary-800" />
            <span className="text-xs font-medium text-surface-700">
              {segmentsWithTimestamps.length > 0
                ? `${segmentsWithTimestamps.length} timestamped segments`
                : `${segments.length} sentence segments`
              }
            </span>
          </div>
          {searchQuery && (
            <span className="badge badge-info text-[10px]">
              {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
            </span>
          )}
        </div>

        <button
          onClick={generateExternalToolFormat}
          className="btn-ghost flex items-center gap-1.5"
          title="Copy timestamp format for external audio tools"
        >
          <ExternalLink size={12} />
          <span>Copy for audio tools</span>
        </button>
      </div>

      {/* Timestamped Segments */}
      <div className="space-y-2">
        {segments.map((segment, index) => {
          const hasMatch = searchQuery && countMatches(segment.text, searchQuery) > 0;
          const isPlaying = index === playingSegmentIndex;
          const canSeek = isInteractive && segment.startSeconds != null;
          return (
            <div
              key={index}
              ref={el => { segmentRefs.current[index] = el; }}
              className={`border rounded-lg transition-colors ${
                isPlaying
                  ? 'border-primary-700 bg-primary-50 shadow-card'
                  : hasMatch
                    ? 'border-accent-300 bg-accent-50/50'
                    : highlightedSegment === index
                      ? 'border-surface-300 bg-surface-50'
                      : 'border-surface-200 bg-white hover:border-surface-300'
              } ${canSeek ? 'cursor-pointer' : ''}`}
              onMouseEnter={() => setHighlightedSegment(index)}
              onMouseLeave={() => setHighlightedSegment(null)}
              onClick={() => {
                if (canSeek && segment.startSeconds != null) onSeek!(segment.startSeconds);
              }}
              title={canSeek ? 'Click to play from here' : undefined}
            >
              {/* Segment header: timestamp + speaker */}
              <div className="flex items-center justify-between bg-surface-50 px-4 py-1.5 border-b border-surface-100 rounded-t-lg">
                <div className="flex items-center gap-2 flex-wrap">
                  {segment.speaker && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${speakerColorFor(segment.speaker, uniqueSpeakers)}`}>
                      <User size={10} />
                      {segment.speaker}
                    </span>
                  )}
                  {segment.timestamp ? (
                    <span className="font-mono text-xs font-semibold text-surface-700">
                      {formatTimestamp(segment.timestamp)}
                    </span>
                  ) : (
                    <span className="text-xs text-surface-400">
                      #{index + 1}
                    </span>
                  )}
                </div>

                {segment.timestamp && (
                  <button
                    onClick={() => copyTimestamp(segment.timestamp)}
                    className="p-1 text-surface-400 hover:text-surface-600 hover:bg-surface-200 rounded transition-colors"
                    title="Copy timestamp"
                  >
                    <Copy size={11} />
                  </button>
                )}
              </div>

              <div className="p-4">
                {editable ? (
                  <textarea
                    value={segment.text}
                    onChange={(e) => {
                      const newSegments = [...segments];
                      newSegments[index] = { ...segment, text: e.target.value };
                      const newTranscript = newSegments
                        .map(s => s.timestamp ? `${formatTimestamp(s.timestamp)} ${s.text}` : s.text)
                        .join('\n');
                      onTextChange?.(newTranscript);
                    }}
                    className="w-full resize-none border-none outline-none font-sans text-sm leading-relaxed"
                    rows={Math.max(2, Math.ceil(segment.text.length / 80))}
                  />
                ) : (
                  <div className="font-sans text-sm leading-relaxed whitespace-pre-wrap text-surface-800">
                    <HighlightedText text={segment.text} query={searchQuery} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {segments.length === 0 && (
        <div className="text-center py-8 text-surface-500">
          <Clock size={48} className="mx-auto mb-4 text-surface-300" />
          <p>No timestamps found in transcript</p>
          <p className="text-sm">
            Add timestamps in format [MM:SS] or [HH:MM:SS] for time-indexed editing
          </p>
        </div>
      )}
    </div>
  );
};