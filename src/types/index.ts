export interface Transcript {
  id: string;
  title: string;
  filename: string;
  file_path?: string;
  duration: number;
  file_size: number;
  created_at: string;
  updated_at: string;
  status: 'processing' | 'completed' | 'error';
  
  // Content
  full_text?: string;
  validated_text?: string;
  processed_text?: string;
  validation_changes?: Array<{ type: string; original: string; corrected: string; position: number }>;
  summary?: string;
  action_items?: string[];
  key_topics?: string[];
  
  // Advanced analysis
  sentiment_overall?: string;
  sentiment_score?: number;
  emotions?: Record<string, number>;
  speaker_count?: number;
  speakers?: Array<{ id: string; name: string; segments: number }>;
  
  // Research analysis
  notable_quotes?: Array<{ text: string; speaker?: string; timestamp?: number; relevance: number }>;
  research_themes?: Array<{ theme: string; confidence: number; examples: string[] }>;
  qa_pairs?: Array<{ question: string; answer: string; speaker?: string; timestamp?: number }>;
  concept_frequency?: Record<string, { count: number; contexts: string[] }>;
  
  // Personal notes
  personal_notes?: string;
  
  // Metadata
  tags?: string[];
  starred: boolean;
  rating?: number;
  error_message?: string;
  
  // Data management
  is_archived?: boolean;
  archived_at?: string;
  is_deleted?: boolean;
  deleted_at?: string;
}

export interface TranscriptSegment {
  id?: number;
  transcript_id: string;
  start_time: number;
  end_time: number;
  text: string;
  speaker?: string;
  sentiment?: string;
  emotions?: Record<string, number>;
}

export interface SentenceSegment {
  id: number;
  transcript_id: string;
  sentence_index: number;
  text: string;
  start_time?: number;
  end_time?: number;
  speaker?: string;
  confidence?: number;
  version: 'original' | 'corrected' | 'speaker_tagged';
  source_chunk_index?: number;
  word_count: number;
  sentiment?: string;
  emotions?: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface ChunkTimingInfo {
  chunkIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  text: string;
}

export interface SegmentationStats {
  totalSentences: number;
  avgWordsPerSentence: number;
  avgDurationPerSentence: number;
  confidenceDistribution: { high: number; medium: number; low: number };
  versionsCount: Record<string, number>;
}

// Stages reported by fileProcessor.processFile, in roughly the order they fire.
// UI maps these to human-readable labels in ProcessingQueue.
export type TranscriptionStage =
  | 'queued'
  | 'analyzing_media'
  | 'extracting'
  | 'loading_model'
  | 'transcribing'
  | 'diarising'
  | 'validating'
  | 'analyzing'
  | 'embedding'
  | 'saving';

export interface ProcessingItem {
  id: string;
  transcript_id: string;
  file_path: string;
  // 'cancelled' means user aborted before completion. Distinct from 'error'
  // so we can suppress error toasts and style the queue row differently.
  status: 'queued' | 'transcribing' | 'analyzing' | 'completed' | 'error' | 'cancelled';
  stage?: TranscriptionStage;
  progress: number;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface ServiceStatus {
  // 'setting_up' fires while the bundled Python sidecar runs first-launch
  // venv install; 'starting' covers the boot phase after setup completes.
  speechToText: 'connected' | 'disconnected' | 'error' | 'setting_up' | 'starting';
  aiAnalysis: 'connected' | 'disconnected' | 'error';
  // When speechToText is 'setting_up', the latest STEP: line from setup-venv.py
  // (e.g. 'Installing speech analysis libraries (largest step — PyTorch ~250 MB)').
  speechToTextDetail?: string;
  lastChecked: Date;
}

export interface ChatConversation {
  id: string;
  transcript_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id?: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  
  // Analysis results (cached)
  themes?: string[];
  key_insights?: string[];
  summary?: string;
  last_analysis_at?: string;
  
  // Metadata
  tags?: string[];
  color?: string;
  icon?: string;
  
  // Data management
  is_archived?: boolean;
  archived_at?: string;
  is_deleted?: boolean;
  deleted_at?: string;
  
  // Computed properties (not in DB, calculated on fetch)
  transcript_count?: number;
  total_duration?: number;
  date_range?: {
    start: string;
    end: string;
  };
}

export interface ProjectTranscript {
  project_id: string;
  transcript_id: string;
  added_at: string;
  transcript?: Transcript; // Joined data
}

export interface ProjectChatConversation {
  id: string;
  project_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectChatMessage {
  id?: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ProjectAnalysis {
  id: string;
  project_id: string;
  analysis_type: 'theme_evolution' | 'speaker_comparison' | 'pattern_analysis' | 'consensus_divergence' | 'timeline_analysis';
  results: any; // JSON data, structure depends on analysis_type
  created_at: string;
}

export interface ThemeAnalysis {
  theme: string;
  occurrences: {
    transcript_id: string;
    transcript_title: string;
    count: number;
    quotes: string[];
  }[];
  evolution: {
    date: string;
    strength: number;
  }[];
}

export interface Settings {
  speechToTextUrl: string;
  aiAnalysisUrl: string;
  aiModel: string;
  theme: 'light' | 'dark' | 'system';
}
