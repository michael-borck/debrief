import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { useProjects } from '../contexts/ProjectContext';
import { Transcript, Project, SentenceSegment } from '../types';
import { formatDate, formatDuration, formatFileSize } from '../utils/helpers';
import { ArrowLeft, Star, Download, Copy, Edit, Users, MessageCircle, Search, Clock, FileText, HardDrive, Calendar, FileAudio, Tag, ListChecks, FolderOpen, Quote, Lightbulb, X } from 'lucide-react';
import { SpeakerTaggingModal } from '../components/SpeakerTaggingModal';
import { TranscriptChatModal } from '../components/TranscriptChatModal';
import { ExportModal } from '../components/ExportModal';
import { CorrectionTrigger } from '../components/CorrectionTrigger';
import { TranscriptEditor } from '../components/TranscriptEditor';
import { TimestampedTranscript } from '../components/TimestampedTranscript';
import { SentimentCard } from '../components/SentimentCard';
import { ValidationChangesCard } from '../components/ValidationChangesCard';
import { ConversationQualityCard } from '../components/ConversationQualityCard';
import { FillerWordsCard } from '../components/FillerWordsCard';
import { TalkTimeCard } from '../components/TalkTimeCard';
import { AudioPlayerBar } from '../components/AudioPlayerBar';
import { DiarisationPanel } from '../components/DiarisationPanel';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { analyzeConversation } from '../services/conversationMetricsService';
import { sentenceSegmentsService } from '../services/sentenceSegmentsService';

type TabType = 'overview' | 'transcript' | 'analysis' | 'conversations' | 'notes';

