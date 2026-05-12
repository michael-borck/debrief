# RAG System Architecture for Electron Applications

> ⚠️ **Partially stale.** Predates Sprint 3 (2026-05). Current state:
>
> - Transcription/diarisation run in the bundled Python sidecar
>   (`lens/speech-analyser`). The in-process Whisper / `@xenova/transformers`
>   pipeline described below is gone.
> - Embeddings are real — `sentence-transformers/all-MiniLM-L6-v2` via the
>   sidecar `/embed` endpoint. The `simpleTextEmbedding` placeholder is gone.
> - UI mode labels are **Find quotes** / **Ask AI** / **Read whole transcript**.
>
> The RAG flow described below is broadly correct in shape but uses older
> component names. See [features/ai-chat.md](features/ai-chat.md) for the
> current user-facing description.

## Overview

This document describes a complete Retrieval-Augmented Generation (RAG) system implementation for Electron applications. The system provides local, privacy-first chat functionality with document content using embedded vector databases and local language models.

## Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Application                     │
├─────────────────────────────────────────────────────────────┤
│  React Frontend                                             │
│  ├── Chat Interface Components                              │
│  ├── Settings Configuration                                 │
│  └── Progress Indicators                                    │
├─────────────────────────────────────────────────────────────┤
│  Service Layer                                              │
│  ├── ChatService (Orchestration)                           │
│  ├── EmbeddingService (Local Model)                        │
│  ├── ChunkingService (Content Processing)                  │
│  └── VectorStoreService (LanceDB)                          │
├─────────────────────────────────────────────────────────────┤
│  Storage Layer                                              │
│  ├── SQLite (Metadata & Chat History)                      │
│  ├── LanceDB (Vector Embeddings)                           │
│  └── Local Files (Documents)                               │
├─────────────────────────────────────────────────────────────┤
│  External Services                                          │
│  └── Ollama (LLM for Response Generation)                  │
└─────────────────────────────────────────────────────────────┘
```

## Core Services

### 1. EmbeddingService

**Purpose**: Generates vector embeddings using local transformer models.

**Key Features**:
- Uses `@xenova/transformers` for browser-compatible model execution
- Default model: `all-MiniLM-L6-v2` (384 dimensions, ~25MB)
- Automatic model downloading with progress tracking
- Singleton pattern for memory efficiency
- Batch processing support

```typescript
interface EmbeddingConfig {
  model: string;           // Default: 'Xenova/all-MiniLM-L6-v2'
  maxLength: number;       // Default: 512 tokens
  normalize: boolean;      // Default: true
}

interface EmbeddingResult {
  embedding: number[];     // 384-dimensional vector
  text: string;           // Source text
  metadata?: Record<string, any>;
}
```

**Implementation Details**:
```typescript
// Initialize with progress callback
await embeddingService.initialize((progress) => {
  console.log(`${progress.status}: ${progress.loaded}/${progress.total}`);
});

// Generate embeddings
const result = await embeddingService.embedText("Sample text", metadata);
const batchResults = await embeddingService.embedBatch(textArray, metadataArray);
```

### 2. ChunkingService

**Purpose**: Splits large documents into semantically meaningful chunks for embedding.

**Chunking Strategies**:

1. **Speaker-based** (Recommended for transcripts)
   - Splits on speaker turn changes
   - Maintains conversational context
   - Fallback to time-based if chunks too large

2. **Time-based**
   - Fixed duration chunks with configurable overlap
   - Good for consistent processing
   - Overlap prevents context loss

3. **Hybrid**
   - Speaker-based with time constraints
   - Best of both approaches
   - Automatically splits large speaker segments

```typescript
interface ChunkingConfig {
  method: 'speaker' | 'time' | 'hybrid';
  maxChunkSize: number;    // seconds (default: 60)
  chunkOverlap: number;    // seconds (default: 10)
  minChunkSize: number;    // seconds (default: 5)
}

