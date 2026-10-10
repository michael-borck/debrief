-- AudioScribe Database Schema

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Analysis results (cached)
    themes TEXT, -- JSON array of themes
    key_insights TEXT, -- JSON array
    summary TEXT,
    last_analysis_at DATETIME,
    
    -- Metadata
    tags TEXT, -- JSON array
    color TEXT, -- UI color for the project
    icon TEXT, -- emoji or icon identifier
    
    -- Data management
    is_archived BOOLEAN DEFAULT 0,
    archived_at DATETIME,
    is_deleted BOOLEAN DEFAULT 0,
    deleted_at DATETIME
);

-- Project-Transcript relationship
CREATE TABLE IF NOT EXISTS project_transcripts (
    project_id TEXT NOT NULL,
    transcript_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, transcript_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Project chat conversations
CREATE TABLE IF NOT EXISTS project_chat_conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Project chat messages
CREATE TABLE IF NOT EXISTS project_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES project_chat_conversations(id) ON DELETE CASCADE
);

-- Cross-transcript analysis results
CREATE TABLE IF NOT EXISTS project_analysis (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    analysis_type TEXT NOT NULL, -- 'theme_evolution', 'speaker_comparison', 'pattern_analysis', etc.
    results TEXT NOT NULL, -- JSON data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Model metadata for dynamic context management
CREATE TABLE IF NOT EXISTS model_metadata (
    model_name TEXT PRIMARY KEY,
    provider TEXT NOT NULL, -- 'ollama', 'openai', 'custom'
    context_limit INTEGER NOT NULL,
    capabilities TEXT, -- JSON object with model capabilities
    parameters TEXT, -- JSON object with model parameters
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_override BOOLEAN DEFAULT 0,
    is_available BOOLEAN DEFAULT 1
);

-- Transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT,
    duration INTEGER, -- in seconds
    file_size INTEGER, -- in bytes
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('processing', 'completed', 'error')) DEFAULT 'processing',
    
    -- Content fields
    full_text TEXT, -- Original transcript
    validated_text TEXT, -- Corrected/validated transcript
    processed_text TEXT, -- Speaker-tagged and formatted transcript
    validation_changes TEXT, -- JSON array of changes made
    summary TEXT,
    action_items TEXT, -- JSON array
    key_topics TEXT, -- JSON array
    
    -- Advanced analysis fields
    sentiment_overall TEXT, -- 'positive', 'negative', 'neutral'
    sentiment_score REAL, -- -1.0 to 1.0
    emotions TEXT, -- JSON object with emotion scores
    speaker_count INTEGER DEFAULT 1,
    speakers TEXT, -- JSON array of speaker info
    
    -- Research analysis fields
    notable_quotes TEXT, -- JSON array of quotable statements
    research_themes TEXT, -- JSON array of research themes/categories
    qa_pairs TEXT, -- JSON array of question-answer mappings
    concept_frequency TEXT, -- JSON object with concept counts
    
    -- Personal notes
    personal_notes TEXT, -- User's personal notes about the transcript
    
    -- Metadata
    tags TEXT, -- JSON array
    starred BOOLEAN DEFAULT 0,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    
    -- Processing metadata
    error_message TEXT,
    processing_started_at DATETIME,
    processing_completed_at DATETIME,
    
    -- Data management
    is_archived BOOLEAN DEFAULT 0,
    archived_at DATETIME,
    is_deleted BOOLEAN DEFAULT 0,
    deleted_at DATETIME
);

-- Transcript segments for sentence-level processing with timestamps
CREATE TABLE IF NOT EXISTS transcript_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id TEXT NOT NULL,
    sentence_index INTEGER NOT NULL, -- Order of sentence in transcript
    text TEXT NOT NULL, -- Sentence text
    start_time REAL, -- in seconds from audio start
    end_time REAL, -- in seconds from audio start
    speaker TEXT, -- Speaker identifier
    confidence REAL, -- Confidence score for this segment (0.0-1.0)
    version TEXT DEFAULT 'original', -- 'original', 'corrected', 'speaker_tagged'
    source_chunk_index INTEGER, -- Which audio chunk this came from
    word_count INTEGER, -- Number of words in this sentence
    
    -- Analysis fields
    sentiment TEXT, -- 'positive', 'negative', 'neutral' for this segment
    emotions TEXT, -- JSON object with emotion scores for this segment
    
    -- Metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Diarization turns: the raw speaker turns produced by pyannote, in order.