export const TranscriptDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getTranscriptById, updateTranscript } = useContext(TranscriptContext);
  const { projects, addTranscriptToProject, removeTranscriptFromProject } = useProjects();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [showSpeakerTagging, setShowSpeakerTagging] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showTranscriptEditor, setShowTranscriptEditor] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [transcriptProjects, setTranscriptProjects] = useState<Project[]>([]);
  const [pageSegments, setPageSegments] = useState<SentenceSegment[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [searchQuery, setSearchQuery] = useState('');

  // Audio playback for the Transcript tab
  const audioPlayer = useAudioPlayer();
  const [activeTranscriptSubTab, setActiveTranscriptSubTab] = useState<string>('full');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState('');

  useEffect(() => {
    loadTranscript();
  }, [id]);

  const reloadTranscriptProjects = async () => {
    if (!transcript?.id || projects.length === 0) {
      setTranscriptProjects([]);
      return;
    }
    try {
      const projectRelations = await window.electronAPI.database.all(
        `SELECT project_id FROM project_transcripts WHERE transcript_id = ?`,
        [transcript.id]
      );
      const relatedProjects = projects.filter((project) =>
        projectRelations.some((relation) => relation.project_id === project.id)
      );
      setTranscriptProjects(relatedProjects);
    } catch (error) {
      console.error('Error loading transcript projects:', error);
    }
  };

  useEffect(() => {
    reloadTranscriptProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript?.id, projects]);

  const handleAssignToProject = async (projectId: string) => {
    if (!transcript?.id || !projectId) return;
    try {
      await addTranscriptToProject(projectId, transcript.id);
      await reloadTranscriptProjects();
    } catch (error) {
      console.error('Failed to assign transcript to project:', error);
      alert('Failed to assign transcript to project. Please try again.');
    }
  };

  const handleRemoveFromProject = async (projectId: string) => {
    if (!transcript?.id || !projectId) return;
    try {
      await removeTranscriptFromProject(projectId, transcript.id);
      await reloadTranscriptProjects();
    } catch (error) {
      console.error('Failed to remove transcript from project:', error);
      alert('Failed to remove transcript from project. Please try again.');
    }
  };

  // Load sentence segments for analysis (for conversation metrics)
  useEffect(() => {
    const loadSegments = async () => {
      if (!transcript?.id) return;
      // Prefer the most enriched version available
      const version = transcript.processed_text
        ? 'speaker_tagged'
        : transcript.validated_text ? 'corrected' : 'original';
      let segs = await sentenceSegmentsService.getSegments(transcript.id, version);
      if (segs.length === 0 && version !== 'original') {
        segs = await sentenceSegmentsService.getSegments(transcript.id, 'original');
      }
      setPageSegments(segs);
    };
    loadSegments();
  }, [transcript?.id, transcript?.processed_text, transcript?.validated_text]);

  // Unload audio when transcript changes
  useEffect(() => {
    return () => {
      audioPlayer.unload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript?.id]);

  // Compute conversation metrics from text + segments
  const conversationMetrics = useMemo(() => {
    if (!transcript) return null;
    const text = transcript.processed_text || transcript.validated_text || transcript.full_text || '';
    if (!text.trim()) return null;
    return analyzeConversation(text, pageSegments.length > 0 ? pageSegments : undefined, transcript.duration);
  }, [transcript?.id, transcript?.processed_text, transcript?.validated_text, transcript?.full_text, transcript?.duration, pageSegments]);

  const loadTranscript = async () => {
    if (!id) return;
    
    try {
      const transcriptData = await getTranscriptById(id);
      setTranscript(transcriptData);
      setEditedTitle(transcriptData?.title || '');
      setEditedNotes(transcriptData?.personal_notes || '');
    } catch (error) {
      console.error('Error loading transcript:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStar = async () => {
    if (!transcript) return;
    
    const updated = await updateTranscript(transcript.id, { 
      starred: !transcript.starred 
    });
    if (updated) {
      setTranscript({ ...transcript, starred: !transcript.starred });
    }
  };

  const handleSaveTitle = async () => {
    if (!transcript) return;
    
    const updated = await updateTranscript(transcript.id, { 
      title: editedTitle 
    });
    if (updated) {
      setTranscript({ ...transcript, title: editedTitle });
      setIsEditing(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!transcript) return;
    
    const updated = await updateTranscript(transcript.id, { 
      personal_notes: editedNotes 
    });
    if (updated) {
      setTranscript({ ...transcript, personal_notes: editedNotes });
      setIsEditingNotes(false);
    }
  };

  const handleCopyTranscript = () => {
    if (transcript?.full_text) {
      navigator.clipboard.writeText(transcript.full_text);
      alert('Transcript copied to clipboard!');
    }
  };

  const handleExportTranscript = () => {
    setShowExportModal(true);
  };

  const handleCorrectionStart = () => {
    console.log('Starting transcript correction...');
  };

  const handleCorrectionComplete = (updatedTranscript: Transcript) => {
    setTranscript(updatedTranscript);
    console.log('Transcript correction completed');
  };

  const handleCorrectionError = (error: string) => {
    console.error('Correction error:', error);
    alert(`Correction failed: ${error}`);
  };

  const handleManualEdit = () => {
    if (!transcript) return;
    
    // If no corrected version exists, create one from the original
    if (!transcript.validated_text && transcript.full_text) {
      // Copy original to corrected before opening editor
      handleTranscriptSave(transcript.full_text).then(() => {
        setShowTranscriptEditor(true);
      });
    } else {
      setShowTranscriptEditor(true);
    }
  };

  const handleTranscriptSave = async (editedText: string) => {
    if (!transcript) return;

    try {
      const success = await updateTranscript(transcript.id, {
        validated_text: editedText,
        updated_at: new Date().toISOString()
      });

      if (success) {
        await loadTranscript();
        console.log('Transcript saved successfully');
      } else {
        throw new Error('Failed to save transcript');
      }
    } catch (error) {
      console.error('Error saving transcript:', error);
      alert('Failed to save transcript. Please try again.');
    }
  };

  const handleSpeakerTaggingSave = async (taggedText: string, speakers: Array<{ id: string; name: string; segments: number }>) => {
    if (!transcript) return;
    
    try {
      const success = await updateTranscript(transcript.id, {
        processed_text: taggedText,
        speakers: speakers,
        speaker_count: speakers.length
      });
      
      if (success) {
        await loadTranscript();
      }
    } catch (error) {
      console.error('Error saving speaker tags:', error);
      alert('Failed to save speaker tags. Please try again.');
    }
  };

  const getAnonymizedSpeakerName = (speaker: { id: string; name: string }) => {
    // Always show real speaker names since anonymize toggle was removed
    return speaker.name;
  };

  // Extract speaker text from transcript using enhanced pattern matching
  const extractSpeakerText = (text: string, speakerName: string): string[] => {
    if (!text) return [];
    
    console.log('Extracting speaker text for:', speakerName);
    console.log('From text (first 200 chars):', text.substring(0, 200));
    console.log('Text source type:', text === transcript?.processed_text ? 'processed_text (tagged)' : 
                                    text === transcript?.validated_text ? 'validated_text' : 'full_text (original)');
    
    // Escape special regex characters in speaker name
    const escapedName = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    console.log('Escaped speaker name:', escapedName);
    
    // Enhanced patterns to match different speaker tagging formats
    const patterns = [
      // [Speaker Name]: text (bracket with colon format)
      new RegExp(`\\[${escapedName}\\]\\s*:\\s*([^\\n]*(?:\\n(?!\\[[^\\]]+\\]\\s*:)[^\\n]*)*)`, 'gi'),
      // Speaker Name: text (simple colon format - used by manual tagging)
      new RegExp(`^${escapedName}\\s*:\\s*([^\\n]*(?:\\n(?!^[A-Za-z0-9\\s]+\\s*:)[^\\n]*)*)`, 'gim'),
      // Multi-line Speaker Name: format
      new RegExp(`${escapedName}\\s*:\\s*([^\\n]*(?:\\n(?!^[A-Za-z0-9\\s]+\\s*:)[^\\n]*)*)`, 'gi'),
      // [Speaker Name] text (bracket without colon)
      new RegExp(`\\[${escapedName}\\]\\s*([^\\n]*(?:\\n(?!\\[[^\\]]+\\])[^\\n]*)*)`, 'gi'),
      // SPEAKER NAME: text (uppercase)
      new RegExp(`^${escapedName.toUpperCase()}\\s*:\\s*([^\\n]*(?:\\n(?!^[A-Z][^:]*:)[^\\n]*)*)`, 'gim')
    ];
    
    const segments: string[] = [];
    
    patterns.forEach((pattern, idx) => {
      console.log(`Testing pattern ${idx + 1}:`, pattern.toString());
      // Reset regex lastIndex to avoid conflicts
      pattern.lastIndex = 0;
      let match;
      let matchCount = 0;
      while ((match = pattern.exec(text)) !== null) {
        matchCount++;
        const segment = match[1]?.trim();
        console.log(`Pattern ${idx + 1} match ${matchCount}:`, segment?.substring(0, 50) + '...');
        if (segment && segment.length > 10) { // Minimum segment length
          segments.push(segment);
        }
      }
      console.log(`Pattern ${idx + 1} found ${matchCount} matches`);
    });
    
    // Remove duplicates and merge very similar segments
    const uniqueSegments = segments.filter((seg, idx) => {
      // Check if this segment is substantially different from previous ones
      return !segments.slice(0, idx).some(prev => 
        prev.length > 50 && seg.length > 50 && 
        prev.substring(0, 50) === seg.substring(0, 50)
      );
    });
    
    console.log(`Total unique segments found for ${speakerName}:`, uniqueSegments.length);
    uniqueSegments.forEach((seg, idx) => {
      console.log(`Segment ${idx + 1}:`, seg.substring(0, 50) + '...');
    });
    
    return uniqueSegments;
  };

  // Get speaker colors consistently
  const getSpeakerColor = (index: number) => {
    const colors = [
      { bg: 'bg-primary-100', border: 'border-primary-200', text: 'text-primary-900', accent: 'bg-primary-500' },
      { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-900', accent: 'bg-green-500' },
      { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-900', accent: 'bg-yellow-500' },
      { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', accent: 'bg-purple-500' },
      { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-900', accent: 'bg-pink-500' },
      { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-900', accent: 'bg-indigo-500' },
    ];
    return colors[index % colors.length];
  };

  const tabs = [
    { id: 'overview' as const, label: 'Overview', name: 'Overview' },
    { id: 'transcript' as const, label: 'Transcript', name: 'Transcript' },
    { id: 'analysis' as const, label: 'Analysis', name: 'Analysis' },
    { id: 'conversations' as const, label: 'Conversations', name: 'Conversations' },
    { id: 'notes' as const, label: 'Notes', name: 'Notes' }
  ];

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-surface-600">Loading transcript...</p>
        </div>
      </div>
    );
  }

  if (!transcript) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-center py-12">
          <p className="text-surface-600">Transcript not found.</p>
          <button 
            onClick={() => navigate('/library')}
            className="mt-4 text-primary-800 hover:text-primary-900"
          >
            Return to Library
          </button>
        </div>
      </div>
    );
  }

  const renderOverviewTab = () => (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Duration" value={formatDuration(transcript.duration)} color="text-primary-500" />
        <StatCard icon={FileText} label="Word Count" value={(transcript.full_text?.split(/\s+/).filter(Boolean).length || 0).toString()} color="text-success" />
        <StatCard icon={Users} label="Speakers" value={(transcript.speaker_count || 1).toString()} color="text-accent-500" />
        <StatCard icon={HardDrive} label="File Size" value={formatFileSize(transcript.file_size)} color="text-warning" />
      </div>

      {/* Summary Card */}
      {transcript.summary && (
        <div className="card-static p-6">
          <h3 className="section-title flex items-center gap-2 mb-3">
            <Lightbulb size={18} className="text-accent-500" />
            AI Summary
          </h3>
          <p className="text-surface-700 leading-relaxed">{transcript.summary}</p>
        </div>
      )}

      {/* Sentiment + Conversation Quality side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(transcript.sentiment_overall || (transcript.emotions && Object.keys(transcript.emotions).length > 0)) && (
          <SentimentCard
            sentiment={transcript.sentiment_overall}
            score={transcript.sentiment_score}
            emotions={transcript.emotions}
            variant="compact"
          />
        )}
        {conversationMetrics && (
          <ConversationQualityCard
            quality={conversationMetrics.quality}
            insights={{
              strengths: conversationMetrics.insights.strengths.slice(0, 2),
              observations: conversationMetrics.insights.observations.slice(0, 2),
            }}
          />
        )}
      </div>

      {/* AI Corrections (collapsed by default with summary) */}
      {transcript.validation_changes && transcript.validation_changes.length > 0 && (
        <ValidationChangesCard changes={transcript.validation_changes} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Key Topics */}
        {transcript.key_topics && transcript.key_topics.length > 0 && (
          <div className="card-static p-6">
            <h3 className="section-title flex items-center gap-2 mb-3">
              <Tag size={16} className="text-primary-500" />
              Key Topics
            </h3>
            <div className="flex flex-wrap gap-2">
              {transcript.key_topics.slice(0, 8).map((topic, idx) => (
                <span key={idx} className="bg-primary-100 text-primary-800 px-3 py-1 rounded-full text-xs font-medium">
                  {topic}
                </span>
              ))}
              {transcript.key_topics.length > 8 && (
                <span className="text-xs text-surface-500 self-center">+{transcript.key_topics.length - 8} more</span>
              )}
            </div>
          </div>
        )}

        {/* Action Items */}
        {transcript.action_items && transcript.action_items.length > 0 && (
          <div className="card-static p-6">
            <h3 className="section-title flex items-center gap-2 mb-3">
              <ListChecks size={16} className="text-accent-500" />
              Action Items
            </h3>
            <div className="space-y-2">
              {transcript.action_items.slice(0, 5).map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-accent-500 rounded-full mt-2 flex-shrink-0"></div>
                  <span className="text-surface-700 text-sm">{item}</span>
                </div>
              ))}
              {transcript.action_items.length > 5 && (
                <p className="text-xs text-surface-500 ml-3.5">+{transcript.action_items.length - 5} more</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Projects — always rendered so users can assign after the fact */}
      {(() => {
        const linkedIds = new Set(transcriptProjects.map((p) => p.id));
        const availableProjects = projects.filter((p) => !linkedIds.has(p.id));
        return (
          <div className="card-static p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="section-title flex items-center gap-2">
                <FolderOpen size={16} className="text-primary-500" />
                Projects
              </h3>
              {availableProjects.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAssignToProject(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="text-xs px-3 py-1.5 border border-surface-200 rounded-lg bg-white hover:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  <option value="">+ Assign to project...</option>
                  {availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {transcriptProjects.length === 0 ? (
              <div className="text-center py-6 text-surface-400 text-sm">
                <FolderOpen size={28} className="mx-auto mb-2 text-surface-300" strokeWidth={1.5} />
                {projects.length === 0
                  ? 'No projects yet. Create one from the Projects page.'
                  : 'Not assigned to any project yet.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {transcriptProjects.map((project) => (
                  <div
                    key={project.id}
                    className="group flex items-center gap-3 p-3 border border-surface-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-colors"
                  >
                    <button
                      onClick={() => navigate(`/project/${project.id}`)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <FolderOpen size={16} className="text-primary-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-surface-900 truncate text-sm">{project.name}</h4>
                        {project.description && (
                          <p className="text-xs text-surface-500 truncate">{project.description}</p>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={() => handleRemoveFromProject(project.id)}
                      className="text-surface-300 hover:text-red-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                      title="Remove from this project"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );

  // Local stat card helper
  const StatCard: React.FC<{ icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string; color: string }> = ({ icon: Icon, label, value, color }) => (
    <div className="card-static p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-surface-500 mb-1">{label}</p>
          <p className="text-xl font-display font-bold text-surface-800 truncate">{value}</p>
        </div>
        <Icon size={18} className={`${color} flex-shrink-0 ml-2`} />
      </div>
    </div>
  );

  const renderTranscriptTab = () => {
    const currentText = transcript.validated_text || transcript.full_text;
    const speakers = transcript.speakers || [];
    
    // For speaker extraction, prioritize processed_text (contains speaker tags)
    // If not available, use original full_text (validated text might not have speaker tags)
    const textForSpeakerExtraction = transcript.processed_text || transcript.full_text;
    
    // Create sub-tabs: Include original and corrected versions when available
    const transcriptSubTabs = [
      {
        id: 'original',
        label: 'Original',
        name: 'Original',
        speaker: null,
        color: null,
        text: transcript.full_text
      },
      ...(transcript.validated_text ? [{
        id: 'corrected',
        label: 'Corrected',
        name: 'Corrected',
        speaker: null,
        color: null,
        text: transcript.validated_text
      }] : []),
      ...(transcript.processed_text ? [{
        id: 'speaker-tagged',
        label: 'Speaker-Tagged',
        name: 'Speaker-Tagged',
        speaker: null,
        color: null,
        text: transcript.processed_text
      }] : []),
      ...speakers.map((speaker, idx) => ({
        id: `speaker-${idx}`,
        label: getAnonymizedSpeakerName(speaker),
        name: getAnonymizedSpeakerName(speaker),
        speaker,
        color: getSpeakerColor(idx)
      }))
    ];

    // Set default active tab to corrected if available, otherwise original
    if (!activeTranscriptSubTab || !transcriptSubTabs.find(tab => tab.id === activeTranscriptSubTab)) {
      const defaultTab = transcript.validated_text ? 'corrected' : 'original';
      setActiveTranscriptSubTab(defaultTab);
    }

    return (
      <div className="space-y-6">
        {/* Audio playback */}
        {transcript.file_path && (
          <AudioPlayerBar
            player={audioPlayer}
            filePath={transcript.file_path}
            fileName={transcript.filename}
          />
        )}

        {/* In-transcript search */}
        <div className="card-static p-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              type="text"
              placeholder="Find in this transcript..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-9 pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-700 transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Correction Trigger */}
        <CorrectionTrigger
          transcript={transcript}
          onCorrectionStart={handleCorrectionStart}
          onCorrectionComplete={handleCorrectionComplete}
          onError={handleCorrectionError}
        />

        {/* Manual Edit Controls */}
        {(transcript.validated_text || transcript.full_text) && (
          <div className="bg-white rounded-lg border border-surface-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-surface-900">Manual Editing & Display</h3>
                <p className="text-xs text-surface-600">
                  Edit the {transcript.validated_text ? 'corrected' : 'original'} transcript manually or adjust display options
                </p>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setShowTimestamps(!showTimestamps)}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                    showTimestamps 
                      ? 'bg-primary-100 text-primary-700' 
                      : 'bg-surface-100 text-surface-700 hover:bg-surface-200'
                  }`}
                >
                  🕐 Timestamps
                </button>
                <button
                  onClick={() => handleManualEdit()}
                  className="px-4 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                >
                  Edit Transcript
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Corrections shown on Overview tab now */}

        {/* Transcript Sub-tabs */}
        {transcriptSubTabs.length > 1 && (
          <div className="bg-white rounded-lg border border-surface-200">
            {/* Sub-tab Navigation */}
            <div className="border-b border-surface-200 px-4">
              <div className="flex space-x-6 overflow-x-auto">
                {transcriptSubTabs.map(subTab => (
                  <button
                    key={subTab.id}
                    onClick={() => setActiveTranscriptSubTab(subTab.id)}
                    className={`
                      py-3 text-sm font-medium transition-colors relative whitespace-nowrap
                      ${activeTranscriptSubTab === subTab.id 
                        ? 'text-primary-800' 
                        : 'text-surface-600 hover:text-surface-900'
                      }
                    `}
                  >
                    {subTab.label}
                    {activeTranscriptSubTab === subTab.id && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-800" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Sub-tab Content */}
            <div className="p-6">
              {['original', 'corrected', 'speaker-tagged'].includes(activeTranscriptSubTab) ? (
                // Transcript version view
                (() => {
                  const selectedTab = transcriptSubTabs.find(tab => tab.id === activeTranscriptSubTab);
                  const tabText = selectedTab && 'text' in selectedTab ? selectedTab.text : undefined;
                  
                  // Map tab IDs to version names
                  const getVersionFromTabId = (tabId: string): 'original' | 'corrected' | 'speaker_tagged' => {
                    switch (tabId) {
                      case 'corrected': return 'corrected';
                      case 'speaker-tagged': return 'speaker_tagged';
                      default: return 'original';
                    }
                  };

                  return tabText ? (
                    <TimestampedTranscript
                      transcript={tabText}
                      transcriptId={transcript.id}
                      version={getVersionFromTabId(activeTranscriptSubTab)}
                      showTimestamps={showTimestamps}
                      editable={false}
                      searchQuery={searchQuery}
                      currentPlaybackTime={audioPlayer.loadState === 'ready' ? audioPlayer.currentTime : undefined}
                      onSeek={audioPlayer.loadState === 'ready' ? audioPlayer.seek : undefined}
                    />
                  ) : (
                    <div className="text-center py-8 text-surface-500">
                      <p>No transcript available for this version.</p>
                      {transcript.status === 'processing' && (
                        <p className="mt-2">Transcript is still being processed...</p>
                      )}
                      {transcript.status === 'error' && (
                        <p className="mt-2 text-red-600">There was an error processing this file.</p>
                      )}
                    </div>
                  );
                })()
              ) : (
                // Individual speaker view
                (() => {
                  const selectedSubTab = transcriptSubTabs.find(tab => tab.id === activeTranscriptSubTab);
                  if (!selectedSubTab?.speaker || !selectedSubTab?.color || !currentText) {
                    return (
                      <div className="text-center py-8 text-surface-500">
                        <p>No text found for this speaker.</p>
                      </div>
                    );
                  }

                  const speakerSegments = extractSpeakerText(textForSpeakerExtraction || '', selectedSubTab.speaker.name);
                  const color = selectedSubTab.color;

                  return (
                    <div className="space-y-6">
                      {/* Speaker Stats */}
                      <div className={`${color.bg} ${color.border} border rounded-lg p-4`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className={`w-4 h-4 rounded-full ${color.accent}`}></div>
                            <h4 className={`font-semibold ${color.text}`}>
                              {selectedSubTab.name}
                            </h4>
                          </div>
                          <div className={`text-sm ${color.text}`}>
                            {speakerSegments.length} segments • {speakerSegments.join(' ').split(' ').length} words
                          </div>
                        </div>
                      </div>

                      {/* Speaker Segments */}
                      {speakerSegments.length > 0 ? (
                        <div className="space-y-4">
                          {speakerSegments.map((segment, idx) => (
                            <div key={idx} className={`${color.bg} ${color.border} border rounded-lg p-4`}>
                              <div className="flex items-start space-x-3">
                                <div className={`w-2 h-2 rounded-full ${color.accent} mt-2 flex-shrink-0`}></div>
                                <div className="flex-1">
                                  <div className={`text-sm ${color.text} leading-relaxed`}>
                                    {segment}
                                  </div>
                                  <div className={`text-xs ${color.text} opacity-75 mt-2`}>
                                    Segment {idx + 1} • {segment.split(' ').length} words
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`${color.bg} ${color.border} border rounded-lg p-8 text-center`}>
                          <div className={`${color.text}`}>
                            <p className="text-lg font-medium mb-2">No segments found</p>
                            <p className="text-sm opacity-75">
                              This speaker may not have clearly marked dialogue in the transcript, 
                              or the transcript may need speaker tagging.
                            </p>
                            <button
                              onClick={() => setShowSpeakerTagging(true)}
                              className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                            >
                              Add Speaker Tags
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        )}

        {/* Fallback: Single transcript view if no speakers */}
        {transcriptSubTabs.length <= 1 && (
          <div className="bg-white rounded-lg border border-surface-200 p-6">
            {currentText ? (
              <TimestampedTranscript
                transcript={currentText}
                transcriptId={transcript.id}
                version={transcript.validated_text ? 'corrected' : 'original'}
                showTimestamps={showTimestamps}
                editable={false}
                searchQuery={searchQuery}
                currentPlaybackTime={audioPlayer.loadState === 'ready' ? audioPlayer.currentTime : undefined}
                onSeek={audioPlayer.loadState === 'ready' ? audioPlayer.seek : undefined}
              />
            ) : (
              <div className="text-center py-8 text-surface-500">
                <p>No transcript available.</p>
                {transcript.status === 'processing' && (
                  <p className="mt-2">Transcript is still being processed...</p>
                )}
                {transcript.status === 'error' && (
                  <p className="mt-2 text-red-600">There was an error processing this file.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderAnalysisTab = () => (
    <div className="space-y-6">
      {/* Conversation Quality (rubric) */}
      {conversationMetrics && (
        <ConversationQualityCard
          quality={conversationMetrics.quality}
          insights={conversationMetrics.insights}
        />
      )}

      {/* Talk-time + Filler words side by side */}
      {conversationMetrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {conversationMetrics.talkTime && conversationMetrics.talkTime.speakers.length > 1 && (
            <TalkTimeCard talkTime={conversationMetrics.talkTime} />
          )}
          <FillerWordsCard
            fillerWords={conversationMetrics.fillerWords}
            totalWords={conversationMetrics.wordCount}
          />
        </div>
      )}

      {/* Sentiment & Emotions (full) */}
      <SentimentCard
        sentiment={transcript.sentiment_overall}
        score={transcript.sentiment_score}
        emotions={transcript.emotions}
        variant="full"
      />

      {/* Diarisation tuning — re-run speaker detection with a different
          cluster threshold without re-running whisper. */}
      <DiarisationPanel
        transcriptId={transcript.id}
        filePath={transcript.file_path}
        speakerCount={transcript.speaker_count || (transcript.speakers?.length ?? 1)}
        onRerunComplete={loadTranscript}
      />

      {/* Speaker Analysis */}
      {transcript.speakers && transcript.speakers.length > 0 && (
        <div className="bg-white rounded-lg border border-surface-200 p-6">
          <h3 className="section-title flex items-center gap-2 mb-4"><Users size={16} className="text-primary-500" />Speaker Analysis</h3>
          
          <div className="space-y-3">
            {transcript.speakers.map((speaker, idx) => {
              const totalSegments = transcript.speakers?.reduce((sum, s) => sum + (s?.segments || 0), 0) ?? 0;
              const percentage = totalSegments > 0 ? (speaker.segments / totalSegments) * 100 : 0;
              const colors = ['bg-primary-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500'];
              const color = colors[idx % colors.length];
              
              return (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className={`w-3 h-3 rounded-full ${color}`}></div>
                      <span className="text-sm font-medium text-surface-900">
                        {getAnonymizedSpeakerName(speaker)}
                      </span>
                    </div>
                    <div className="text-sm text-surface-600">
                      {speaker.segments} segments ({Math.round(percentage)}%)
                    </div>
                  </div>
                  <div className="w-full bg-surface-200 rounded-full h-3">
                    <div 
                      className={`h-3 rounded-full ${color} transition-all duration-500`}
                      style={{ width: `${Math.max(percentage, 3)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Notable Quotes */}
      {transcript.notable_quotes && transcript.notable_quotes.length > 0 && (
        <div className="bg-white rounded-lg border border-surface-200 p-6">
          <h3 className="section-title flex items-center gap-2 mb-4"><Quote size={16} className="text-accent-500" />Notable Quotes</h3>
          <div className="space-y-4">
            {transcript.notable_quotes.slice(0, 5).map((quote, idx) => (
              <div key={idx} className="border-l-4 border-primary-400 pl-4 py-2 bg-primary-100 rounded-r-lg">
                <blockquote className="text-surface-700 italic">"{quote.text}"</blockquote>
                <div className="flex items-center justify-between mt-2">
                  {quote.speaker && (
                    <span className="text-xs text-surface-500">— {quote.speaker}</span>
                  )}
                  <div className="flex items-center space-x-1">
                    <span className="text-xs text-surface-500">Relevance:</span>
                    <div className="w-12 bg-surface-200 rounded-full h-1">
                      <div 
                        className="bg-primary-500 h-1 rounded-full" 
                        style={{ width: `${Math.round(quote.relevance * 100)}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-surface-500">{Math.round(quote.relevance * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Research Themes */}
      {transcript.research_themes && transcript.research_themes.length > 0 && (
        <div className="bg-white rounded-lg border border-surface-200 p-6">
          <h3 className="section-title flex items-center gap-2 mb-4"><Tag size={16} className="text-primary-500" />Research Themes</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {transcript.research_themes.map((theme, idx) => (
              <div key={idx} className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-purple-900">{theme.theme}</h4>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                    {Math.round(theme.confidence * 100)}%
                  </span>
                </div>
                {theme.examples && theme.examples.length > 0 && (
                  <div className="text-xs text-purple-700">
                    Examples: {theme.examples.slice(0, 2).join(', ')}
                    {theme.examples.length > 2 && '...'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Q&A Pairs */}
      {transcript.qa_pairs && transcript.qa_pairs.length > 0 && (
        <div className="bg-white rounded-lg border border-surface-200 p-6">
          <h3 className="text-lg font-semibold text-surface-900 mb-4">❓ Question-Answer Pairs</h3>
          <div className="space-y-4">
            {transcript.qa_pairs.slice(0, 3).map((qa, idx) => (
              <div key={idx} className="border border-surface-200 rounded-lg p-4">
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-600 uppercase tracking-wide">Question</span>
                  <p className="text-sm text-surface-800 mt-1">{qa.question}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-primary-800 uppercase tracking-wide">Answer</span>
                  <p className="text-sm text-surface-700 mt-1">{qa.answer}</p>
                </div>
                {qa.speaker && (
                  <div className="mt-2 text-xs text-surface-500">— {qa.speaker}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Concept Frequency */}
      {transcript.concept_frequency && Object.keys(transcript.concept_frequency).length > 0 && (
        <div className="bg-white rounded-lg border border-surface-200 p-6">
          <h3 className="section-title flex items-center gap-2 mb-4"><FileText size={16} className="text-primary-500" />Concept Frequency</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(transcript.concept_frequency)
              .sort(([,a], [,b]) => b.count - a.count)
              .slice(0, 9)
              .map(([concept, data]) => (
                <div key={concept} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-orange-900 capitalize">{concept}</span>
                    <span className="text-lg font-display text-orange-600">{data.count}</span>
                  </div>
                  <div className="text-xs text-orange-700">
                    {data.contexts && data.contexts.length > 0 && data.contexts[0]}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderConversationsTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-surface-200 p-6">
        <div className="text-center py-8">
          <MessageCircle size={48} className="text-surface-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-surface-900 mb-2">Chat History</h3>
          <p className="text-surface-600 mb-4">
            Chat conversations with this transcript will appear here.
          </p>
          <button
            onClick={() => setShowChatModal(true)}
            className="btn-primary"
          >
            Start New Conversation
          </button>
        </div>
      </div>
    </div>
  );

  const renderNotesTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-surface-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-surface-900">📓 Personal Notes</h3>
          {!isEditingNotes ? (
            <button
              onClick={() => {
                setIsEditingNotes(true);
                setEditedNotes(transcript.personal_notes || '');
              }}
              className="flex items-center space-x-1 px-4 py-2 text-sm text-surface-600 hover:text-surface-900 border border-surface-200 rounded-lg hover:bg-surface-50"
            >
              <Edit size={16} />
              <span>Edit Notes</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleSaveNotes}
                className="btn-primary"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setIsEditingNotes(false);
                  setEditedNotes(transcript.personal_notes || '');
                }}
                className="px-4 py-2 text-sm border border-surface-200 rounded-lg hover:bg-surface-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        
        {isEditingNotes ? (
          <textarea
            value={editedNotes}
            onChange={(e) => setEditedNotes(e.target.value)}
            className="w-full h-96 p-4 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y font-mono text-sm"
            placeholder="Add your personal notes about this transcript here...

💡 Tips:
- Capture key insights and observations
- Note connections to other interviews or research
- Record methodological observations
- Add follow-up questions or action items
- Include timestamps for specific moments (e.g., [12:34])
- Use markdown formatting for better organization"
          />
        ) : (
          <div className="prose max-w-none">
            {transcript.personal_notes ? (
              <div className="text-surface-700 whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {transcript.personal_notes}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-surface-500 mb-4">
                  No personal notes added yet.
                </p>
                <button
                  onClick={() => {
                    setIsEditingNotes(true);
                    setEditedNotes('');
                  }}
                  className="btn-primary"
                >
                  Add Notes
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Note Statistics */}
      {transcript.personal_notes && (
        <div className="bg-surface-50 rounded-lg border border-surface-200 p-4">
          <div className="flex items-center justify-between text-sm text-surface-600">
            <span>📅 Last updated: {formatDate(transcript.updated_at)}</span>
            <span>📦 {transcript.personal_notes.length} characters</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/library')}
          className="flex items-center space-x-2 text-surface-600 hover:text-surface-900"
        >
          <ArrowLeft size={20} />
          <span>Back to Library</span>
        </button>
        
        {/* Quick Actions Toolbar */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleToggleStar}
            className={`${transcript.starred ? 'text-yellow-500' : 'text-surface-300'} hover:text-yellow-500 transition-colors`}
          >
            <Star size={20} fill={transcript.starred ? 'currentColor' : 'none'} />
          </button>
          
          <button
            onClick={() => setShowChatModal(true)}
            className="flex items-center space-x-1 px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg"
            disabled={transcript.is_archived}
          >
            <MessageCircle size={16} />
            <span>Chat</span>
          </button>
          
          <button
            onClick={handleCopyTranscript}
            className="flex items-center space-x-1 px-3 py-2 text-sm text-surface-600 hover:text-surface-900 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <Copy size={16} />
            <span>Copy</span>
          </button>
          
          <button
            onClick={() => setShowSpeakerTagging(true)}
            className="flex items-center space-x-1 px-3 py-2 text-sm text-purple-600 hover:text-purple-700 border border-purple-300 rounded-lg hover:bg-purple-50"
          >
            <Users size={16} />
            <span>Speakers</span>
          </button>
          
          <button
            onClick={handleExportTranscript}
            className="flex items-center space-x-1 px-3 py-2 text-sm text-white bg-primary-800 hover:bg-primary-900 rounded-lg"
          >
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Title Section */}
      <div className="bg-white rounded-lg shadow-card border border-surface-200 p-6 mb-6">
        <div className="flex items-center justify-between">
          {isEditing ? (
            <div className="flex-1 flex items-center space-x-3">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="flex-1 text-xl font-semibold border border-surface-200 rounded px-3 py-2"
                autoFocus
              />
              <button
                onClick={handleSaveTitle}
                className="btn-primary px-3 py-2"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditedTitle(transcript.title);
                }}
                className="px-3 py-2 text-sm border border-surface-200 rounded hover:bg-surface-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-3 flex-1">
              <h1 className="page-title">{transcript.title}</h1>
              <button
                onClick={() => setIsEditing(true)}
                className="text-surface-400 hover:text-surface-600 transition-colors"
              >
                <Edit size={16} />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-5 text-xs text-surface-500 mt-4">
          <span className="flex items-center gap-1.5"><Calendar size={12} />{formatDate(transcript.created_at)}</span>
          <span className="flex items-center gap-1.5"><Clock size={12} />{formatDuration(transcript.duration)}</span>
          <span className="flex items-center gap-1.5"><HardDrive size={12} />{formatFileSize(transcript.file_size)}</span>
          <span className="flex items-center gap-1.5"><FileAudio size={12} />{transcript.file_path?.split('/').pop() || transcript.filename}</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-surface-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              pb-3 px-4 text-sm font-medium transition-colors relative
              ${activeTab === tab.id
                ? 'text-primary-800'
                : 'text-surface-500 hover:text-surface-800'
              }
            `}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-800" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'transcript' && renderTranscriptTab()}
        {activeTab === 'analysis' && renderAnalysisTab()}
        {activeTab === 'conversations' && renderConversationsTab()}
        {activeTab === 'notes' && renderNotesTab()}
      </div>

      {/* Modals */}
      <SpeakerTaggingModal
        isOpen={showSpeakerTagging}
        onClose={() => setShowSpeakerTagging(false)}
        transcriptText={transcript.processed_text || transcript.full_text || ''}
        existingSpeakers={transcript.speakers}
        onSave={handleSpeakerTaggingSave}
      />

      <TranscriptChatModal
        transcript={transcript}
        isOpen={showChatModal}
        onClose={() => setShowChatModal(false)}
      />

      <ExportModal
        transcript={transcript}
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />

      <TranscriptEditor
        transcript={transcript}
        isOpen={showTranscriptEditor}
        onClose={() => setShowTranscriptEditor(false)}
        onSave={handleTranscriptSave}
      />
    </div>
  );
};