interface TextChunk {
  id: string;
  transcriptId: string;
  text: string;
  startTime: number;
  endTime: number;
  speaker?: string;
  metadata: {
    chunkIndex: number;
    wordCount: number;
    speakers: string[];
    method: string;
  };
}
```

### 3. VectorStoreService

**Purpose**: Stores and retrieves vector embeddings using LanceDB.

**Key Features**:
- Embedded LanceDB (no external database server)
- Vector similarity search with filtering
- Metadata-based queries (time range, speaker, etc.)
- Automatic schema management
- Bulk operations for efficiency

```typescript
interface SearchOptions {
  limit?: number;          // Default: 5
  minScore?: number;       // Default: 0.0
  transcriptId?: string;   // Filter by source
  speaker?: string;        // Filter by speaker
  timeRange?: { start: number; end: number };
}

interface SearchResult {
  chunk: VectorChunk;
  score: number;           // Similarity score (0-1)
  rank: number;           // Result ranking
}
```

**Vector Schema**:
```typescript
interface VectorChunk {
  id: string;
  transcriptId: string;
  text: string;
  vector: number[];        // 384-dimensional embedding
  startTime: number;
  endTime: number;
  speaker?: string;
  chunkIndex: number;
  wordCount: number;
  speakers: string[];
  method: string;
  createdAt: string;
}
```

### 4. ChatService

**Purpose**: Orchestrates the complete RAG pipeline and manages conversations.

**Core Workflow**:
1. **Document Processing** → Chunking → Embedding → Vector Storage
2. **Query Processing** → Embed Query → Vector Search → Context Building
3. **Response Generation** → LLM Call → Response Processing → History Storage

```typescript
interface ChatConfig {
  contextChunks: number;           // Default: 4
  conversationMemoryLimit: number; // Default: 20
  autoReembed: boolean;           // Default: true
  precomputeEmbeddings: boolean;  // Default: true
  chunkingMethod: 'speaker' | 'time' | 'hybrid';
  maxChunkSize: number;           // Default: 60s
  chunkOverlap: number;           // Default: 10s
}
```

## RAG Pipeline Implementation

### Document Processing Pipeline

```typescript
async function processDocumentForChat(
  document: Document,
  segments: DocumentSegment[],
  onProgress?: (progress: ProcessingProgress) => void
): Promise<void> {
  
  // 1. Chunking Phase
  onProgress?.({ stage: 'chunking', progress: 0, message: 'Analyzing structure...' });
  const chunks = chunkingService.chunkDocument(document.id, segments, document.fullText);
  
  // 2. Embedding Phase
  const embeddings = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embeddingService.embedText(chunks[i].text);
    embeddings.push(embedding);
    onProgress?.({ 
      stage: 'embedding', 
      progress: i + 1, 
      total: chunks.length,
      message: `Embedded chunk ${i + 1}/${chunks.length}` 
    });
  }
  
  // 3. Storage Phase
  onProgress?.({ stage: 'storing', progress: 0, message: 'Storing vectors...' });
  await vectorStoreService.storeChunks(chunks, embeddings);
  
  onProgress?.({ stage: 'complete', progress: 100, message: 'Ready for chat!' });
}
```

### Query Processing Pipeline

```typescript
async function chatWithDocument(
  documentId: string,
  conversationId: string,
  userMessage: string,
  conversationHistory: ChatMessage[]
): Promise<ChatMessage> {
  
  // 1. Generate query embedding
  const questionEmbedding = await embeddingService.embedText(userMessage);
  
  // 2. Retrieve relevant chunks
  const searchResults = await vectorStoreService.searchSimilar(
    questionEmbedding.embedding,
    {
      limit: config.contextChunks,
      transcriptId: documentId,
      minScore: 0.1
    }
  );
  
  // 3. Build context from chunks and conversation history
  const context = buildContext(searchResults, conversationHistory);
  
  // 4. Generate response
  const response = await generateResponse(context, userMessage, documentId);
  
  // 5. Store and return message
  const assistantMessage = {
    id: generateId(),
    role: 'assistant',
    content: response,
    timestamp: new Date().toISOString(),
    metadata: { chunks: searchResults, processingTime: Date.now() - startTime }
  };
  
  await storeChatMessage(conversationId, assistantMessage);
  return assistantMessage;
}
```

### Context Building Strategy

```typescript
function buildContext(
  searchResults: SearchResult[], 
  conversationHistory: ChatMessage[]
): string {
  let context = '';

  // Add relevant document chunks
  if (searchResults.length > 0) {
    context += 'RELEVANT DOCUMENT CONTENT:\n\n';
    searchResults.forEach((result, index) => {
      const timeStamp = formatTime(result.chunk.startTime);
      const speaker = result.chunk.speaker ? `[${result.chunk.speaker}]` : '';
      context += `[${timeStamp}] ${speaker} ${result.chunk.text}\n\n`;
    });
  }

  // Add recent conversation history
  if (conversationHistory.length > 0) {
    context += '\nRECENT CONVERSATION:\n\n';
    const recentMessages = conversationHistory.slice(-6); // Last 3 exchanges
    recentMessages.forEach(msg => {
      context += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
    });
  }

  return context;
}
```

## Conversation Memory Management

### Memory Compaction Strategy

```typescript
interface ConversationMemory {
  activeMessages: ChatMessage[];     // Recent messages (keep as-is)
  compactedSummary: string;         // Summarized older conversation
  totalExchanges: number;           // Track conversation length
}

