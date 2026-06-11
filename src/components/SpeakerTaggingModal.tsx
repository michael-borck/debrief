import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import { X, Wand2, Save, Plus, Trash2, Sparkles, Check, Loader2 } from 'lucide-react';
import {
  suggestSpeakerImprovements,
  SpeakerLabelSuggestion,
  SpeakerMergeSuggestion,
} from '../services/speakerLabelService';

interface Speaker {
  id: string;
  name: string;
  color: string;
}

interface TextSegment {
  id: number;
  text: string;
  speaker?: string;
  isManuallyTagged?: boolean;
  startIndex: number;
  endIndex: number;
}

interface SpeakerTaggingModalProps {
  isOpen: boolean;
  onClose: () => void;
  transcriptText: string;
  existingSpeakers?: Array<{ id: string; name: string; segments: number }>;
  onSave: (taggedText: string, speakers: Array<{ id: string; name: string; segments: number }>) => void;
}

const SPEAKER_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'
];

export const SpeakerTaggingModal: React.FC<SpeakerTaggingModalProps> = ({
  isOpen,
  onClose,
  transcriptText,
  existingSpeakers = [],
  onSave
}) => {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [segments, setSegments] = useState<TextSegment[]>([]);
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // AI Correction state — separate from the "Apply AI Suggestions" feature.
  // This one asks the AI to suggest better labels + merge candidates based on
  // the current diarised speakers and their actual text content.
  const [isCorrectingWithAI, setIsCorrectingWithAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [labelSuggestions, setLabelSuggestions] = useState<SpeakerLabelSuggestion[]>([]);
  const [mergeSuggestions, setMergeSuggestions] = useState<SpeakerMergeSuggestion[]>([]);
  const [acceptedLabels, setAcceptedLabels] = useState<Set<string>>(new Set());
  const [acceptedMerges, setAcceptedMerges] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      // Initialize speakers
      if (existingSpeakers.length > 0) {
        setSpeakers(existingSpeakers.map((s, i) => ({
          id: s.id,
          name: s.name,
          color: SPEAKER_COLORS[i % SPEAKER_COLORS.length]
        })));
      } else {
        setSpeakers([
          { id: 'speaker1', name: 'Interviewer', color: SPEAKER_COLORS[0] },
          { id: 'speaker2', name: 'Interviewee', color: SPEAKER_COLORS[1] }
        ]);
      }

      // Smart text segmentation - sentence-based
      const smartSegments = createSmartSegments(transcriptText, speakers);
      setSegments(smartSegments);
      setSelectedSpeaker(speakers[0]?.id || 'speaker1');
    }
  }, [isOpen, transcriptText, existingSpeakers]);

  const createSmartSegments = (text: string, availableSpeakers: Speaker[]): TextSegment[] => {
    if (!text.trim()) return [];
    
    const segments: TextSegment[] = [];
    let currentIndex = 0;
    
    // Check if text already has speaker tags like "[Interviewer]: text"
    const hasExistingTags = /\[([^\]]+)\]:\s*/.test(text);
    
    if (hasExistingTags) {
      // Parse existing speaker-tagged text
      const lines = text.split(/\n+/).filter(line => line.trim());
      
      lines.forEach(line => {
        const speakerMatch = line.match(/^\[([^\]]+)\]:\s*(.*)$/);
        if (speakerMatch) {
          const speakerName = speakerMatch[1];
          const content = speakerMatch[2].trim();
          
          // Find matching speaker
          const speaker = availableSpeakers.find(s => s.name === speakerName);
          
          if (content) {
            // Split content into sentences
            const contentSentences = content.split(/([.!?]+)/).filter(s => s.trim());
            
            for (let i = 0; i < contentSentences.length; i += 2) {
              const sentence = contentSentences[i] || '';
              const punctuation = contentSentences[i + 1] || '';
              const fullSentence = (sentence + (punctuation || '')).trim();
              
              if (fullSentence.length > 0) {
                segments.push({
                  id: segments.length,
                  text: fullSentence,
                  speaker: speaker?.id,
                  isManuallyTagged: true, // Mark as manually tagged since it was previously saved
                  startIndex: currentIndex,
                  endIndex: currentIndex + fullSentence.length
                });
                
                currentIndex += fullSentence.length + 1;
              }
            }
          }
        } else if (line.trim()) {
          // Line without speaker tag
          segments.push({
            id: segments.length,
            text: line.trim(),
            speaker: undefined,
            isManuallyTagged: false,
            startIndex: currentIndex,
            endIndex: currentIndex + line.length
          });
          currentIndex += line.length + 1;
        }
      });
    } else {
      // Split into individual sentences for precise tagging
      const sentences = text.split(/([.!?]+)/).filter(s => s.trim());
      
      for (let i = 0; i < sentences.length; i += 2) {
        const sentence = sentences[i] || '';
        const punctuation = sentences[i + 1] || '';
        const fullSentence = (sentence + (punctuation || '')).trim();
        
        if (fullSentence.length > 0) {
          segments.push({
            id: segments.length,
            text: fullSentence,
            speaker: undefined,
            isManuallyTagged: false,
            startIndex: currentIndex,
            endIndex: currentIndex + fullSentence.length
          });
          
          currentIndex += fullSentence.length + 1; // +1 for space
        }
      }
    }
    
    // If no sentences found (no punctuation), split by line breaks or create chunks
    if (segments.length === 0) {
      const lines = text.split(/\n+/).filter(line => line.trim());
      
      lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.length > 0) {
          // Split long lines into smaller chunks at natural breaks
          const chunks = splitLineIntoChunks(trimmedLine);
          
          chunks.forEach(chunk => {
            segments.push({
              id: segments.length,
              text: chunk,
              speaker: undefined,
              isManuallyTagged: false,
              startIndex: currentIndex,
              endIndex: currentIndex + chunk.length
            });
            currentIndex += chunk.length + 1;
          });
        }
      });
    }
    
    return segments;
  };

  const splitLineIntoChunks = (line: string): string[] => {
    // For very long lines without punctuation, split at natural conversation breaks
    const maxChunkLength = 100;
    
    if (line.length <= maxChunkLength) {
      return [line];
    }
    
    const chunks: string[] = [];
    const words = line.split(' ');
    let currentChunk = '';
    
    for (const word of words) {
      const testChunk = currentChunk ? `${currentChunk} ${word}` : word;
      
      if (testChunk.length > maxChunkLength && currentChunk) {
        // Look for conversation markers to split at
        const markers = ['So', 'Well', 'Actually', 'But', 'And', 'Now', 'Then', 'Also', 'Yes', 'No', 'Okay', 'Right'];
        const endsWithMarker = markers.some(marker => 
          currentChunk.toLowerCase().endsWith(marker.toLowerCase())
        );
        
        if (endsWithMarker || currentChunk.length > 30) {
          chunks.push(currentChunk.trim());
          currentChunk = word;
        } else {
          currentChunk = testChunk;
        }
      } else {
        currentChunk = testChunk;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  };

  const addSpeaker = () => {
    if (newSpeakerName.trim()) {
      const newSpeaker: Speaker = {
        id: `speaker${speakers.length + 1}`,
        name: newSpeakerName.trim(),
        color: SPEAKER_COLORS[speakers.length % SPEAKER_COLORS.length]
      };
      setSpeakers([...speakers, newSpeaker]);
      setNewSpeakerName('');
      setSelectedSpeaker(newSpeaker.id);
    }
  };

  const removeSpeaker = (speakerId: string) => {
    if (speakers.length > 2) {
      setSpeakers(speakers.filter(s => s.id !== speakerId));
      // Clear assignments for removed speaker
      setSegments(segments.map(seg => 
        seg.speaker === speakerId ? { ...seg, speaker: undefined, isManuallyTagged: false } : seg
      ));
      // Update selected speaker if needed
      if (selectedSpeaker === speakerId) {
        setSelectedSpeaker(speakers.find(s => s.id !== speakerId)?.id || speakers[0]?.id);
      }
    }
  };

  const assignSpeaker = (segmentId: number) => {
    setSegments(segments.map(seg => 
      seg.id === segmentId 
        ? { ...seg, speaker: selectedSpeaker, isManuallyTagged: true }
        : seg
    ));
  };

  const clearSpeaker = (segmentId: number) => {
    setSegments(segments.map(seg => 
      seg.id === segmentId 
        ? { ...seg, speaker: undefined, isManuallyTagged: false }
        : seg
    ));
  };

  const applyAISuggestions = async () => {
    setIsProcessing(true);
    
    try {
      // Get manually tagged segments
      const taggedSegments = segments.filter(s => s.isManuallyTagged && s.speaker);
      
      if (taggedSegments.length < 2) {
        alert('Please manually tag at least 2 segments to help the AI learn the pattern.');
        setIsProcessing(false);
        return;
      }

      // Build context for AI
      const taggedExamples = taggedSegments.map(seg => {
        const speaker = speakers.find(s => s.id === seg.speaker);
        return `${speaker?.name}: "${seg.text}"`;
      }).join('\n\n');

      const untaggedSegments = segments.filter(s => !s.speaker);
      
      if (untaggedSegments.length === 0) {
        alert('All segments are already tagged!');
        setIsProcessing(false);
        return;
      }

      const speakerNames = speakers.map(s => s.name).join(', ');
      const aiPrompt = `You are helping tag speakers in a conversation transcript. Based on these manually tagged examples, identify which speaker is most likely speaking in each untagged segment.

Available speakers: ${speakerNames}

Tagged examples:
${taggedExamples}

For each segment below, respond with ONLY the speaker name (exactly as listed above):

${untaggedSegments.map(s => `Segment ${s.id}: "${s.text}"`).join('\n\n')}

Response format (one line per segment):
Segment 0: Speaker Name
Segment 1: Speaker Name
etc.`;

      logger.log('AI Prompt:', aiPrompt);

      // Call the unified Completion seam (provider/key/model resolved in main).
      const result = await window.electronAPI.ai.complete({
        prompt: aiPrompt,
        expects: 'text'
      });

      logger.log('AI Result:', result);

      if (!result.ok) {
        throw new Error(`AI service error: ${result.error}`);
      }

      if (result.text) {
        // Parse AI response
        const lines = result.text.split('\n');
        const updatedSegments = [...segments];
        
        lines.forEach((line: string) => {
          const match = line.match(/Segment (\d+):\s*(.+)/);
          if (match) {
            const segmentId = parseInt(match[1], 10);
            const speakerName = match[2].trim();
            const speaker = speakers.find(s => s.name === speakerName);
            
            if (speaker) {
              const segmentIndex = updatedSegments.findIndex(s => s.id === segmentId);
              if (segmentIndex !== -1 && !updatedSegments[segmentIndex].speaker) {
                updatedSegments[segmentIndex] = {
                  ...updatedSegments[segmentIndex],
                  speaker: speaker.id,
                  isManuallyTagged: false
                };
              }
            }
          }
        });
        
        setSegments(updatedSegments);
      }
    } catch (error) {
      logger.error('Error applying AI suggestions:', error);
      alert(`Failed to apply AI suggestions: ${error instanceof Error ? error.message : 'Unknown error'}. Check console for details.`);
    }
    
    setIsProcessing(false);
  };

  // ---------- AI Correction (labels + merge suggestions) ----------

  // Collect up to 5 representative text samples per speaker for the AI.
  // We pick a mix of short and long turns so the model has enough signal.
  const collectSpeakerSamples = () => {
    return speakers.map((speaker) => {
      const owned = segments
        .filter((s) => s.speaker === speaker.id && s.text.trim().length > 0)
        .map((s) => s.text.trim());

      // Rank: prefer medium-length samples (10-30 words) over very short/long
      const scored = owned.map((text) => {
        const words = text.split(/\s+/).filter(Boolean).length;
        const score =
          words >= 10 && words <= 30 ? 2 : words >= 5 && words <= 50 ? 1 : 0;
        return { text, score, words };
      });
      scored.sort((a, b) => b.score - a.score);

      // Deduplicate, keep up to 5
      const seen = new Set<string>();
      const samples: string[] = [];
      for (const entry of scored) {
        if (seen.has(entry.text)) continue;
        seen.add(entry.text);
        samples.push(entry.text);
        if (samples.length >= 5) break;
      }

      return { id: speaker.id, name: speaker.name, samples };
    });
  };

  const handleAICorrection = async () => {
    setIsCorrectingWithAI(true);
    setAiError(null);
    setLabelSuggestions([]);
    setMergeSuggestions([]);
    setAcceptedLabels(new Set());
    setAcceptedMerges(new Set());

    try {
      const speakerSamples = collectSpeakerSamples();
      const speakersWithContent = speakerSamples.filter((s) => s.samples.length > 0);

      if (speakersWithContent.length === 0) {
        setAiError('None of the speakers have tagged segments yet. Assign some text to speakers first.');
        setIsCorrectingWithAI(false);
        return;
      }

      const result = await suggestSpeakerImprovements(speakerSamples);

      if (!result.success) {
        setAiError(result.error || 'AI service failed');
      } else {
        setLabelSuggestions(result.labels);
        setMergeSuggestions(result.merges);
        // Default: pre-accept label suggestions (they're usually wins), pre-accept high-confidence merges only
        setAcceptedLabels(new Set(result.labels.map((l) => l.speakerId)));
        setAcceptedMerges(
          new Set(
            result.merges
              .filter((m) => m.confidence === 'high')
              .map((m) => `${m.speakerAId}>${m.speakerBId}`)
          )
        );

        if (result.labels.length === 0 && result.merges.length === 0) {
          setAiError('The AI had no suggestions — your current labels look good already.');
        }
      }
    } catch (error) {
      setAiError((error as Error).message);
    } finally {
      setIsCorrectingWithAI(false);
    }
  };

  const toggleLabelAccepted = (speakerId: string) => {
    setAcceptedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(speakerId)) next.delete(speakerId);
      else next.add(speakerId);
      return next;
    });
  };

  const toggleMergeAccepted = (mergeKey: string) => {
    setAcceptedMerges((prev) => {
      const next = new Set(prev);
      if (next.has(mergeKey)) next.delete(mergeKey);
      else next.add(mergeKey);
      return next;
    });
  };

  const applyAICorrections = () => {
    // Apply accepted label renames first
    const renamedSpeakers = speakers.map((s) => {
      if (!acceptedLabels.has(s.id)) return s;
      const suggestion = labelSuggestions.find((l) => l.speakerId === s.id);
      if (!suggestion) return s;
      return { ...s, name: suggestion.suggestedName };
    });

    // Apply accepted merges: B gets merged into A. Segments tagged with B
    // are reassigned to A, then B is removed from the speakers list.
    // We process merges in order, resolving transitively if later merges
    // target a speaker already merged into someone else.
    let workingSpeakers = [...renamedSpeakers];
    let workingSegments = [...segments];
    const mergedInto = new Map<string, string>(); // B -> resolved target A

    const resolve = (id: string): string => {
      let cur = id;
      while (mergedInto.has(cur)) cur = mergedInto.get(cur)!;
      return cur;
    };

    for (const merge of mergeSuggestions) {
      const key = `${merge.speakerAId}>${merge.speakerBId}`;
      if (!acceptedMerges.has(key)) continue;
      const targetA = resolve(merge.speakerAId);
      const targetB = resolve(merge.speakerBId);
      if (targetA === targetB) continue;
      mergedInto.set(targetB, targetA);
    }

    if (mergedInto.size > 0) {
      workingSegments = workingSegments.map((seg) => {
        if (seg.speaker && mergedInto.has(seg.speaker)) {
          return { ...seg, speaker: resolve(seg.speaker) };
        }
        return seg;
      });
      workingSpeakers = workingSpeakers.filter((s) => !mergedInto.has(s.id));
    }

    setSpeakers(workingSpeakers);
    setSegments(workingSegments);

    // Clear suggestions — user has applied them
    setLabelSuggestions([]);
    setMergeSuggestions([]);
    setAcceptedLabels(new Set());
    setAcceptedMerges(new Set());
    setAiError(null);
  };

  const dismissAISuggestions = () => {
    setLabelSuggestions([]);
    setMergeSuggestions([]);
    setAcceptedLabels(new Set());
    setAcceptedMerges(new Set());
    setAiError(null);
  };

  const hasSuggestionsToApply =
    labelSuggestions.length > 0 || mergeSuggestions.length > 0;

  const handleSave = () => {
    // Build tagged transcript
    const taggedLines = segments.map(seg => {
      if (seg.speaker) {
        const speaker = speakers.find(s => s.id === seg.speaker);
        return `[${speaker?.name}]: ${seg.text}`;
      }
      return seg.text;
    });
    
    const taggedText = taggedLines.join('\n\n');
    
    // Calculate speaker segments
    const speakerStats = speakers.map(speaker => {
      const segmentCount = segments.filter(s => s.speaker === speaker.id).length;
      return {
        id: speaker.id,
        name: speaker.name,
        segments: segmentCount
      };
    }).filter(s => s.segments > 0);
    
    onSave(taggedText, speakerStats);
    onClose();
  };

  if (!isOpen) return null;

  const taggedCount = segments.filter(s => s.speaker).length;
  const progress = segments.length > 0 ? (taggedCount / segments.length) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-surface-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-elevated w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-semibold text-surface-900">Speaker Tagging</h2>
            <p className="text-sm text-surface-600 mt-1">
              Each sentence is a separate segment. Click any sentence to assign it to the selected speaker. Perfect for tagging short responses like "Yes" or "No".
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-600"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-80 border-r p-6 overflow-y-auto bg-surface-50">
            {/* Progress */}
            <div className="mb-6">
              <div className="flex justify-between text-sm text-surface-600 mb-2">
                <span>Progress</span>
                <span>{taggedCount} / {segments.length} segments</span>
              </div>
              <div className="w-full bg-surface-200 rounded-full h-3">
                <div 
                  className="bg-primary-800 h-3 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Instructions */}
            <div className="mb-6 p-4 bg-primary-100 rounded-lg">
              <h3 className="text-sm font-medium text-primary-900 mb-2">How to Tag:</h3>
              <ol className="text-xs text-primary-800 space-y-1">
                <li>1. Select a speaker below</li>
                <li>2. Click on sentences to assign them</li>
                <li>3. Tag short responses like "Yes", "No" easily</li>
                <li>4. Tag 2-3 sentences manually, then use AI</li>
              </ol>
            </div>

            {/* Selected Speaker */}
            <div className="mb-4">
              <h3 className="text-sm font-medium text-surface-700 mb-2">Selected Speaker:</h3>
              {selectedSpeaker && (
                <div className="p-3 rounded-lg border-2 border-primary-400 bg-primary-100">
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: speakers.find(s => s.id === selectedSpeaker)?.color }}
                    />
                    <span className="font-medium">{speakers.find(s => s.id === selectedSpeaker)?.name}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Speakers */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-surface-700 mb-3">Available Speakers:</h3>
              <div className="space-y-2">
                {speakers.map((speaker) => {
                  const segmentCount = segments.filter(s => s.speaker === speaker.id).length;
                  return (
                    <div
                      key={speaker.id}
                      className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedSpeaker === speaker.id
                          ? 'border-primary-400 bg-primary-100'
                          : 'border-surface-200 hover:border-surface-200 bg-white'
                      }`}
                      onClick={() => setSelectedSpeaker(speaker.id)}
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: speaker.color }}
                        />
                        <div>
                          <span className="font-medium text-sm">{speaker.name}</span>
                          <div className="text-xs text-surface-500">{segmentCount} segments</div>
                        </div>
                      </div>
                      {speakers.length > 2 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSpeaker(speaker.id);
                          }}
                          className="text-surface-400 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add speaker */}
              <div className="mt-3 flex items-center space-x-2">
                <input
                  type="text"
                  value={newSpeakerName}
                  onChange={(e) => setNewSpeakerName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addSpeaker()}
                  placeholder="Add speaker..."
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                <button
                  onClick={addSpeaker}
                  className="p-2 text-primary-800 hover:bg-primary-100 rounded-lg"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              {/* AI Correction — rename + merge suggestions based on what
                  speakers actually say. Works on top of the auto-diarised
                  labels; complements the segment-tagging feature below. */}
              <button
                onClick={handleAICorrection}
                disabled={isCorrectingWithAI || speakers.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                  isCorrectingWithAI || speakers.length === 0
                    ? 'bg-surface-100 text-surface-400 cursor-not-allowed'
                    : 'bg-accent-600 text-white hover:bg-accent-700'
                }`}
              >
                {isCorrectingWithAI ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                <span>{isCorrectingWithAI ? 'Thinking...' : 'AI Correction'}</span>
              </button>
              <p className="text-[11px] text-surface-500 text-center -mt-1">
                Suggest meaningful labels and flag speakers that might be the same person
              </p>

              <button
                onClick={applyAISuggestions}
                disabled={isProcessing || taggedCount < 2}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                  isProcessing || taggedCount < 2
                    ? 'bg-surface-100 text-surface-400 cursor-not-allowed'
                    : 'bg-primary-800 text-primary-100 hover:bg-primary-900'
                }`}
              >
                <Wand2 size={18} />
                <span>{isProcessing ? 'Processing...' : 'Extend Manual Tags'}</span>
              </button>

              {taggedCount < 2 && (
                <p className="text-[11px] text-surface-500 text-center -mt-1">
                  Tag at least 2 segments manually to enable tag extension
                </p>
              )}

              {/* AI error / empty result message */}
              {aiError && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  {aiError}
                </div>
              )}
            </div>

            {/* AI Correction suggestions panel */}
            {hasSuggestionsToApply && (
              <div className="mt-6 border-t border-surface-200 pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
                    <Sparkles size={14} className="text-accent-500" />
                    AI Suggestions
                  </h3>
                  <button
                    onClick={dismissAISuggestions}
                    className="text-xs text-surface-500 hover:text-surface-700"
                  >
                    Dismiss
                  </button>
                </div>

                {/* Label suggestions */}
                {labelSuggestions.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-medium text-surface-500 uppercase tracking-wider mb-2">
                      Rename speakers ({labelSuggestions.length})
                    </h4>
                    <div className="space-y-2">
                      {labelSuggestions.map((label) => {
                        const accepted = acceptedLabels.has(label.speakerId);
                        return (
                          <label
                            key={label.speakerId}
                            className={`flex items-start gap-2 p-2.5 rounded-lg cursor-pointer border transition-colors ${
                              accepted
                                ? 'border-accent-300 bg-accent-50'
                                : 'border-surface-200 bg-white hover:border-surface-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={accepted}
                              onChange={() => toggleLabelAccepted(label.speakerId)}
                              className="mt-0.5 accent-accent-600 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-surface-800">
                                <span className="line-through text-surface-400">{label.currentName}</span>
                                <span className="mx-1.5 text-surface-400">→</span>
                                <span className="font-semibold text-surface-900">{label.suggestedName}</span>
                              </div>
                              <p className="text-[11px] text-surface-500 mt-0.5">{label.reasoning}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Merge suggestions */}
                {mergeSuggestions.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-medium text-surface-500 uppercase tracking-wider mb-2">
                      Merge suggestions ({mergeSuggestions.length})
                    </h4>
                    <div className="space-y-2">
                      {mergeSuggestions.map((merge) => {
                        const key = `${merge.speakerAId}>${merge.speakerBId}`;
                        const accepted = acceptedMerges.has(key);
                        const confidenceColor =
                          merge.confidence === 'high'
                            ? 'bg-emerald-100 text-emerald-700'
                            : merge.confidence === 'medium'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-surface-100 text-surface-600';
                        return (
                          <label
                            key={key}
                            className={`flex items-start gap-2 p-2.5 rounded-lg cursor-pointer border transition-colors ${
                              accepted
                                ? 'border-accent-300 bg-accent-50'
                                : 'border-surface-200 bg-white hover:border-surface-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={accepted}
                              onChange={() => toggleMergeAccepted(key)}
                              className="mt-0.5 accent-accent-600 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-surface-800">
                                Merge <span className="font-semibold">{merge.speakerBName}</span> into{' '}
                                <span className="font-semibold">{merge.speakerAName}</span>
                                <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${confidenceColor}`}>
                                  {merge.confidence}
                                </span>
                              </div>
                              <p className="text-[11px] text-surface-500 mt-0.5">{merge.reasoning}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  onClick={applyAICorrections}
                  disabled={acceptedLabels.size === 0 && acceptedMerges.size === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent-600 text-white text-sm font-medium hover:bg-accent-700 disabled:bg-surface-100 disabled:text-surface-400 disabled:cursor-not-allowed transition-colors"
                >
                  <Check size={15} />
                  Apply {acceptedLabels.size + acceptedMerges.size} change
                  {acceptedLabels.size + acceptedMerges.size !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>

          {/* Transcript segments */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="space-y-4 max-w-4xl">
              <div className="text-sm text-surface-600 mb-4">
                <strong>Instructions:</strong> Click on any sentence below to assign it to the selected speaker ({speakers.find(s => s.id === selectedSpeaker)?.name}). Even single words like "Yes" will be separate segments you can tag.
              </div>
              
              {segments.map((segment) => {
                const speaker = segment.speaker ? speakers.find(s => s.id === segment.speaker) : null;
                
                return (
                  <div
                    key={segment.id}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      segment.speaker
                        ? 'border-surface-300 shadow-card'
                        : 'border-surface-200 hover:border-primary-200 hover:bg-primary-100'
                    }`}
                    style={{
                      backgroundColor: speaker ? `${speaker.color}15` : undefined,
                      borderColor: speaker ? speaker.color : undefined
                    }}
                    onClick={() => segment.speaker ? clearSpeaker(segment.id) : assignSpeaker(segment.id)}
                  >
                    <div className="flex items-start space-x-3">
                      {/* Speaker indicator */}
                      <div className="flex-shrink-0 mt-1">
                        {speaker ? (
                          <div className="flex items-center space-x-2">
                            <div
                              className="w-4 h-4 rounded-full border-2 border-white shadow-card"
                              style={{ backgroundColor: speaker.color }}
                            />
                            <span className="text-sm font-medium" style={{ color: speaker.color }}>
                              {speaker.name}
                            </span>
                            {segment.isManuallyTagged && (
                              <span className="text-xs bg-primary-100 text-primary-700 px-2 py-1 rounded">manual</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 rounded-full bg-surface-300 border-2 border-white" />
                            <span className="text-sm text-surface-500">Click to assign</span>
                          </div>
                        )}
                      </div>

                      {/* Text */}
                      <div className="flex-1">
                        <p className="text-surface-800 leading-relaxed">{segment.text}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-surface-50">
          <button
            onClick={onClose}
            className="px-6 py-2 text-surface-600 hover:text-surface-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={taggedCount === 0}
            className={`flex items-center space-x-2 px-6 py-2 rounded-lg font-medium transition-colors ${
              taggedCount === 0
                ? 'bg-surface-100 text-surface-400 cursor-not-allowed'
                : 'bg-primary-800 text-white hover:bg-primary-900'
            }`}
          >
            <Save size={18} />
            <span>Save Tagged Transcript</span>
          </button>
        </div>
      </div>
    </div>
  );
};