--
-- These are NOT derivable from transcript_segments. Sentence timings there are
-- interpolated estimates distributed across each Whisper chunk by word count;
-- the turns below are the diarizer's actual output and carry real boundaries.
-- Persisting them is what makes accurate per-speaker audio clipping and
-- turn-level timestamps possible.
CREATE TABLE IF NOT EXISTS diarization_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL, -- position in the recording, 0-based
    speaker TEXT NOT NULL,
    start_time REAL NOT NULL, -- seconds from audio start
    end_time REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_diarization_turns_unique
    ON diarization_turns(transcript_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_diarization_turns_speaker
    ON diarization_turns(transcript_id, speaker);


-- Chat conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

-- Conversation memory (for compacted summaries)
CREATE TABLE IF NOT EXISTS conversation_memory (
    conversation_id TEXT PRIMARY KEY,
    compacted_summary TEXT,
    total_exchanges INTEGER DEFAULT 0,
    last_compaction_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI Prompts Configuration
CREATE TABLE IF NOT EXISTS ai_prompts (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL, -- 'chat', 'analysis', 'validation', 'speaker'
    type TEXT NOT NULL, -- specific prompt type like 'transcript_chat', 'sentiment_analysis', etc.
    name TEXT NOT NULL, -- human-readable name
    description TEXT, -- help text for users
    prompt_text TEXT NOT NULL, -- the actual prompt template
    variables TEXT, -- JSON array of template variables like ["{transcript}", "{context}"]
    model_compatibility TEXT, -- JSON array of compatible models or 'all'
    default_prompt BOOLEAN DEFAULT 0, -- whether this is a system default
    user_modified BOOLEAN DEFAULT 0, -- whether user has customized this prompt
    system_used BOOLEAN DEFAULT 0, -- whether this prompt is actively used by the system's processing pipeline
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Processing queue
CREATE TABLE IF NOT EXISTS processing_queue (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT CHECK(status IN ('queued', 'transcribing', 'analyzing', 'completed', 'error')) DEFAULT 'queued',
    progress REAL DEFAULT 0,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transcripts_status ON transcripts(status);
CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts(created_at);
CREATE INDEX IF NOT EXISTS idx_transcripts_starred ON transcripts(starred);
CREATE INDEX IF NOT EXISTS idx_transcripts_archived ON transcripts(is_archived);
CREATE INDEX IF NOT EXISTS idx_transcripts_deleted ON transcripts(is_deleted);
CREATE INDEX IF NOT EXISTS idx_transcripts_deleted_at ON transcripts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_transcript_id ON transcript_segments(transcript_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_sentence_index ON transcript_segments(transcript_id, sentence_index);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_version ON transcript_segments(transcript_id, version);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_speaker ON transcript_segments(transcript_id, speaker);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_time ON transcript_segments(transcript_id, start_time);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_transcript_id ON chat_conversations(transcript_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_conversation_id ON conversation_memory(conversation_id);
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status);

-- Project indexes
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);

-- AI Prompts indexes
CREATE INDEX IF NOT EXISTS idx_ai_prompts_category ON ai_prompts(category);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_type ON ai_prompts(type);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_category_type ON ai_prompts(category, type);
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(is_archived);
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(is_deleted);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_project_transcripts_project_id ON project_transcripts(project_id);
CREATE INDEX IF NOT EXISTS idx_project_transcripts_transcript_id ON project_transcripts(transcript_id);
CREATE INDEX IF NOT EXISTS idx_project_chat_conversations_project_id ON project_chat_conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_project_chat_messages_conversation_id ON project_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_project_analysis_project_id ON project_analysis(project_id);

-- Model metadata indexes
CREATE INDEX IF NOT EXISTS idx_model_metadata_provider ON model_metadata(provider);
CREATE INDEX IF NOT EXISTS idx_model_metadata_available ON model_metadata(is_available);
CREATE INDEX IF NOT EXISTS idx_model_metadata_updated ON model_metadata(last_updated);

-- Triggers to update timestamps
CREATE TRIGGER IF NOT EXISTS update_transcript_timestamp 
AFTER UPDATE ON transcripts
BEGIN
    UPDATE transcripts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_chat_conversation_timestamp 
AFTER UPDATE ON chat_conversations
BEGIN
    UPDATE chat_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_settings_timestamp 
AFTER UPDATE ON settings
BEGIN
    UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
END;

CREATE TRIGGER IF NOT EXISTS update_project_timestamp 
AFTER UPDATE ON projects
BEGIN
    UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_project_chat_conversation_timestamp 
AFTER UPDATE ON project_chat_conversations
BEGIN
    UPDATE project_chat_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('speechToTextUrl', 'https://speaches.serveur.au'),
    ('speechToTextModel', 'Systran/faster-distil-whisper-medium.en'),
    ('aiAnalysisUrl', 'http://localhost:11434'),
    ('aiModel', 'llama2'),
    ('autoBackup', 'true'),
    ('backupFrequency', 'weekly'),
    ('backupRetention', '5'),
    ('cleanupTempFiles', 'true'),
    ('theme', 'system'),
    ('enableTranscriptValidation', 'true'),
    ('validationOptions', '{"spelling": true, "grammar": true, "punctuation": true, "capitalization": true}'),
    ('analyzeValidatedTranscript', 'true'),
    ('audioChunkSize', '60'),
    ('enableSpeakerTagging', 'true'),
    ('oneTaskAtATime', 'true'),
    ('chatContextChunks', '4'),
    ('chatMemoryLimit', '20'),
    ('chatChunkingMethod', 'speaker'),
    ('chatMaxChunkSize', '60'),
    ('chatChunkOverlap', '10'),
    ('conversationMode', 'rag'),
    ('directLlmContextLimit', '8000'),
    ('vectorOnlyChunkCount', '5');

-- Migration: Add missing columns to existing tables (safe to run multiple times)
-- Check if columns exist before adding them (SQLite doesn't support IF NOT EXISTS for ALTER TABLE)

-- First, create a temporary table to check if migration is needed
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Mark this migration
INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
-- v2: diarization_turns (per-speaker audio clipping, turn-level timestamps)
INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);