async function manageConversationMemory(
  conversationId: string,
  messages: ChatMessage[],
  memoryLimit: number
): Promise<ConversationMemory> {
  
  if (messages.length <= memoryLimit) {
    return {
      activeMessages: messages,
      compactedSummary: '',
      totalExchanges: messages.length
    };
  }

  // Keep recent messages
  const keepCount = Math.floor(memoryLimit * 0.4); // Keep last 40%
  const activeMessages = messages.slice(-keepCount);
  
  // Compact older messages
  const messagesToCompact = messages.slice(0, -keepCount);
  const compactedSummary = await compactMessages(messagesToCompact);
  
  return {
    activeMessages,
    compactedSummary,
    totalExchanges: messages.length
  };
}

async function compactMessages(messages: ChatMessage[]): Promise<string> {
  const conversationText = messages
    .map(msg => `${msg.role}: ${msg.content}`)
    .join('\n');
    
  const compactionPrompt = `
    Summarize this conversation concisely, preserving key topics and conclusions:
    
    ${conversationText}
    
    Summary (2-3 bullets max):
  `;
  
  const summary = await generateResponse(compactionPrompt, '', '');
  return summary;
}
```

### Enhanced Context Building with Memory

```typescript
function buildContextWithMemory(
  searchResults: SearchResult[],
  memory: ConversationMemory
): string {
  let context = '';

  // Add document chunks
  if (searchResults.length > 0) {
    context += 'RELEVANT DOCUMENT CONTENT:\n\n';
    searchResults.forEach(result => {
      context += `${result.chunk.text}\n\n`;
    });
  }

  // Add compacted conversation summary
  if (memory.compactedSummary) {
    context += 'CONVERSATION SUMMARY:\n\n';
    context += `${memory.compactedSummary}\n\n`;
  }

  // Add recent messages
  if (memory.activeMessages.length > 0) {
    context += 'RECENT CONVERSATION:\n\n';
    memory.activeMessages.forEach(msg => {
      context += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
    });
  }

  return context;
}
```

## Configuration Management

### Settings Integration

```typescript
interface RAGSettings {
  // Embedding Settings
  embeddingModel: string;
  
  // Chunking Settings
  chunkingMethod: 'speaker' | 'time' | 'hybrid';
  maxChunkSize: number;      // 30-180 seconds
  chunkOverlap: number;      // 0-30 seconds
  
  // Chat Settings
  contextChunks: number;     // 1-10 chunks
  conversationMemoryLimit: number; // 5-50 messages
  
  // Performance Settings
  precomputeEmbeddings: boolean;
  autoReembed: boolean;
}

