import React, { useEffect, useState } from 'react';
import { logger } from '../utils/logger';
import { X, Download, FileText, CheckCircle, Edit3, Users } from 'lucide-react';
import { Transcript, type SentenceSegment } from '../types';
import { buildDocx, buildPdf } from '../services/exportService';
import {
  selectSegments,
  toSrt,
  toVtt,
  toSpeakerText,
  precisionNote,
  precisionFor,
  toTimedLines,
  type TimePrecision,
} from '../utils/timestamped-export';
import { Modal } from './Modal';

interface ExportModalProps {
  transcript: Transcript;
  isOpen: boolean;
  onClose: () => void;
}

type ExportVersion = 'original' | 'corrected' | 'speaker-tagged';
type ExportFormat = 'markdown' | 'txt' | 'json' | 'docx' | 'pdf' | 'srt' | 'vtt' | 'timestamped-txt';
type TimestampFormat = 'preserve' | 'remove' | 'external-tools';

export const ExportModal: React.FC<ExportModalProps> = ({
  transcript,
  isOpen,
  onClose,
}) => {
  const [selectedVersion, setSelectedVersion] = useState<ExportVersion>('corrected');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeAnalysis, setIncludeAnalysis] = useState(true);
  const [timestampFormat, setTimestampFormat] = useState<TimestampFormat>('preserve');

  const processTimestamps = (text: string): string => {
    if (!text) return text;
    
    switch (timestampFormat) {
      case 'remove':
        // Remove all timestamps in format [MM:SS] or [HH:MM:SS]
        return text.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, '').replace(/\n\s*\n/g, '\n').trim();
      
      case 'external-tools': {
        // Format for external audio tools: timestamp at start of each segment
        const segments = text.split(/(\[(\d{1,2}:\d{2}(?::\d{2})?)\])/);
        let formatted = '';
        for (let i = 0; i < segments.length; i += 3) {
          const beforeTimestamp = segments[i] || '';
          const timestampWithBrackets = segments[i + 1] || '';
          const nextText = segments[i + 3] || '';
          
          if (timestampWithBrackets && nextText) {
            formatted += `${timestampWithBrackets} ${nextText.trim()}\n`;
          } else if (beforeTimestamp.trim()) {
            formatted += `${beforeTimestamp.trim()}\n`;
          }
        }
        return formatted.trim();
      }
      default:
        return text;
    }
  };

  const getTranscriptContent = (): string => {
    let content: string;
    switch (selectedVersion) {
      case 'original':
        content = transcript.full_text || 'No original transcript available.';
        break;
      case 'corrected':
        content = transcript.validated_text || transcript.full_text || 'No corrected transcript available.';
        break;
      case 'speaker-tagged':
        content = transcript.processed_text || transcript.validated_text || transcript.full_text || 'No speaker-tagged transcript available.';
        break;
      default:
        content = transcript.full_text || 'No transcript available.';
    }
    
    return processTimestamps(content);
  };

  const getVersionDescription = (version: ExportVersion): string => {
    switch (version) {
      case 'original':
        return 'Raw transcript as received from speech-to-text service';
      case 'corrected':
        return 'AI-corrected version with improved spelling, grammar, and punctuation';
      case 'speaker-tagged':
        return 'Formatted version with speaker identification and proper formatting';
    }
  };

  const isVersionAvailable = (version: ExportVersion): boolean => {
    switch (version) {
      case 'original':
        return !!transcript.full_text && transcript.full_text.trim().length > 0;
      case 'corrected':
        return !!transcript.validated_text && transcript.validated_text.trim().length > 0;
      case 'speaker-tagged':
        return !!transcript.processed_text && transcript.processed_text.trim().length > 0;
    }
  };

  const getVersionUnavailableReason = (version: ExportVersion): string => {
    switch (version) {
      case 'original':
        return 'Original transcript not found';
      case 'corrected':
        return 'No corrected version available - enable transcript validation in Settings or use "Generate Correction"';
      case 'speaker-tagged':
        return 'No speaker-tagged version available - use "Speaker Tagging" feature first';
      default:
        return 'Version not available';
    }
  };

  const getVersionIcon = (version: ExportVersion) => {
    switch (version) {
      case 'original':
        return <FileText size={16} className="text-surface-500" />;
      case 'corrected':
        return <Edit3 size={16} className="text-primary-500" />;
      case 'speaker-tagged':
        return <Users size={16} className="text-green-500" />;
    }
  };

  /**
   * Timestamped exports (srt/vtt/timestamped-txt) are built from the stored
   * sentence segments — the only source of per-line timings in the database —
   * optionally filtered to one speaker.
   */
  const buildTimestampedExport = (format: 'srt' | 'vtt' | 'timestamped-txt'): string => {
    const segments = selectSegments(timestampedSegments, speakerFilter || null);
    const precision: TimePrecision = precisionFor(segments);
    const note = precisionNote(precision);

    if (format === 'srt') return toSrt(toTimedLines(segments, precision));
    if (format === 'vtt') return toVtt(toTimedLines(segments, precision));

    const header = `Transcript: ${transcript.title}\n` +
      `${note}\n` +
      (speakerFilter ? `Speaker: ${speakerFilter}\n` : '') +
      `\n`;
    return header + toSpeakerText(toTimedLines(segments, precision));
  };

  const buildExportContent = (): string => {
    const transcriptContent = getTranscriptContent();

    if (selectedFormat === 'srt' || selectedFormat === 'vtt' || selectedFormat === 'timestamped-txt') {
      return buildTimestampedExport(selectedFormat);
    }

    if (selectedFormat === 'txt') {
      return transcriptContent;
    }

    if (selectedFormat === 'json') {
      const exportData = {
        metadata: {
          title: transcript.title,
          filename: transcript.filename,
          created_at: transcript.created_at,
          updated_at: transcript.updated_at,
          duration: transcript.duration,
          version: selectedVersion
        },
        content: transcriptContent,
        ...(includeAnalysis && {
          analysis: {
            summary: transcript.summary,
            key_topics: transcript.key_topics,
            action_items: transcript.action_items,
            sentiment_overall: transcript.sentiment_overall,
            sentiment_score: transcript.sentiment_score,
            emotions: transcript.emotions,
            speaker_count: transcript.speaker_count,
            speakers: transcript.speakers
          }
        })
      };
      return JSON.stringify(exportData, null, 2);
    }

    // Markdown format
    let content = `# ${transcript.title}\n\n`;

    if (includeMetadata) {
      content += `## Transcript Information\n\n`;
      content += `- **File:** ${transcript.filename}\n`;
      content += `- **Created:** ${new Date(transcript.created_at).toLocaleString()}\n`;
      if (transcript.duration) {
        const minutes = Math.floor(transcript.duration / 60);
        const seconds = transcript.duration % 60;
        content += `- **Duration:** ${minutes}:${seconds.toString().padStart(2, '0')}\n`;
      }
      content += `- **Version:** ${selectedVersion.charAt(0).toUpperCase() + selectedVersion.slice(1).replace('-', ' ')}\n`;
      if (transcript.speaker_count && transcript.speaker_count > 1) {
        content += `- **Speakers:** ${transcript.speaker_count}\n`;
      }
      content += `\n`;
    }

    if (includeAnalysis && transcript.summary) {
      content += `## Summary\n\n${transcript.summary}\n\n`;
    }

    if (includeAnalysis && transcript.key_topics && transcript.key_topics.length > 0) {
      content += `## Key Topics\n\n${transcript.key_topics.map(topic => `- ${topic}`).join('\n')}\n\n`;
    }

    if (includeAnalysis && transcript.action_items && transcript.action_items.length > 0) {
      content += `## Action Items\n\n${transcript.action_items.map(item => `- ${item}`).join('\n')}\n\n`;
    }

    if (includeAnalysis && (transcript.sentiment_overall || transcript.emotions)) {
      content += `## Analysis\n\n`;
      
      if (transcript.sentiment_overall) {
        content += `**Sentiment:** ${transcript.sentiment_overall}`;
        if (transcript.sentiment_score !== undefined) {
          content += ` (${transcript.sentiment_score > 0 ? '+' : ''}${transcript.sentiment_score.toFixed(2)})`;
        }
        content += `\n\n`;
      }

      if (transcript.emotions && Object.keys(transcript.emotions).length > 0) {
        content += `**Emotions:**\n`;
        Object.entries(transcript.emotions)
          .filter(([_, value]) => value > 0.1)
          .sort(([,a], [,b]) => b - a)
          .forEach(([emotion, value]) => {
            content += `- ${emotion.charAt(0).toUpperCase() + emotion.slice(1)}: ${Math.round(value * 100)}%\n`;
          });
        content += `\n`;
      }
    }

    content += `## Transcript\n\n${transcriptContent}\n`;

    return content;
  };

  // Segments for timestamped exports. Exactly ONE version must be used:
  // fetching without a version returns original+corrected+speaker_tagged
  // interleaved by sentence_index, duplicating every cue (found in the
  // 2026-10-14 audit). Preference order: speaker_tagged (display speaker
  // names) → original (diarization cluster labels) → corrected (no speaker
  // data, last resort for timings only).
  const [segmentSpeakers, setSegmentSpeakers] = useState<string[]>([]);
  const [timestampedSegments, setTimestampedSegments] = useState<SentenceSegment[]>([]);
  const [speakerFilter, setSpeakerFilter] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        let segments: SentenceSegment[] = [];
        for (const version of ['speaker_tagged', 'original', 'corrected'] as const) {
          const rows = await window.electronAPI.segments.getByTranscript({
            transcriptId: transcript.id,
            version,
          });
          if (Array.isArray(rows) && rows.length > 0) {
            segments = rows as SentenceSegment[];
            break;
          }
        }
        if (cancelled) return;
        const names = [
          ...new Set(
            segments
              .map((s) => s.speaker?.trim())
              .filter((s): s is string => !!s)
          ),
        ];
        setTimestampedSegments(segments);
        setSegmentSpeakers(names);
      } catch (error) {
        logger.error('Failed to load segments for export:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, transcript.id]);

  const isTimestampedFormat =
    selectedFormat === 'srt' || selectedFormat === 'vtt' || selectedFormat === 'timestamped-txt';

  const downloadBlob = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${transcript.title.replace(/[^a-z0-9]/gi, '_')}_${selectedVersion}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    try {
      // Binary formats use the export service
      if (selectedFormat === 'docx' || selectedFormat === 'pdf') {
        const payload = {
          transcript,
          transcriptContent: getTranscriptContent(),
          versionLabel: selectedVersion.charAt(0).toUpperCase() + selectedVersion.slice(1).replace('-', ' '),
          includeMetadata,
          includeAnalysis,
        };
        const blob = selectedFormat === 'docx'
          ? await buildDocx(payload)
          : buildPdf(payload);
        downloadBlob(blob, selectedFormat);
        onClose();
        return;
      }

      // Text formats stay inline
      const content = buildExportContent();
      const mimeByFormat: Partial<Record<ExportFormat, string>> = {
        json: 'application/json',
        srt: 'application/x-subrip',
        vtt: 'text/vtt',
      };
      const extensionByFormat: Partial<Record<ExportFormat, string>> = {
        markdown: 'md',
        'timestamped-txt': 'txt',
      };
      const blob = new Blob([content], {
        type: mimeByFormat[selectedFormat] ?? 'text/plain',
      });
      downloadBlob(blob, extensionByFormat[selectedFormat] ?? selectedFormat);
      onClose();
    } catch (error) {
      logger.error('Export failed:', error);
      alert(`Export failed: ${(error as Error).message}`);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Export Transcript"
      contentClassName="bg-white rounded-lg shadow-elevated w-full max-w-md"
    >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-surface-900">Export Transcript</h2>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-600"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Version Selection */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-3">
              Transcript Version
            </label>
            <div className="space-y-2">
              {(['original', 'corrected', 'speaker-tagged'] as ExportVersion[]).map((version) => {
                const available = isVersionAvailable(version);
                return (
                  <div
                    key={version}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                      selectedVersion === version
                        ? 'border-primary-400 bg-primary-100'
                        : available
                        ? 'border-surface-200 hover:border-surface-200'
                        : 'border-surface-100 bg-surface-50 cursor-not-allowed'
                    }`}
                    onClick={() => available && setSelectedVersion(version)}
                  >
                    <div className="flex items-center space-x-3">
                      {getVersionIcon(version)}
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <span className={`text-sm font-medium ${available ? 'text-surface-900' : 'text-surface-400'}`}>
                            {version.charAt(0).toUpperCase() + version.slice(1).replace('-', ' ')}
                          </span>
                          {available && selectedVersion === version && (
                            <CheckCircle size={16} className="text-primary-500" />
                          )}
                          {!available && (
                            <span className="text-xs text-red-500">(Not available)</span>
                          )}
                        </div>
                        <p className={`text-xs ${available ? 'text-surface-600' : 'text-surface-400'}`}>
                          {available ? getVersionDescription(version) : getVersionUnavailableReason(version)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-2">
              Export Format
            </label>
            <select
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value as ExportFormat)}
              className="input"
            >
              <option value="docx">Word Document (.docx)</option>
              <option value="pdf">PDF (.pdf)</option>
              <option value="markdown">Markdown (.md)</option>
              <option value="txt">Plain Text (.txt)</option>
              <option value="json">JSON (.json)</option>
              <option value="srt">Subtitles (.srt)</option>
              <option value="vtt">Subtitles (.vtt)</option>
              <option value="timestamped-txt">Timestamped Text (.txt)</option>
            </select>
          </div>

          {/* Speaker filter — only meaningful for timestamped exports, which are
              built from the stored segments rather than the version text. */}
          {isTimestampedFormat && (
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-2">
                Speaker
              </label>
              <select
                value={speakerFilter}
                onChange={(e) => setSpeakerFilter(e.target.value)}
                className="input"
              >
                <option value="">All speakers</option>
                {segmentSpeakers.map((name) => (
                  <option key={name} value={name}>
                    {name} only
                  </option>
                ))}
              </select>
              <p className="text-xs text-surface-500 mt-1.5">{precisionNote(precisionFor(timestampedSegments))}</p>
            </div>
          )}

          {/* Timestamp Options — N/A for subtitle/timestamped exports, which
              always carry per-line timings from the stored segments. */}
          {!isTimestampedFormat && (
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-2">
              Timestamp Handling
            </label>
            <select
              value={timestampFormat}
              onChange={(e) => setTimestampFormat(e.target.value as TimestampFormat)}
              className="input"
            >
              <option value="preserve">Preserve timestamps as-is</option>
              <option value="remove">Remove all timestamps</option>
              <option value="external-tools">Format for external audio tools</option>
            </select>
            <p className="text-xs text-surface-500 mt-1">
              {timestampFormat === 'preserve' && 'Keep timestamps exactly as they appear in the transcript'}
              {timestampFormat === 'remove' && 'Clean transcript text without any timestamp markers'}
              {timestampFormat === 'external-tools' && 'Format timestamps for use with audio editing software'}
            </p>
          </div>
          )}

          {/* Options — metadata/analysis annotations only apply to the
              document formats; subtitle exports are cue text by definition. */}
          {selectedFormat !== 'txt' && !isTimestampedFormat && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-surface-700">
                Include Additional Data
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={includeMetadata}
                    onChange={(e) => setIncludeMetadata(e.target.checked)}
                    className="h-4 w-4 text-primary-800 focus:ring-primary-400 border-surface-200 rounded"
                  />
                  <span className="ml-2 text-sm text-surface-700">File metadata and information</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={includeAnalysis}
                    onChange={(e) => setIncludeAnalysis(e.target.checked)}
                    className="h-4 w-4 text-primary-800 focus:ring-primary-400 border-surface-200 rounded"
                  />
                  <span className="ml-2 text-sm text-surface-700">Analysis results (summary, topics, sentiment)</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-surface-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-surface-600 hover:text-surface-800"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!isVersionAvailable(selectedVersion)}
            className="flex items-center space-x-2 btn-primary px-6 py-2"
          >
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
    </Modal>
  );
};