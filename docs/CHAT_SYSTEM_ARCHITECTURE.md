# Debrief Chat System Architecture

## Table of Contents
1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Service Layer Design](#service-layer-design)
4. [Conversation Modes](#conversation-modes)
5. [Dynamic Context Management](#dynamic-context-management)
6. [Memory Management](#memory-management)
7. [Project-Level Chat](#project-level-chat)
8. [Vector Store & RAG Pipeline](#vector-store--rag-pipeline)
9. [Database Integration](#database-integration)
10. [Configuration & Settings](#configuration--settings)
11. [Performance Optimizations](#performance-optimizations)
12. [Implementation Patterns](#implementation-patterns)
13. [API Reference](#api-reference)
14. [Best Practices](#best-practices)

## Overview

Debrief implements a sophisticated **Retrieval-Augmented Generation (RAG)** chat system that enables intelligent interaction with transcribed audio content. The system features:

- **Multi-modal conversation support** (Vector-Only, RAG, Direct LLM)
- **Dynamic context management** based on model capabilities
- **Intelligent memory compaction** for long conversations
- **Cross-transcript analysis** for project-level insights
- **Real-time model metadata detection** for optimal performance

### Key Capabilities

```
┌─────────────────────────────────────────────────────────────┐
│                    Chat System Architecture                 │
├─────────────────────────────────────────────────────────────┤
│  Transcript Chat    │  Project Chat    │  Model Management  │
│  ┌─────────────┐   │  ┌─────────────┐ │  ┌─────────────┐   │
│  │ RAG Mode    │   │  │ Collated    │ │  │ Dynamic     │   │
│  │ Vector Mode │   │  │ Cross-Trans │ │  │ Detection   │   │
│  │ Direct LLM  │   │  │ Hybrid      │ │  │ Context     │   │
│  └─────────────┘   │  └─────────────┘ │  │ Optimization│   │
└─────────────────────────────────────────────────────────────┘
```

## Core Architecture

### Service Layer Structure

The chat system is built on three foundational services:

```typescript
┌──────────────────┐    ┌─────────────────────┐    ┌───────────────────┐
│   ChatService    │    │ ProjectChatService  │    │ ModelMetadata     │
│                  │    │                     │    │ Service           │
│ • RAG Pipeline   │    │ • Cross-transcript  │    │                   │
│ • Memory Mgmt    │    │ • Analysis modes    │    │ • Context limits  │
│ • Context Mgmt   │    │ • Transcript        │    │ • Model detection │
│ • 3 Conv. modes  │    │   selection         │    │ • Optimization    │
└──────────────────┘    └─────────────────────┘    └───────────────────┘
        │                          │                          │
        └──────────────────────────┼──────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │     Vector Store Services    │
                    │                             │
                    │ • EmbeddingService          │
                    │ • VectorStoreService        │
                    │ • ChunkingService           │
                    └─────────────────────────────┘
```

## Service Layer Design

### 1. ChatService

**Location**: `src/services/chatService.ts`  
**Purpose**: Core RAG implementation for individual transcripts

```typescript
class ChatService {
  private config: ChatServiceConfig;
  private conversationMemoryCache: Map<string, ConversationMemory>;
  
  // Core Methods
  async chatWithTranscript(
    transcriptId: string,
    conversationId: string,
    userMessage: string,
    conversationHistory: ChatMessage[]
  ): Promise<ChatMessage>
  
  // Context Management
  private async buildContext(
    transcript: Transcript,
    userMessage: string,
    memory: ConversationMemory
  ): Promise<{ context: string; sources: string[] }>
  
  // Memory Management
  private async manageConversationMemory(
    conversationId: string,
    messages: ChatMessage[]
  ): Promise<ConversationMemory>
}
```

**Key Features**:
- Singleton pattern for state consistency
- Automatic memory compaction at configurable thresholds
- Dynamic mode switching based on context requirements
- Integrated vector search and LLM interaction

### 2. ProjectChatService

**Location**: `src/services/projectChatService.ts`  
**Purpose**: Cross-transcript analysis and project-level insights

```typescript
class ProjectChatService {
  // Analysis Modes
  async chatWithProject(
    projectId: string,
    conversationId: string,
    userMessage: string,
    conversationHistory: ProjectChatMessage[]
  ): Promise<ProjectChatMessage>
  
  // Transcript Selection Strategies
  private async selectRelevantTranscripts(
    projectId: string,
    userMessage: string,
    strategy: 'recent' | 'relevant' | 'all'
  ): Promise<TranscriptSelection[]>
  
  // Analysis Implementation
  private async performCollatedAnalysis(transcripts, userMessage): Promise<string>
  private async performCrossTranscriptAnalysis(transcripts, userMessage): Promise<string>
  private async performHybridAnalysis(transcripts, userMessage): Promise<string>
}
```

**Analysis Modes**:

1. **Collated**: Individual transcript analysis combined into unified response
2. **Cross-Transcript**: Pattern detection and consensus analysis across transcripts  
3. **Hybrid**: Intelligent routing based on query type and content complexity

### 3. ModelMetadataService

**Location**: `src/services/modelMetadataService.ts`  
**Purpose**: Dynamic model capability detection and context optimization

```typescript
class ModelMetadataService {
  // Context Budget Calculation
  calculateContextBudget(modelMetadata: ModelMetadata, memoryReserveFactor = 0.2): {
    totalLimit: number;     // Model's full context window
    memoryReserve: number;  // Reserved for conversation history
    contentBudget: number;  // Available for transcript content
    safetyMargin: number;   // Buffer to prevent overflow
  }
  
  // Model Detection
  async getModelMetadata(modelName: string): Promise<ModelMetadata>
  private detectModelFamily(modelName: string): ModelFamily
  
  // Context Validation
  validateContextUsage(content: string, memory: string): ContextValidation
}
```

**Model Families Supported**:
- **Llama Family**: 4K-128K context windows
- **Qwen Family**: 32K-128K context windows  
- **Mistral Family**: 8K-32K context windows
- **Gemma Family**: 8K context window
- **Custom Models**: Configurable limits

## Conversation Modes

### 1. Vector-Only Mode

**Use Case**: Quick reference lookup without LLM interpretation  
**Process**:
```typescript
// 1. Vector similarity search
const chunks = await vectorStoreService.searchSimilar(
  transcriptId, 
  userMessage, 
  config.contextChunks
);

// 2. Format results with metadata
return formatVectorResults(chunks, {
  includeTimestamps: true,
  includeRelevanceScores: true,
  maxResults: config.contextChunks
});
```

**Output Format**:
```
🔍 **Found 3 relevant excerpts:**

**[02:45 - 03:12] Speaker A** (Relevance: 0.89)
"The main challenge we're facing is the integration between the legacy system..."

**[15:30 - 16:05] Speaker B** (Relevance: 0.82)  
"I think the solution involves implementing a middleware layer that can..."

**[28:15 - 29:00] Speaker A** (Relevance: 0.78)
"Building on what Speaker B mentioned, the middleware approach would require..."
```

### 2. RAG Mode (Default)

**Use Case**: AI-interpreted responses with source attribution  
**Process**:
```typescript
// 1. Retrieve relevant chunks
const searchResults = await vectorStoreService.searchSimilar(
  transcriptId, userMessage, config.contextChunks
);

// 2. Build context with memory
const context = await this.buildContext(transcript, userMessage, memory);

// 3. Generate AI response
const prompt = `Based on the following transcript excerpt and conversation history, 
please answer the user's question...

Context: ${context.context}
Memory: ${memory.compactedSummary}
User Question: ${userMessage}`;

const response = await llmService.generate(prompt);
```

**Context Structure**:
```
=== TRANSCRIPT CONTEXT ===
Title: "Team Meeting - Q3 Planning"
Duration: 45:30 | Date: 2024-01-15

--- Relevant Excerpts ---
[02:45-03:12] Speaker A: "The main challenge..."
[15:30-16:05] Speaker B: "I think the solution..."

=== CONVERSATION MEMORY ===
Previous discussion summary: You previously asked about integration challenges...

=== USER QUESTION ===
What solutions were proposed for the integration issues?
```

### 3. Direct LLM Mode

**Use Case**: Full transcript analysis when context window permits  
**Process**:
```typescript
// 1. Validate transcript fits in context
const validation = await modelMetadataService.validateContextUsage(
  transcript.full_text, 
  memory.compactedSummary
);

if (!validation.fits) {
  // Smart truncation: prioritize recent content
  truncatedContent = this.intelligentTruncation(
    transcript, 
    validation.contentBudget
  );
}

// 2. Send full context to LLM
const prompt = `Please analyze this complete transcript and answer the question...

Full Transcript: ${truncatedContent || transcript.full_text}
Question: ${userMessage}`;
```

**Truncation Strategy**:
- Preserve transcript structure (speaker labels, timestamps)
- Prioritize recent content over older segments
- Maintain context coherence at sentence boundaries
- Include summary of truncated sections

## Dynamic Context Management

### Context Budget Allocation

The system dynamically allocates context based on model capabilities:

```typescript
interface ContextBudget {
  totalLimit: number;      // e.g., 4096 tokens for Llama-7B
  memoryReserve: number;   // 20% for conversation history (819 tokens)
  contentBudget: number;   // 70% for transcript content (2867 tokens)  
  safetyMargin: number;    // 10% buffer (410 tokens)
}
```

### Model Detection Process

1. **API Query**: Attempt to get model info from Ollama API
2. **Name Pattern Matching**: Use regex patterns for model families
3. **Fallback Strategy**: Default to conservative limits (4096 tokens)
4. **Caching**: Store metadata with 30-minute TTL

```typescript
// Model family detection patterns
const MODEL_PATTERNS = {
  llama: /llama.*?(\d+(?:\.\d+)?)[kb]/i,
  qwen: /qwen.*?(\d+(?:\.\d+)?)[kb]/i,
  mistral: /mistral.*?(\d+(?:\.\d+)?)[kb]/i,
  gemma: /gemma.*?(\d+(?:\.\d+)?)[kb]/i
};

// Context limits by family
const CONTEXT_LIMITS = {
  'llama-7b': 4096,
  'llama-13b': 4096, 
  'llama-70b': 4096,
  'qwen-7b': 32768,
  'qwen-14b': 32768,
  'mistral-7b': 8192
};
```

### Context Validation

Before sending requests, the system validates context usage:

```typescript
interface ContextValidation {
  fits: boolean;                    // Whether content fits
  recommendation?: string;          // Optimization suggestions
  contentLength: number;           // Character count
  memoryLength: number;            // Memory character count
  estimatedTokens: number;         // Rough token estimate
  utilizationPercentage: number;   // Context window usage
}

// Example validation response
{
  fits: false,
  recommendation: "Consider using RAG mode for better context utilization",
  contentLength: 15420,
  memoryLength: 2341,
  estimatedTokens: 4440,
  utilizationPercentage: 108.5
}
```

## Memory Management

### Conversation Memory Structure

```typescript
interface ConversationMemory {
  activeMessages: ChatMessage[];    // Recent messages kept as-is
  compactedSummary: string;        // AI-summarized older conversation
  totalExchanges: number;          // Total conversation length
  lastCompactionAt?: string;       // Timestamp of last compaction
  compactionTriggerCount: number;  // Messages since last compaction
}
```

### Memory Compaction Process

**Trigger Conditions**:
- Message count exceeds `conversationMemoryLimit` (default: 20)
- Context budget pressure detected
- Manual compaction request

**Compaction Algorithm**:
```typescript
async performMemoryCompaction(
  conversationId: string, 
  messages: ChatMessage[]
): Promise<ConversationMemory> {
  // 1. Determine split point (keep last 40% active)
  const keepActiveCount = Math.ceil(messages.length * 0.4);
  const toCompact = messages.slice(0, -keepActiveCount);
  const activeMessages = messages.slice(-keepActiveCount);
  
  // 2. Generate AI summary of older messages
  const compactionPrompt = `Summarize this conversation history concisely, 
  preserving key topics, decisions, and context...`;
  
  const summary = await this.generateCompactionSummary(toCompact);
  
  // 3. Store compacted memory
  const memory: ConversationMemory = {
    activeMessages,
    compactedSummary: summary,
    totalExchanges: messages.length,
    lastCompactionAt: new Date().toISOString()
  };
  
  await this.storeConversationMemory(conversationId, memory);
  return memory;
}
```

**Fallback Summarization**:
If AI summarization fails, the system uses rule-based summarization:
```typescript
private createFallbackSummary(messages: ChatMessage[]): string {
  const userQuestions = messages
    .filter(m => m.role === 'user')
    .map(m => m.content.substring(0, 100));
    
  const keyTopics = this.extractKeyTopics(messages);
  
  return `Previous conversation (${messages.length} exchanges) covered: 
  ${keyTopics.join(', ')}. Main questions: ${userQuestions.join('; ')}`;
}
```

## Project-Level Chat

### Transcript Selection Strategies

#### 1. Recent Strategy
```typescript
async selectRecentTranscripts(
  projectId: string, 
  limit: number = 5
): Promise<Transcript[]> {
  return await database.query(`
    SELECT * FROM transcripts t
    JOIN project_transcripts pt ON t.id = pt.transcript_id  
    WHERE pt.project_id = ? AND t.status = 'completed'
    ORDER BY t.created_at DESC LIMIT ?
  `, [projectId, limit]);
}
```

#### 2. Relevant Strategy  
```typescript
async selectRelevantTranscripts(
  projectId: string,
  userMessage: string,
  limit: number = 5
): Promise<TranscriptSelection[]> {
  // 1. Get all project transcripts
  const transcripts = await this.getProjectTranscripts(projectId);
  
  // 2. Calculate relevance scores using vector similarity
  const scores = await Promise.all(
    transcripts.map(async transcript => {
      const similarity = await vectorStoreService.calculateSimilarity(
        transcript.id, userMessage
      );
      return { transcript, relevance: similarity };
    })
  );
  
  // 3. Sort by relevance and return top results
  return scores
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}
```

#### 3. All Strategy
Includes all project transcripts up to configured limit, with context budget allocation.

### Analysis Modes Implementation

#### Collated Analysis
```typescript
async performCollatedAnalysis(
  transcripts: Transcript[],
  userMessage: string,
  memory: ProjectConversationMemory
): Promise<string> {
  const responses: string[] = [];
  
  // Process each transcript individually
  for (const transcript of transcripts) {
    const response = await chatService.chatWithTranscript(
      transcript.id,
      `project_${this.generateId()}`, // Temporary conversation
      userMessage,
      [] // No history for individual analysis
    );
    responses.push(`**${transcript.title}**: ${response.content}`);
  }
  
  // Combine responses with AI synthesis
  const combinedPrompt = `Synthesize these individual responses into a cohesive answer:
  
  ${responses.join('\n\n')}
  
  User question: ${userMessage}`;
  
  return await this.generateSynthesizedResponse(combinedPrompt);
}
```

#### Cross-Transcript Analysis
```typescript
async performCrossTranscriptAnalysis(
  transcripts: Transcript[],
  userMessage: string
): Promise<string> {
  // 1. Extract themes and patterns across transcripts
  const themes = await this.extractCrossTranscriptThemes(transcripts);
  const patterns = await this.identifyPatterns(transcripts, userMessage);
  
  // 2. Build analysis context
  const analysisContext = `
  Cross-Transcript Analysis:
  
  Transcripts: ${transcripts.map(t => t.title).join(', ')}
  
  Common Themes: ${themes.join(', ')}
  
  Identified Patterns: ${patterns.join('; ')}
  
  Excerpts:
  ${await this.getRelevantExcerpts(transcripts, userMessage)}
  `;
  
  // 3. Generate cross-transcript insights
  const prompt = `Based on analysis across multiple transcripts, 
  identify patterns, consensus points, and divergent perspectives 
  relevant to: ${userMessage}
  
  ${analysisContext}`;
  
  return await this.generateAnalysisResponse(prompt);
}
```

#### Hybrid Analysis (Smart Routing)
```typescript
async performHybridAnalysis(
  transcripts: Transcript[],
  userMessage: string,
  memory: ProjectConversationMemory
): Promise<string> {
  // Intelligent mode selection based on:
  const analysisFactors = {
    questionType: this.classifyQuestion(userMessage),
    transcriptCount: transcripts.length,
    contentComplexity: this.assessComplexity(transcripts),
    userHistory: memory.preferredAnalysisMode
  };
  
  if (analysisFactors.questionType === 'specific' && transcripts.length <= 3) {
    return this.performCollatedAnalysis(transcripts, userMessage, memory);
  } else if (analysisFactors.contentComplexity > 0.7) {
    return this.performCrossTranscriptAnalysis(transcripts, userMessage);
  } else {
    // Default to collated for most cases
    return this.performCollatedAnalysis(transcripts, userMessage, memory);
  }
}
```

## Vector Store & RAG Pipeline

### Chunking Strategy

**Location**: `src/services/chunkingService.ts`

```typescript
interface ChunkingConfig {
  strategy: 'speaker' | 'time' | 'hybrid';
  chunkSize: number;        // Duration in seconds (default: 60)
  overlapSize: number;      // Overlap in seconds (default: 10) 
  minChunkSize: number;     // Minimum viable chunk (default: 15)
  preserveSpeakerBoundaries: boolean;
}

// Speaker-based chunking (default)
async chunkBySpeaker(transcript: Transcript): Promise<TranscriptChunk[]> {
  const segments = await this.getTranscriptSegments(transcript.id);
  const chunks: TranscriptChunk[] = [];
  
  let currentChunk = { text: '', speaker: '', startTime: 0, segments: [] };
  
  for (const segment of segments) {
    // Start new chunk on speaker change or time limit
    if (segment.speaker !== currentChunk.speaker || 
        (segment.start_time - currentChunk.startTime) > this.config.chunkSize) {
      
      if (currentChunk.text.length > 0) {
        chunks.push(this.finalizeChunk(currentChunk, transcript));
      }
      
      currentChunk = {
        text: segment.text,
        speaker: segment.speaker,
        startTime: segment.start_time,
        segments: [segment]
      };
    } else {
      currentChunk.text += ` ${segment.text}`;
      currentChunk.segments.push(segment);
    }
  }
  
  return chunks;
}
```

### Embedding Pipeline

**Location**: `src/services/embeddingService.ts`

```typescript
class EmbeddingService {
  private model = 'Xenova/all-MiniLM-L6-v2'; // 384 dimensions
  
  async generateEmbeddings(chunks: TranscriptChunk[]): Promise<EnhancedEmbedding[]> {
    return await Promise.all(chunks.map(async chunk => {
      // Delegate to main process for performance
      const embedding = await window.electronAPI.embeddings.generate(chunk.text);
      
      return {
        id: chunk.id,
        embedding: embedding.vector,
        metadata: {
          transcriptId: chunk.transcriptId,
          transcriptTitle: chunk.transcriptTitle,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          speaker: chunk.speaker,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          // Enhanced metadata
          wordCount: chunk.text.split(' ').length,
          speakerCount: this.countUniqueSpeakers(chunk),
          topics: chunk.topics || [],
          sentiment: chunk.sentiment
        }
      };
    }));
  }
}
```

### Vector Store Operations

**Location**: `src/services/vectorStoreService.ts`

```typescript
class VectorStoreService {
  async searchSimilar(
    transcriptId: string,
    query: string,
    limit: number = 4,
    threshold: number = 0.7
  ): Promise<SearchResult[]> {
    // 1. Generate query embedding
    const queryEmbedding = await embeddingService.generateQueryEmbedding(query);
    
    // 2. Perform similarity search via IPC
    const results = await window.electronAPI.vectorStore.search({
      vector: queryEmbedding,
      filter: { transcriptId },
      limit,
      threshold
    });
    
    // 3. Format results with metadata
    return results.map(result => ({
      id: result.id,
      similarity: result.score,
      text: result.metadata.text,
      speaker: result.metadata.speaker,
      startTime: result.metadata.startTime,
      endTime: result.metadata.endTime,
      context: this.buildChunkContext(result)
    }));
  }
  
  private buildChunkContext(result: SearchResult): string {
    return `[${this.formatTime(result.metadata.startTime)} - ${this.formatTime(result.metadata.endTime)}] ${result.metadata.speaker}: ${result.metadata.text}`;
  }
}
```

## Database Integration

### Schema Design

```sql
-- Core chat storage
CREATE TABLE chat_conversations (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (transcript_id) REFERENCES transcripts(id)
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
);

-- Conversation memory storage
CREATE TABLE conversation_memory (
  conversation_id TEXT PRIMARY KEY,
  active_messages TEXT NOT NULL,        -- JSON array
  compacted_summary TEXT,
  total_exchanges INTEGER DEFAULT 0,
  last_compaction_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
);

-- Project-level chat
CREATE TABLE project_chat_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE project_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES project_chat_conversations(id)
);

-- Model metadata caching
CREATE TABLE model_metadata (
  model_name TEXT PRIMARY KEY,
  context_limit INTEGER NOT NULL,
  model_family TEXT,
  capabilities TEXT,                     -- JSON object
  last_updated TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- AI prompt management
CREATE TABLE ai_prompts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  is_default BOOLEAN DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(category, type)
);
```

### Data Access Patterns

```typescript
// Conversation loading with memory
async loadConversationWithMemory(conversationId: string): Promise<{
  messages: ChatMessage[];
  memory: ConversationMemory | null;
}> {
  const [messages, memory] = await Promise.all([
    this.database.all(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    ),
    this.database.get(
      'SELECT * FROM conversation_memory WHERE conversation_id = ?',
      [conversationId]
    )
  ]);
  
  return {
    messages,
    memory: memory ? {
      activeMessages: JSON.parse(memory.active_messages),
      compactedSummary: memory.compacted_summary,
      totalExchanges: memory.total_exchanges,
      lastCompactionAt: memory.last_compaction_at
    } : null
  };
}

// Memory persistence
async storeConversationMemory(
  conversationId: string, 
  memory: ConversationMemory
): Promise<void> {
  await this.database.run(`
    INSERT OR REPLACE INTO conversation_memory 
    (conversation_id, active_messages, compacted_summary, total_exchanges, 
     last_compaction_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    conversationId,
    JSON.stringify(memory.activeMessages),
    memory.compactedSummary,
    memory.totalExchanges,
    memory.lastCompactionAt,
    new Date().toISOString(),
    new Date().toISOString()
  ]);
}
```

## Configuration & Settings

### Service Configuration

```typescript
// Chat Service Configuration
interface ChatServiceConfig {
  // Conversation modes
  defaultMode: 'vector' | 'rag' | 'direct';
  allowModeSwitch: boolean;
  
  // Context management
  contextChunks: number;                 // Default: 4
  maxContextLength: number;              // Default: 4000 chars
  memoryReserveFactor: number;           // Default: 0.2 (20%)
  
  // Memory management
  conversationMemoryLimit: number;       // Default: 20 messages
  enableMemoryCompaction: boolean;       // Default: true
  compactionStrategy: 'auto' | 'manual';
  
  // Performance settings
  enableResponseStreaming: boolean;      // Default: true
  maxConcurrentRequests: number;         // Default: 3
  requestTimeout: number;                // Default: 30000ms
  
  // RAG settings
  vectorSearchThreshold: number;         // Default: 0.7
  enableSourceAttribution: boolean;      // Default: true
  includeTimestamps: boolean;           // Default: true
}

// Project Chat Configuration  
interface ProjectChatConfig {
  // Analysis settings
  defaultAnalysisMode: 'collated' | 'cross_transcript' | 'hybrid';
  maxTranscriptsPerAnalysis: number;     // Default: 10
  
  // Transcript selection
  transcriptSelectionStrategy: 'recent' | 'relevant' | 'all';
  relevanceThreshold: number;            // Default: 0.6
  
  // Cross-transcript analysis
  enableCrossTranscriptAnalysis: boolean;
  patternDetectionThreshold: number;     // Default: 0.8
  consensusThreshold: number;            // Default: 0.6
}

// Model Metadata Configuration
interface ModelMetadataConfig {
  // Detection settings
  enableDynamicDetection: boolean;       // Default: true
  cacheExpirationMinutes: number;        // Default: 30
  fallbackContextLimit: number;          // Default: 4096
  
  // API settings
  apiTimeout: number;                    // Default: 5000ms
  retryAttempts: number;                 // Default: 3
  
  // Context optimization
  safetyMarginFactor: number;           // Default: 0.1 (10%)
  enableContextValidation: boolean;      // Default: true
}
```

### Settings Management

```typescript
class SettingsManager {
  async updateChatSettings(settings: Partial<ChatServiceConfig>): Promise<void> {
    // Validate settings
    this.validateChatSettings(settings);
    
    // Store in database
    for (const [key, value] of Object.entries(settings)) {
      await this.database.run(
        'INSERT OR REPLACE INTO settings (key, value, category) VALUES (?, ?, ?)',
        [`chat_${key}`, JSON.stringify(value), 'chat']
      );
    }
    
    // Notify services of changes
    chatService.updateConfig(settings);
    projectChatService.updateConfig(settings);
  }
  
  async loadChatSettings(): Promise<ChatServiceConfig> {
    const settings = await this.database.all(
      'SELECT key, value FROM settings WHERE category = ? AND key LIKE ?',
      ['chat', 'chat_%']
    );
    
    const config = this.getDefaultChatConfig();
    
    settings.forEach(setting => {
      const key = setting.key.replace('chat_', '');
      config[key] = JSON.parse(setting.value);
    });
    
    return config;
  }
}
```

## Performance Optimizations

### Caching Strategies

```typescript
// Model metadata caching
class ModelMetadataCache {
  private cache = new Map<string, CachedModelMetadata>();
  private readonly TTL = 30 * 60 * 1000; // 30 minutes
  
  async get(modelName: string): Promise<ModelMetadata | null> {
    const cached = this.cache.get(modelName);
    
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.metadata;
    }
    
    // Load from database
    const stored = await this.database.get(
      'SELECT * FROM model_metadata WHERE model_name = ? AND expires_at > ?',
      [modelName, new Date().toISOString()]
    );
    
    if (stored) {
      const metadata = JSON.parse(stored.capabilities);
      this.cache.set(modelName, { metadata, timestamp: Date.now() });
      return metadata;
    }
    
    return null;
  }
}

// Conversation memory caching
class ConversationMemoryCache {
  private cache = new Map<string, ConversationMemory>();
  
  async get(conversationId: string): Promise<ConversationMemory | null> {
    // Check in-memory cache first
    if (this.cache.has(conversationId)) {
      return this.cache.get(conversationId)!;
    }
    
    // Load from database
    const stored = await this.loadConversationMemory(conversationId);
    if (stored) {
      this.cache.set(conversationId, stored);
    }
    
    return stored;
  }
  
  set(conversationId: string, memory: ConversationMemory): void {
    this.cache.set(conversationId, memory);
    // Async persistence
    this.storeConversationMemory(conversationId, memory);
  }
}
```

### Async Processing

```typescript
// Streaming response generation
async *streamChatResponse(
  transcriptId: string,
  userMessage: string,
  conversationId: string
): AsyncGenerator<ChatResponseChunk> {
  // 1. Immediate acknowledgment
  yield { type: 'status', message: 'Processing your question...' };
  
  // 2. Context building
  yield { type: 'status', message: 'Searching relevant content...' };
  const context = await this.buildContext(transcriptId, userMessage);
  
  // 3. Memory management (parallel)
  const memoryPromise = this.manageConversationMemory(conversationId);
  yield { type: 'status', message: 'Preparing response...' };
  
  // 4. LLM generation with streaming
  const memory = await memoryPromise;
  const prompt = this.buildPrompt(context, memory, userMessage);
  
  yield { type: 'status', message: 'Generating response...' };
  
  // 5. Stream LLM response
  for await (const chunk of this.llmService.streamGenerate(prompt)) {
    yield { type: 'content', text: chunk };
  }
  
  // 6. Finalization
  yield { type: 'complete', sources: context.sources };
}

// Background embedding computation
class BackgroundEmbeddingProcessor {
  private queue: TranscriptChunk[] = [];
  private processing = false;
  
  async enqueue(chunks: TranscriptChunk[]): Promise<void> {
    this.queue.push(...chunks);
    if (!this.processing) {
      this.processQueue();
    }
  }
  
  private async processQueue(): Promise<void> {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 10); // Process in batches
      
      await Promise.all(batch.map(async chunk => {
        try {
          const embedding = await embeddingService.generateEmbedding(chunk);
          await vectorStoreService.store(embedding);
        } catch (error) {
          console.error('Failed to process chunk:', chunk.id, error);
          // Re-queue failed chunks
          this.queue.push(chunk);
        }
      }));
      
      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    this.processing = false;
  }
}
```

### Resource Management

```typescript
// Context-aware request queuing
class RequestQueue {
  private activeRequests = new Set<string>();
  private queue: QueuedRequest[] = [];
  private readonly maxConcurrent = 3;
  
  async enqueue(request: ChatRequest): Promise<ChatMessage> {
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        ...request,
        resolve,
        reject,
        priority: this.calculatePriority(request),
        enqueuedAt: Date.now()
      };
      
      this.queue.push(queuedRequest);
      this.queue.sort((a, b) => b.priority - a.priority);
      
      this.processQueue();
    });
  }
  
  private async processQueue(): Promise<void> {
    if (this.activeRequests.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    
    const request = this.queue.shift()!;
    const requestId = this.generateRequestId();
    
    this.activeRequests.add(requestId);
    
    try {
      const response = await this.executeRequest(request);
      request.resolve(response);
    } catch (error) {
      request.reject(error);
    } finally {
      this.activeRequests.delete(requestId);
      this.processQueue(); // Process next request
    }
  }
  
  private calculatePriority(request: ChatRequest): number {
    // Prioritize based on:
    // - User interaction (higher priority)
    // - Request complexity (lower priority for heavy requests)
    // - Queue wait time (aging factor)
    return request.isUserInitiated ? 10 : 5;
  }
}
```

## Implementation Patterns

### 1. Singleton Pattern

All services use singleton pattern for state consistency:

```typescript
class ChatService {
  private static instance: ChatService;
  
  static getInstance(): ChatService {
    if (!ChatService.instance) {
      ChatService.instance = new ChatService();
    }
    return ChatService.instance;
  }
  
  private constructor() {
    // Initialize service
  }
}

// Usage
export const chatService = ChatService.getInstance();
```

### 2. Factory Pattern

For creating different analysis strategies:

```typescript
class AnalysisStrategyFactory {
  static create(mode: AnalysisMode, config: ProjectChatConfig): AnalysisStrategy {
    switch (mode) {
      case 'collated':
        return new CollatedAnalysisStrategy(config);
      case 'cross_transcript':
        return new CrossTranscriptAnalysisStrategy(config);
      case 'hybrid':
        return new HybridAnalysisStrategy(config);
      default:
        throw new Error(`Unknown analysis mode: ${mode}`);
    }
  }
}
```

### 3. Observer Pattern

For configuration updates:

```typescript
class ConfigurationManager {
  private observers: ConfigObserver[] = [];
  
  subscribe(observer: ConfigObserver): void {
    this.observers.push(observer);
  }
  
  async updateSettings(settings: SystemSettings): Promise<void> {
    await this.persistSettings(settings);
    
    // Notify all observers
    this.observers.forEach(observer => {
      observer.onConfigUpdate(settings);
    });
  }
}

// Services implement ConfigObserver
class ChatService implements ConfigObserver {
  onConfigUpdate(settings: SystemSettings): void {
    this.config = { ...this.config, ...settings.chat };
    this.reinitializeIfNeeded();
  }
}
```

### 4. Strategy Pattern

For conversation modes:

```typescript
interface ConversationStrategy {
  execute(
    transcript: Transcript,
    userMessage: string,
    memory: ConversationMemory
  ): Promise<ChatMessage>;
}

class RAGStrategy implements ConversationStrategy {
  async execute(transcript, userMessage, memory): Promise<ChatMessage> {
    // RAG-specific implementation
  }
}

class VectorOnlyStrategy implements ConversationStrategy {
  async execute(transcript, userMessage, memory): Promise<ChatMessage> {
    // Vector-only implementation
  }
}

class DirectLLMStrategy implements ConversationStrategy {
  async execute(transcript, userMessage, memory): Promise<ChatMessage> {
    // Direct LLM implementation
  }
}
```

## API Reference

### ChatService API

```typescript
interface ChatServiceAPI {
  // Core chat methods
  chatWithTranscript(
    transcriptId: string,
    conversationId: string,
    userMessage: string,
    conversationHistory: ChatMessage[]
  ): Promise<ChatMessage>;
  
  // Conversation management
  createConversation(transcriptId: string): Promise<string>;
  loadConversation(conversationId: string): Promise<ChatMessage[]>;
  deleteConversation(conversationId: string): Promise<void>;
  
  // Memory management
  compactConversationMemory(conversationId: string): Promise<void>;
  getConversationMemory(conversationId: string): Promise<ConversationMemory | null>;
  
  // Mode switching
  switchConversationMode(mode: ConversationMode): void;
  getCurrentMode(): ConversationMode;
  
  // Configuration
  updateConfig(config: Partial<ChatServiceConfig>): void;
  getConfig(): ChatServiceConfig;
}
```

### ProjectChatService API

```typescript
interface ProjectChatServiceAPI {
  // Project chat methods
  chatWithProject(
    projectId: string,
    conversationId: string,
    userMessage: string,
    conversationHistory: ProjectChatMessage[]
  ): Promise<ProjectChatMessage>;
  
  // Analysis methods
  analyzeProject(
    projectId: string,
    analysisType: AnalysisMode
  ): Promise<ProjectAnalysisResult>;
  
  // Transcript selection
  selectRelevantTranscripts(
    projectId: string,
    userMessage: string,
    strategy: TranscriptSelectionStrategy
  ): Promise<TranscriptSelection[]>;
  
  // Configuration
  updateConfig(config: Partial<ProjectChatConfig>): void;
  setAnalysisMode(mode: AnalysisMode): void;
  setTranscriptSelectionStrategy(strategy: TranscriptSelectionStrategy): void;
}
```

### ModelMetadataService API

```typescript
interface ModelMetadataServiceAPI {
  // Model detection
  getModelMetadata(modelName: string): Promise<ModelMetadata>;
  detectModelFamily(modelName: string): ModelFamily;
  refreshModelMetadata(modelName: string): Promise<ModelMetadata>;
  
  // Context management
  calculateContextBudget(
    modelMetadata: ModelMetadata,
    memoryReserveFactor?: number
  ): ContextBudget;
  
  validateContextUsage(
    content: string,
    memory: string,
    modelName?: string
  ): ContextValidation;
  
  // Optimization
  getOptimizationRecommendations(
    contextUsage: ContextValidation
  ): OptimizationRecommendation[];
  
  // Configuration
  updateConfig(config: Partial<ModelMetadataConfig>): void;
  clearCache(): void;
}
```

## Best Practices

### 1. Context Management

```typescript
// ✅ Good: Always validate context before requests
const validation = await modelMetadataService.validateContextUsage(
  transcriptContent, 
  conversationMemory
);

if (!validation.fits) {
  // Switch to RAG mode or apply truncation
  return await this.handleContextOverflow(validation);
}

// ✅ Good: Reserve memory for conversation history
const budget = modelMetadataService.calculateContextBudget(
  modelMetadata, 
  0.2 // 20% for memory
);
```

### 2. Memory Management

```typescript
// ✅ Good: Regular memory compaction
if (messages.length > this.config.conversationMemoryLimit) {
  await this.performMemoryCompaction(conversationId, messages);
}

// ✅ Good: Graceful fallback for compaction
try {
  const aiSummary = await this.generateAISummary(messagesToCompact);
  return aiSummary;
} catch (error) {
  console.warn('AI summarization failed, using fallback:', error);
  return this.createFallbackSummary(messagesToCompact);
}
```

### 3. Error Handling

```typescript
// ✅ Good: Comprehensive error handling with fallbacks
async chatWithTranscript(transcriptId: string, userMessage: string): Promise<ChatMessage> {
  try {
    // Attempt RAG mode
    return await this.performRAGChat(transcriptId, userMessage);
  } catch (ragError) {
    console.warn('RAG mode failed, trying vector-only:', ragError);
    
    try {
      // Fallback to vector-only
      return await this.performVectorOnlyChat(transcriptId, userMessage);
    } catch (vectorError) {
      console.error('Vector search failed, using direct response:', vectorError);
      
      // Final fallback
      return {
        role: 'assistant',
        content: 'I encountered an issue processing your request. Please try rephrasing your question.',
        created_at: new Date().toISOString()
      };
    }
  }
}
```

### 4. Performance Optimization

```typescript
// ✅ Good: Parallel processing where possible
const [searchResults, memory, modelMetadata] = await Promise.all([
  vectorStoreService.searchSimilar(transcriptId, userMessage),
  this.getConversationMemory(conversationId),
  modelMetadataService.getModelMetadata(this.currentModel)
]);

// ✅ Good: Streaming for long operations
async *streamResponse(request: ChatRequest): AsyncGenerator<ChatChunk> {
  yield { type: 'status', message: 'Processing...' };
  
  const context = await this.buildContext(request);
  yield { type: 'context_ready', sources: context.sources };
  
  for await (const chunk of this.llmService.stream(context.prompt)) {
    yield { type: 'content', text: chunk };
  }
  
  yield { type: 'complete' };
}
```

### 5. Configuration Management

```typescript
// ✅ Good: Validate configuration changes
updateConfig(newConfig: Partial<ChatServiceConfig>): void {
  const validatedConfig = this.validateConfig({
    ...this.config,
    ...newConfig
  });
  
  this.config = validatedConfig;
  this.reinitializeServicesIfNeeded();
}

// ✅ Good: Provide sensible defaults
private getDefaultConfig(): ChatServiceConfig {
  return {
    defaultMode: 'rag',
    contextChunks: 4,
    maxContextLength: 4000,
    conversationMemoryLimit: 20,
    enableMemoryCompaction: true,
    vectorSearchThreshold: 0.7,
    // ... other defaults
  };
}
```

---

This architecture provides a robust, scalable foundation for implementing intelligent chat systems with RAG capabilities. The modular design, comprehensive error handling, and performance optimizations make it suitable for adaptation to other Electron applications requiring similar AI-powered conversational interfaces.