// Database schema for settings
const defaultSettings = {
  'ragEmbeddingModel': 'Xenova/all-MiniLM-L6-v2',
  'ragChunkingMethod': 'speaker',
  'ragMaxChunkSize': '60',
  'ragChunkOverlap': '10',
  'ragContextChunks': '4',
  'ragMemoryLimit': '20',
  'ragPrecomputeEmbeddings': 'true',
  'ragAutoReembed': 'true'
};
```

### Settings UI Components

```typescript
// Example settings component
function RAGSettingsPanel() {
  return (
    <div className="space-y-6">
      <h3>Chat & AI Settings</h3>
      
      {/* Context Chunks Slider */}
      <div>
        <label>Context Chunks: {contextChunks}</label>
        <input
          type="range"
          min="1"
          max="10"
          value={contextChunks}
          onChange={(e) => {
            setContextChunks(parseInt(e.target.value));
            saveSetting('ragContextChunks', e.target.value);
          }}
        />
        <p className="help-text">
          Number of relevant chunks to include in chat context
        </p>
      </div>
      
      {/* Chunking Method Select */}
      <div>
        <label>Chunking Method</label>
        <select value={chunkingMethod} onChange={handleMethodChange}>
          <option value="speaker">Speaker-based</option>
          <option value="time">Time-based</option>
          <option value="hybrid">Hybrid</option>
        </select>
      </div>
      
      {/* Memory Limit Slider */}
      <div>
        <label>Memory Limit: {memoryLimit} messages</label>
        <input
          type="range"
          min="5"
          max="50"
          step="5"
          value={memoryLimit}
          onChange={handleMemoryLimitChange}
        />
      </div>
    </div>
  );
}
```

## Database Schema

### SQLite Tables for Metadata

```sql
-- Chat conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    summary TEXT,
    total_exchanges INTEGER DEFAULT 0,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT, -- JSON metadata
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

-- Conversation memory (for compacted summaries)
CREATE TABLE IF NOT EXISTS conversation_memory (
    conversation_id TEXT PRIMARY KEY,
    compacted_summary TEXT,
    active_message_count INTEGER DEFAULT 0,
    last_compaction_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### LanceDB Schema

```typescript
// Vector table schema (handled automatically by LanceDB)
interface VectorTableSchema {
  id: string;               // Unique chunk identifier
  document_id: string;      // Source document reference
  text: string;            // Chunk text content
  vector: number[];        // 384-dimensional embedding
  start_time: number;      // Time offset (for media)
  end_time: number;        // End time offset
  speaker?: string;        // Speaker identifier
  chunk_index: number;     // Chunk sequence number
  word_count: number;      // Text statistics
  speakers: string[];      // All speakers in chunk
  method: string;          // Chunking method used
  created_at: string;      // Timestamp
}
```

## Performance Optimization

### Embedding Model Management

```typescript
class EmbeddingModelManager {
  private modelCache = new Map<string, Pipeline>();
  
  async getModel(modelName: string): Promise<Pipeline> {
    if (this.modelCache.has(modelName)) {
      return this.modelCache.get(modelName)!;
    }
    
    const model = await pipeline('feature-extraction', modelName);
    this.modelCache.set(modelName, model);
    return model;
  }
  
  // Preload model on app startup
  async warmup(modelName: string): Promise<void> {
    await this.getModel(modelName);
  }
  
  // Memory cleanup
  clearCache(): void {
    this.modelCache.clear();
  }
}
```

### Batch Processing

```typescript
async function batchProcessDocuments(
  documents: Document[],
  batchSize: number = 5
): Promise<void> {
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(doc => processDocumentForChat(doc))
    );
    
    // Progress update
    const progress = Math.min(i + batchSize, documents.length);
    console.log(`Processed ${progress}/${documents.length} documents`);
  }
}
```

### Vector Search Optimization

```typescript
// Implement search result caching
class SearchCache {
  private cache = new Map<string, { results: SearchResult[]; timestamp: number }>();
  private maxAge = 5 * 60 * 1000; // 5 minutes
  
  get(query: string): SearchResult[] | null {
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      return cached.results;
    }
    return null;
  }
  
  set(query: string, results: SearchResult[]): void {
    this.cache.set(query, { results, timestamp: Date.now() });
  }
}
```

## Error Handling & Recovery

### Robust Service Initialization

```typescript
async function initializeRAGSystem(retries: number = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Initialize embedding service
      await embeddingService.initialize();
      
      // Initialize vector store
      await vectorStoreService.initialize();
      
      // Test functionality
      await embeddingService.embedText("test");
      
      return true;
    } catch (error) {
      console.error(`Initialization attempt ${attempt} failed:`, error);
      
      if (attempt === retries) {
        throw new Error(`Failed to initialize RAG system after ${retries} attempts`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  return false;
}
```

### Graceful Degradation

```typescript
async function chatWithFallback(
  documentId: string,
  userMessage: string,
  conversationHistory: ChatMessage[]
): Promise<ChatMessage> {
  try {
    // Try full RAG pipeline
    return await chatWithDocument(documentId, userMessage, conversationHistory);
  } catch (error) {
    console.error('RAG pipeline failed, falling back to simple chat:', error);
    
    try {
      // Fallback: use document text directly (no vector search)
      const document = await getDocument(documentId);
      const simpleContext = document.fullText.slice(0, 2000); // First 2000 chars
      return await generateSimpleResponse(simpleContext, userMessage);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      
      // Final fallback: error message
      return {
        id: generateId(),
        role: 'assistant',
        content: 'I apologize, but I encountered an error processing your question. Please try again.',
        timestamp: new Date().toISOString(),
        metadata: { error: true }
      };
    }
  }
}
```

## Deployment Considerations

### Electron Integration

```javascript
// In main process (electron.js)
ipcMain.handle('rag-initialize', async () => {
  try {
    await ragSystem.initialize();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rag-chat', async (event, { documentId, message, conversationId }) => {
  try {
    const response = await ragSystem.chat(documentId, message, conversationId);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### Resource Management

```typescript
// Monitor memory usage
function monitorResourceUsage(): void {
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    const vectorStats = vectorStoreService.getStats();
    
    console.log({
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
      totalVectors: vectorStats.totalChunks,
      cacheSize: embeddingService.getCacheSize()
    });
    
    // Cleanup if memory usage too high
    if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
      embeddingService.clearCache();
    }
  }, 30000); // Every 30 seconds
}
```

### Data Directory Structure

```
app-data/
├── database/
│   ├── app.db              # SQLite database
│   └── vectors/            # LanceDB files
│       ├── transcript_chunks.lance
│       └── .lance/
├── models/
│   └── embeddings/         # Downloaded models
│       └── Xenova--all-MiniLM-L6-v2/
├── temp/                   # Temporary processing files
└── backups/               # Database backups
```

## Security Considerations

### Data Privacy

- All embeddings and vectors stored locally
- No data sent to external services except LLM queries
- User documents never leave the device
- Configurable data retention policies

### Input Sanitization

```typescript
function sanitizeInput(text: string): string {
  // Remove potentially harmful content
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, 10000); // Limit length
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('EmbeddingService', () => {
  test('should generate consistent embeddings', async () => {
    const text = "Test document content";
    const result1 = await embeddingService.embedText(text);
    const result2 = await embeddingService.embedText(text);
    
    expect(result1.embedding).toEqual(result2.embedding);
    expect(result1.embedding).toHaveLength(384);
  });
});

describe('ChunkingService', () => {
  test('should create appropriate chunks', () => {
    const segments = mockTranscriptSegments;
    const chunks = chunkingService.chunkTranscript('test-id', segments);
    
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.method).toBe('speaker');
  });
});
```

### Integration Tests

```typescript
describe('RAG Pipeline', () => {
  test('should process document and enable chat', async () => {
    const document = mockDocument;
    
    // Process document
    await chatService.processDocumentForChat(document, []);
    
    // Verify chunks stored
    const stats = await vectorStoreService.getStats();
    expect(stats.transcripts).toContain(document.id);
    
    // Test chat
    const response = await chatService.chatWithDocument(
      document.id,
      'conversation-1',
      'What is this document about?',
      []
    );
    
    expect(response.content).toBeTruthy();
    expect(response.role).toBe('assistant');
  });
});
```

## Migration and Upgrades

### Schema Migrations

```typescript
const migrations = [
  {
    version: 1,
    up: async (db: Database) => {
      await db.exec(`
        CREATE TABLE chat_conversations (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 2,
    up: async (db: Database) => {
      await db.exec(`
        ALTER TABLE chat_conversations 
        ADD COLUMN summary TEXT;
      `);
    }
  }
];
```

### Model Updates

```typescript
async function updateEmbeddingModel(
  oldModel: string, 
  newModel: string
): Promise<void> {
  // 1. Download new model
  await embeddingService.downloadModel(newModel);
  
  // 2. Re-embed existing documents
  const documents = await getAllDocuments();
  for (const doc of documents) {
    await reprocessDocument(doc.id, newModel);
  }
  
  // 3. Update configuration
  await updateSetting('embeddingModel', newModel);
  
  // 4. Cleanup old model
  await embeddingService.removeModel(oldModel);
}
```

This RAG system provides a complete, production-ready solution for adding AI chat capabilities to any Electron application while maintaining privacy and performance through local processing.