import { embeddingService } from './embeddingService';
import { chunkingService } from './chunkingService';
import { vectorStoreService, SearchResult } from './vectorStoreService';
import { promptService } from './promptService';
import { modelMetadataService, ModelMetadata, ModelContextBudget } from './modelMetadataService';
import { Transcript, TranscriptSegment } from '../types';

export type ConversationMode = 'vector-only' | 'rag' | 'direct-llm';

export interface ChatConfig {
  contextChunks: number;
  conversationMemoryLimit: number;
  autoReembed: boolean;
  precomputeEmbeddings: boolean;
  chunkingMethod: 'speaker' | 'time' | 'hybrid';
  maxChunkSize: number;
  chunkOverlap: number;
  conversationMode: ConversationMode;
  directLlmContextLimit: number; // Max characters for direct mode (fallback)
  vectorOnlyChunkCount: number;  // Number of chunks for vector-only mode
  dynamicContextManagement: boolean; // Enable dynamic context management
  memoryReserveFactor: number; // Fraction of context to reserve for memory (0.0-1.0)
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    chunks?: SearchResult[];
    processingTime?: number;
    model?: string;
    mode?: ConversationMode;
  };
}

export interface ConversationMemory {
  activeMessages: ChatMessage[];     // Recent messages (keep as-is)
  compactedSummary: string;         // Summarized older conversation
  totalExchanges: number;           // Track conversation length
  lastCompactionAt?: string;        // When last compacted
}

export interface ChatConversation {
  id: string;
  transcriptId: string;
  messages: ChatMessage[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingProgress {
  stage: 'chunking' | 'embedding' | 'storing' | 'complete';
  progress: number;
  total: number;
  message: string;
}

export class ChatService {
  private static instance: ChatService;
  private config: ChatConfig;
  private isInitialized = false;
  private currentModelMetadata: ModelMetadata | null = null;
  private currentContextBudget: ModelContextBudget | null = null;

  private constructor() {
    this.config = {
      contextChunks: 4,
      conversationMemoryLimit: 20,
      autoReembed: true,
      precomputeEmbeddings: true,
      chunkingMethod: 'speaker',
      maxChunkSize: 60,
      chunkOverlap: 10,
      conversationMode: 'rag', // Default to current behavior
      directLlmContextLimit: 8000, // ~8k characters for direct mode (fallback)
      vectorOnlyChunkCount: 5, // Show 5 most relevant chunks for vector-only
      dynamicContextManagement: true, // Enable by default
      memoryReserveFactor: 0.2 // Reserve 20% for conversation memory
    };
  }

  /**
   * Load chat configuration from database settings
   */
  async loadConfigFromDatabase(): Promise<void> {
    try {
      const settingsMap = await window.electronAPI.db.settings.getMany([
        'chatContextChunks',
        'chatMemoryLimit',
        'chatChunkingMethod',
        'chatMaxChunkSize',
        'chatChunkOverlap',
        'conversationMode',
        'directLlmContextLimit',
        'vectorOnlyChunkCount',
        'dynamicContextManagement',
        'memoryReserveFactor',
      ]);

      // Update config with database values
      this.config = {
        ...this.config,
        contextChunks: parseInt(settingsMap.chatContextChunks) || 4,
        conversationMemoryLimit: parseInt(settingsMap.chatMemoryLimit) || 20,
        chunkingMethod: settingsMap.chatChunkingMethod as 'speaker' | 'time' | 'hybrid' || 'speaker',
        maxChunkSize: parseInt(settingsMap.chatMaxChunkSize) || 60,
        chunkOverlap: parseInt(settingsMap.chatChunkOverlap) || 10,
        conversationMode: settingsMap.conversationMode as ConversationMode || 'rag',
        directLlmContextLimit: parseInt(settingsMap.directLlmContextLimit) || 8000,
        vectorOnlyChunkCount: parseInt(settingsMap.vectorOnlyChunkCount) || 5,
        dynamicContextManagement: settingsMap.dynamicContextManagement !== 'false', // Default true
        memoryReserveFactor: parseFloat(settingsMap.memoryReserveFactor) || 0.2
      };

      console.log('Chat config loaded from database:', this.config);
    } catch (error) {
      console.error('Failed to load chat config from database:', error);
      // Keep default config if loading fails
    }
  }

  static getInstance(): ChatService {
    if (!ChatService.instance) {
      ChatService.instance = new ChatService();
    }
    return ChatService.instance;
  }

  /**
   * Initialize model metadata for dynamic context management
   */
  private async initializeModelMetadata(): Promise<void> {
    if (!this.config.dynamicContextManagement) {
      console.log('Dynamic context management disabled, using static limits');
      return;
    }

    try {
      // Get current AI model from settings
      const modelName = (await window.electronAPI.db.settings.get('aiModel')) || 'llama2';

      // Get model metadata with dynamic detection
      this.currentModelMetadata = await modelMetadataService.getModelMetadata(modelName);
      this.currentContextBudget = modelMetadataService.calculateContextBudget(
        this.currentModelMetadata,
        this.config.memoryReserveFactor
      );

      console.log('Dynamic context management initialized:', {
        model: modelName,
        contextLimit: this.currentModelMetadata.contextLimit,
        budget: this.currentContextBudget
      });
    } catch (error) {
      console.warn('Failed to initialize model metadata, falling back to static limits:', error);
      this.currentModelMetadata = null;
      this.currentContextBudget = null;
    }
  }

  /**
   * Get effective context limit based on configuration
   */
  private getEffectiveContextLimit(): number {
    if (this.config.dynamicContextManagement && this.currentContextBudget) {
      // Use dynamic limit (converted from tokens to characters)
      return this.currentContextBudget.contentBudget * 4; // ~4 chars per token
    }
    
    // Fall back to static limit
    return this.config.directLlmContextLimit;
  }

  /**
   * Get memory reserve limit for conversation history
   */
  private getMemoryReserveLimit(): number {
    if (this.config.dynamicContextManagement && this.currentContextBudget) {
      // Use dynamic reserve (converted from tokens to characters)
      return this.currentContextBudget.memoryReserve * 4; // ~4 chars per token
    }
    
    // Fall back to fixed proportion of static limit
    return Math.floor(this.config.directLlmContextLimit * this.config.memoryReserveFactor);
  }

  /**
   * Validate and optimize context usage
   */
  private validateContextUsage(content: string, memory: string): {
    fits: boolean;
    contentLength: number;
    memoryLength: number;
    recommendation?: string;
  } {
    const contentLength = content.length;
    const memoryLength = memory.length;
    const contentLimit = this.getEffectiveContextLimit();
    const memoryLimit = this.getMemoryReserveLimit();

    if (this.config.dynamicContextManagement && this.currentModelMetadata) {
      // Use sophisticated validation with model metadata
      const validation = modelMetadataService.validateContextUsage(
        content, 
        memory, 
        this.currentModelMetadata
      );
      
      return {
        fits: validation.fits,
        contentLength,
        memoryLength,
        recommendation: validation.fits ? undefined : this.getOptimizationRecommendation(validation.usage, validation.budget)
      };
    }

    // Use simple validation for static limits
    const fits = contentLength <= contentLimit && memoryLength <= memoryLimit;
    
    return {
      fits,
      contentLength,
      memoryLength,
      recommendation: fits ? undefined : `Content too long. Try reducing to ${contentLimit} characters or switch to "Ask AI" mode.`
    };
  }

  /**
   * Get optimization recommendations based on context usage
   */
  private getOptimizationRecommendation(usage: number, budget: ModelContextBudget): string {
    const overagePercent = ((usage - budget.estimatedTokens!) / budget.estimatedTokens! * 100).toFixed(1);
    
    if (usage > budget.estimatedTokens! * 1.5) {
      return `Content exceeds context limit by ${overagePercent}%. Consider switching to "Ask AI" mode or reducing conversation history.`;
    } else if (usage > budget.estimatedTokens! * 1.2) {
      return `Content is ${overagePercent}% over limit. Consider compacting conversation memory or switching to "Ask AI" mode.`;
    } else {
      return `Content slightly exceeds limit by ${overagePercent}%. Some conversation history may be truncated.`;
    }
  }

  async initialize(
    vectorDbPath?: string,
    onProgress?: (progress: ProcessingProgress) => void
  ): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Load configuration from database first
      await this.loadConfigFromDatabase();
      
      onProgress?.({ stage: 'embedding', progress: 0, total: 100, message: 'Initializing embedding model...' });
      
      // Initialize embedding service
      await embeddingService.initialize();
      
      onProgress?.({ stage: 'embedding', progress: 50, total: 100, message: 'Initializing model metadata...' });
      
      // Initialize model metadata for dynamic context management
      await this.initializeModelMetadata();
      
      onProgress?.({ stage: 'embedding', progress: 100, total: 100, message: 'Embedding model ready' });
      onProgress?.({ stage: 'storing', progress: 0, total: 100, message: 'Initializing vector database...' });
      
      // Initialize vector store
      await vectorStoreService.initialize(vectorDbPath);

      // Update chunking service config
      chunkingService.updateConfig({
        method: this.config.chunkingMethod,
        maxChunkSize: this.config.maxChunkSize,
        chunkOverlap: this.config.chunkOverlap
      });

      onProgress?.({ stage: 'complete', progress: 100, total: 100, message: 'Chat system ready!' });
      
      this.isInitialized = true;
      console.log('Chat service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize chat service:', error);
      throw error;
    }
  }

  async processTranscriptForChat(
    transcript: Transcript,
    segments: TranscriptSegment[] = [],
    onProgress?: (progress: ProcessingProgress) => void
  ): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Chat service not initialized');
    }

    try {
      // Ensure embedding service is initialized before processing
      onProgress?.({ stage: 'embedding', progress: 0, total: 100, message: 'Ensuring embedding service is ready...' });
      await embeddingService.initialize();
      
      // Step 1: Chunking
      onProgress?.({ stage: 'chunking', progress: 0, total: 100, message: 'Analyzing transcript structure...' });
      
      const chunks = chunkingService.chunkTranscript(
        transcript.id,
        segments,
        transcript.full_text
      );

      onProgress?.({ stage: 'chunking', progress: 100, total: 100, message: `Created ${chunks.length} chunks` });

      if (chunks.length === 0) {
        console.warn('No chunks created for transcript:', transcript.id);
        return;
      }

      // Step 2: Generate embeddings
      onProgress?.({ stage: 'embedding', progress: 0, total: chunks.length, message: 'Generating embeddings...' });
      
      const embeddings = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Enhanced metadata including transcript context
        const enhancedMetadata = {
          chunkId: chunk.id,
          transcriptId: chunk.transcriptId,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          transcriptTitle: transcript.title,
          transcriptSummary: transcript.summary,
          keyTopics: transcript.key_topics,
          actionItems: transcript.action_items,
          speakers: chunk.metadata?.speakers,
          totalSpeakers: transcript.speaker_count
        };
        
        const embedding = await embeddingService.embedText(chunk.text, enhancedMetadata);
        
        embeddings.push(embedding);
        
        onProgress?.({ 
          stage: 'embedding', 
          progress: i + 1, 
          total: chunks.length, 
          message: `Embedded chunk ${i + 1}/${chunks.length}` 
        });
      }

      // Step 3: Store in vector database
      onProgress?.({ stage: 'storing', progress: 0, total: 100, message: 'Storing in vector database...' });
      
      await vectorStoreService.storeChunks(chunks, embeddings);

      onProgress?.({ stage: 'storing', progress: 100, total: 100, message: 'Storage complete' });

      console.log(`Successfully processed transcript ${transcript.id} for chat`);
    } catch (error) {
      console.error('Failed to process transcript for chat:', error);
      throw error;
    }
  }

  async chatWithTranscript(
    transcriptId: string,
    conversationId: string,
    userMessage: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<ChatMessage> {
    if (!this.isInitialized) {
      throw new Error('Chat service not initialized');
    }

    const startTime = Date.now();

    try {
      // 1. Manage conversation memory (compact if needed)
      const memory = await this.manageConversationMemory(conversationId, conversationHistory);

      // 2. Route to appropriate conversation mode
      let response: string;
      let searchResults: SearchResult[] = [];
      let mode = this.config.conversationMode;

      switch (mode) {
        case 'vector-only':
          response = await this.handleVectorOnlyMode(transcriptId, userMessage, memory);
          break;
        
        case 'rag':
          const ragResult = await this.handleRAGMode(transcriptId, userMessage, memory);
          response = ragResult.response;
          searchResults = ragResult.searchResults;
          break;
        
        case 'direct-llm':
          response = await this.handleDirectLLMMode(transcriptId, userMessage, memory);
          break;
        
        default:
          throw new Error(`Unknown conversation mode: ${mode}`);
      }

      // 3. Create assistant message
      const assistantMessage: ChatMessage = {
        id: `${conversationId}_${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
        metadata: {
          chunks: searchResults,
          processingTime: Date.now() - startTime,
          mode: mode,
          model: 'ollama'
        }
      };

      // 4. Store messages in database
      // First store the user message
      const userChatMessage: ChatMessage = {
        id: `${conversationId}_user_${Date.now()}`,
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      };
      await this.storeChatMessage(conversationId, userChatMessage);
      
      // Then store the assistant message
      await this.storeChatMessage(conversationId, assistantMessage);

      return assistantMessage;
    } catch (error) {
      console.error('Failed to chat with transcript:', error);
      throw error;
    }
  }


  /**
   * Enhanced context building with memory management
   */
  private buildContextWithMemory(
    searchResults: SearchResult[],
    memory: ConversationMemory
  ): string {
    let context = '';

    // Add relevant transcript chunks
    if (searchResults.length > 0) {
      context += 'RELEVANT TRANSCRIPT CONTENT:\n\n';
      searchResults.forEach((result) => {
        const timeStamp = this.formatTime(result.chunk.startTime);
        const speaker = result.chunk.speaker ? `[${result.chunk.speaker}]` : '';
        context += `[${timeStamp}] ${speaker} ${result.chunk.text}\n\n`;
      });
    }

    // Add compacted conversation summary if exists
    if (memory.compactedSummary) {
      context += 'CONVERSATION SUMMARY:\n\n';
      context += `${memory.compactedSummary}\n\n`;
    }

    // Add recent active messages
    if (memory.activeMessages.length > 0) {
      context += 'RECENT CONVERSATION:\n\n';
      memory.activeMessages.forEach(msg => {
        context += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
      });
    }

    return context;
  }

  /**
   * Manage conversation memory with compaction
   */
  private async manageConversationMemory(
    conversationId: string,
    messages: ChatMessage[]
  ): Promise<ConversationMemory> {
    
    if (messages.length <= this.config.conversationMemoryLimit) {
      return {
        activeMessages: messages,
        compactedSummary: '',
        totalExchanges: messages.length
      };
    }

    // Check if we already have compacted memory for this conversation
    const existingMemory = await this.getConversationMemory(conversationId);
    
    // Determine how many messages to keep active
    const keepCount = Math.floor(this.config.conversationMemoryLimit * 0.4); // Keep last 40%
    const activeMessages = messages.slice(-keepCount);
    
    // Get messages that need to be compacted
    const messagesToCompact = messages.slice(0, -keepCount);
    
    // If we have existing summary, include it with new messages to compact
    let allMessagesToCompact = messagesToCompact;
    if (existingMemory && existingMemory.compactedSummary) {
      // Create a synthetic message representing the previous summary
      const summaryMessage: ChatMessage = {
        id: 'summary',
        role: 'assistant',
        content: `Previous conversation summary: ${existingMemory.compactedSummary}`,
        timestamp: existingMemory.lastCompactionAt || new Date().toISOString()
      };
      allMessagesToCompact = [summaryMessage, ...messagesToCompact];
    }
    
    // Generate new compacted summary
    const compactedSummary = await this.compactMessages(allMessagesToCompact);
    
    const memory: ConversationMemory = {
      activeMessages,
      compactedSummary,
      totalExchanges: messages.length,
      lastCompactionAt: new Date().toISOString()
    };
    
    // Store the updated memory
    await this.storeConversationMemory(conversationId, memory);
    
    return memory;
  }

  /**
   * Compact older messages into a summary
   */
  private async compactMessages(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) {
      return '';
    }

    try {
      const conversationText = messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
        
      const compactionPrompt = await promptService.getProcessedPrompt('chat', 'conversation_compaction', {
        conversation: conversationText
      });
      
      const response = await window.electronAPI.services.chatWithOllama({
        prompt: compactionPrompt,
        message: '',
        context: ''
      });
      
      if (response.success) {
        return response.response.trim();
      } else {
        console.error('Failed to compact conversation:', response.error);
        // Fallback: create a simple summary
        return this.createFallbackSummary(messages);
      }
    } catch (error) {
      console.error('Error compacting messages:', error);
      return this.createFallbackSummary(messages);
    }
  }

  /**
   * Create a simple fallback summary when AI compaction fails
   */
  private createFallbackSummary(messages: ChatMessage[]): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const topics = userMessages.map(m => m.content).slice(0, 3);
    
    return `Previous conversation covered: ${topics.join(', ')}. (${messages.length} total exchanges)`;
  }

  /**
   * Get existing conversation memory from database
   */
  private async getConversationMemory(conversationId: string): Promise<ConversationMemory | null> {
    try {
      const result = await window.electronAPI.db.chat.getMemory(conversationId);

      if (result) {
        return {
          activeMessages: [], // Will be populated separately
          compactedSummary: result.compacted_summary || '',
          totalExchanges: result.total_exchanges || 0,
          lastCompactionAt: result.last_compaction_at
        };
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get conversation memory:', error);
      return null;
    }
  }

  /**
   * Store conversation memory in database
   */
  private async storeConversationMemory(conversationId: string, memory: ConversationMemory): Promise<void> {
    try {
      await window.electronAPI.db.chat.setMemory(conversationId, {
        compactedSummary: memory.compactedSummary,
        totalExchanges: memory.totalExchanges,
        lastCompactionAt: memory.lastCompactionAt,
      });
    } catch (error) {
      console.error('Failed to store conversation memory:', error);
    }
  }

  private async generateResponse(context: string, userMessage: string, transcriptId: string): Promise<string> {
    try {
      // Get transcript metadata for better context
      const transcript = await this.getTranscriptMetadata(transcriptId);
      
      const systemPrompt = await promptService.getProcessedPrompt('chat', 'transcript_chat', {
        title: transcript?.title || 'Audio Transcript',
        context: context,
        message: userMessage
      });

      // Call Ollama API through electron API
      const response = await window.electronAPI.services.chatWithOllama({
        prompt: systemPrompt,
        message: userMessage,
        context: context
      });

      if (response.success) {
        return response.response;
      } else {
        throw new Error(response.error || 'Failed to generate response');
      }
    } catch (error) {
      console.error('Failed to generate response:', error);
      return "I'm sorry, I encountered an error while processing your question. Please try again.";
    }
  }

  /**
   * Vector-Only Mode: Return relevant transcript chunks without LLM processing
   */
  private async handleVectorOnlyMode(
    transcriptId: string, 
    userMessage: string, 
    _memory: ConversationMemory
  ): Promise<string> {
    try {
      // Ensure embedding service is ready
      await embeddingService.initialize();
      
      // Generate embedding for user question
      const questionEmbedding = await embeddingService.embedText(userMessage);

      // Search for relevant chunks
      const searchResults = await vectorStoreService.searchSimilar(
        questionEmbedding.embedding,
        {
          limit: this.config.vectorOnlyChunkCount,
          transcriptId,
          minScore: 0.1
        }
      );

      if (searchResults.length === 0) {
        return "I couldn't find any relevant information in the transcript for your question. Try rephrasing your question or asking about different topics covered in the transcript.";
      }

      // Format chunks as direct excerpts
      let response = `I found ${searchResults.length} relevant excerpt${searchResults.length > 1 ? 's' : ''} from the transcript:\n\n`;
      
      searchResults.forEach((result, index) => {
        const timeStamp = this.formatTime(result.chunk.startTime);
        const speaker = result.chunk.speaker ? `[${result.chunk.speaker}] ` : '';
        const similarity = (result.score * 100).toFixed(1);
        
        response += `**Excerpt ${index + 1}** (${timeStamp}, ${similarity}% relevant):\n`;
        response += `${speaker}${result.chunk.text}\n\n`;
      });

      response += "*These are direct excerpts from the transcript. No AI interpretation has been applied.*";
      
      return response;
    } catch (error) {
      console.error('Vector-only mode error:', error);
      return "I encountered an error while searching the transcript. Please try again.";
    }
  }

  /**
   * RAG Mode: Current behavior - retrieve chunks and send to LLM
   */
  private async handleRAGMode(
    transcriptId: string, 
    userMessage: string, 
    memory: ConversationMemory
  ): Promise<{ response: string; searchResults: SearchResult[] }> {
    try {
      // Ensure embedding service is ready
      await embeddingService.initialize();
      
      // Generate embedding for user question
      const questionEmbedding = await embeddingService.embedText(userMessage);

      // Search for relevant chunks
      const searchResults = await vectorStoreService.searchSimilar(
        questionEmbedding.embedding,
        {
          limit: this.config.contextChunks,
          transcriptId,
          minScore: 0.1
        }
      );

      // Build context from relevant chunks and managed memory
      const context = this.buildContextWithMemory(searchResults, memory);

      // Generate response using LLM
      const response = await this.generateResponse(context, userMessage, transcriptId);

      return { response, searchResults };
    } catch (error) {
      console.error('RAG mode error:', error);
      return { 
        response: "I encountered an error while analyzing the transcript. Please try again.", 
        searchResults: [] 
      };
    }
  }

  /**
   * Direct LLM Mode: Send full transcript context to LLM (up to context limit)
   */
  private async handleDirectLLMMode(
    transcriptId: string, 
    userMessage: string, 
    memory: ConversationMemory
  ): Promise<string> {
    try {
      // Get full transcript
      const transcript = await window.electronAPI.db.transcripts.getForChat(transcriptId);

      if (!transcript) {
        return "I couldn't find the transcript. Please make sure it has been processed.";
      }

      // Use processed_text (speaker-tagged) if available, otherwise fall back to full_text
      let transcriptText = transcript.processed_text || transcript.full_text || '';
      
      // Build memory context first
      let memoryContext = '';
      if (memory.compactedSummary) {
        memoryContext += `CONVERSATION SUMMARY:\n\n${memory.compactedSummary}\n\n`;
      }
      if (memory.activeMessages.length > 0) {
        memoryContext += 'RECENT CONVERSATION:\n\n';
        memory.activeMessages.forEach(msg => {
          memoryContext += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
        });
      }

      // Get dynamic context limits
      const contentLimit = this.getEffectiveContextLimit();
      const memoryLimit = this.getMemoryReserveLimit();

      // Validate and optimize context usage
      const validation = this.validateContextUsage(transcriptText, memoryContext);
      let transcriptWasTruncated = false;

      // Apply smart truncation if needed
      if (!validation.fits) {
        console.log(`Direct LLM mode: ${validation.recommendation}`);

        // Truncate transcript to fit within content budget
        const availableContentSpace = contentLimit - 500; // Reserve space for formatting
        if (transcriptText.length > availableContentSpace) {
          transcriptWasTruncated = true;
          transcriptText = transcriptText.substring(0, availableContentSpace) +
            "\n\n[Note: Transcript was truncated to fit context limit. Consider switching to \"Ask AI\" mode for better handling of long transcripts.]";
        }

        // Truncate memory if needed
        if (memoryContext.length > memoryLimit) {
          // Prioritize recent messages over compacted summary
          let truncatedMemory = '';
          if (memory.activeMessages.length > 0) {
            const recentMessagesText = memory.activeMessages
              .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
              .join('\n\n');
            
            if (recentMessagesText.length <= memoryLimit - 50) {
              truncatedMemory = 'RECENT CONVERSATION:\n\n' + recentMessagesText + '\n\n';
            } else {
              // Truncate recent messages
              truncatedMemory = 'RECENT CONVERSATION:\n\n' + 
                recentMessagesText.substring(0, memoryLimit - 100) + 
                '\n\n[Conversation history truncated]\n\n';
            }
          } else if (memory.compactedSummary) {
            // Just use truncated summary
            truncatedMemory = 'CONVERSATION SUMMARY:\n\n' + 
              memory.compactedSummary.substring(0, memoryLimit - 50) + '\n\n';
          }
          memoryContext = truncatedMemory;
        }
      }

      // Build final context
      let context = `FULL TRANSCRIPT:\n\n${transcriptText}`;
      if (memoryContext) {
        context += `\n\n${memoryContext}`;
      }

      // Final validation with logging
      if (this.config.dynamicContextManagement && this.currentModelMetadata) {
        const finalValidation = this.validateContextUsage(transcriptText, memoryContext);
        console.log('Direct LLM context usage:', {
          contentChars: finalValidation.contentLength,
          memoryChars: finalValidation.memoryLength,
          totalChars: finalValidation.contentLength + finalValidation.memoryLength,
          fits: finalValidation.fits,
          contextLimit: contentLimit,
          memoryLimit: memoryLimit
        });
      }

      // Get transcript metadata for better context
      const systemPrompt = await promptService.getProcessedPrompt('chat', 'transcript_chat', {
        title: transcript.title || 'Audio Transcript',
        context: context,
        message: userMessage
      });

      // Call LLM with optimized context
      const response = await window.electronAPI.services.chatWithOllama({
        prompt: systemPrompt,
        message: userMessage,
        context: context
      });

      if (response.success) {
        if (transcriptWasTruncated) {
          return `⚠️ This transcript was longer than the model's context window, so only part of it was sent. The answer below may be incomplete — switch to **Ask AI** mode for better handling of long transcripts.\n\n---\n\n${response.response}`;
        }
        return response.response;
      } else {
        throw new Error(response.error || 'Failed to generate response');
      }
    } catch (error) {
      console.error('Direct LLM mode error:', error);
      return "I encountered an error while processing the full transcript. Please try again or switch to \"Ask AI\" mode for better performance with long transcripts.";
    }
  }

  private async getTranscriptMetadata(transcriptId: string): Promise<any> {
    try {
      return await window.electronAPI.db.transcripts.getMetadata(transcriptId);
    } catch (error) {
      console.error('Failed to get transcript metadata:', error);
      return null;
    }
  }

  private async storeChatMessage(conversationId: string, message: ChatMessage): Promise<void> {
    try {
      await window.electronAPI.db.chat.addMessage(conversationId, {
        role: message.role,
        content: message.content,
        created_at: message.timestamp,
      });
    } catch (error) {
      console.error('Failed to store chat message:', error);
    }
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  async reprocessTranscript(transcriptId: string, onProgress?: (progress: ProcessingProgress) => void): Promise<void> {
    // Delete existing chunks
    await vectorStoreService.deleteTranscriptChunks(transcriptId);
    
    // Get transcript data
    const transcript = await window.electronAPI.db.transcripts.get(transcriptId);

    const segments = await window.electronAPI.db.transcriptSegments.listByTranscript(transcriptId);

    // Reprocess
    await this.processTranscriptForChat(transcript, segments, onProgress);
  }


  /**
   * Load conversation history from database
   */
  async loadConversationHistory(conversationId: string): Promise<ChatMessage[]> {
    try {
      const messages = await window.electronAPI.db.chat.listMessages(conversationId);

      return messages.map((row: any) => ({
        id: row.id.toString(),
        role: row.role,
        content: row.content,
        timestamp: row.created_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      }));
    } catch (error) {
      console.error('Failed to load conversation history:', error);
      return [];
    }
  }

  /**
   * Force-create a fresh conversation for a transcript (skips the
   * "return latest" path). Used by the "New chat" button.
   */
  async startNewConversation(transcriptId: string): Promise<string> {
    const conversationId = `conv_${transcriptId}_${Date.now()}`;
    try {
      await window.electronAPI.db.chat.createConversation(conversationId, transcriptId);
    } catch (error) {
      console.error('Failed to create new conversation:', error);
    }
    return conversationId;
  }

  /**
   * Create or get conversation for transcript
   */
  async getOrCreateConversation(transcriptId: string): Promise<string> {
    try {
      // Try to find existing conversation
      const existing = await window.electronAPI.db.chat.getLatestConversationId(transcriptId);

      if (existing) {
        return existing.id;
      }

      // Create new conversation
      const conversationId = `conv_${transcriptId}_${Date.now()}`;
      await window.electronAPI.db.chat.createConversation(conversationId, transcriptId);

      return conversationId;
    } catch (error) {
      console.error('Failed to get or create conversation:', error);
      // Fallback to timestamp-based ID
      return `conv_${transcriptId}_${Date.now()}`;
    }
  }

  /**
   * Reset conversation memory (for testing or cleanup)
   */
  async resetConversationMemory(conversationId: string): Promise<void> {
    try {
      await window.electronAPI.db.chat.deleteMemory(conversationId);
    } catch (error) {
      console.error('Failed to reset conversation memory:', error);
    }
  }

  getConfig(): ChatConfig {
    return { ...this.config };
  }

  /**
   * Update chat configuration and persist to database
   */
  async updateConfig(newConfig: Partial<ChatConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    
    // Update chunking service config if relevant properties changed
    if (newConfig.chunkingMethod || newConfig.maxChunkSize || newConfig.chunkOverlap) {
      chunkingService.updateConfig({
        method: this.config.chunkingMethod,
        maxChunkSize: this.config.maxChunkSize,
        chunkOverlap: this.config.chunkOverlap
      });
    }

    console.log('Chat config updated:', this.config);
  }

  /**
   * Reload configuration from database (useful when settings change)
   */
  async reloadConfig(): Promise<void> {
    await this.loadConfigFromDatabase();
    
    // Reinitialize model metadata if dynamic context management is enabled
    if (this.config.dynamicContextManagement) {
      await this.initializeModelMetadata();
    }
    
    // Update chunking service with new config
    chunkingService.updateConfig({
      method: this.config.chunkingMethod,
      maxChunkSize: this.config.maxChunkSize,
      chunkOverlap: this.config.chunkOverlap
    });

    console.log('Chat config reloaded from database:', this.config);
  }

  /**
   * Handle model changes (e.g., when user switches AI model in settings)
   */
  async onModelChanged(newModelName: string): Promise<void> {
    if (!this.config.dynamicContextManagement) {
      console.log('Dynamic context management disabled, model change ignored');
      return;
    }

    try {
      console.log(`Model changed to: ${newModelName}`);
      
      // Clear model metadata cache for this model to force refresh
      modelMetadataService.clearCache();
      
      // Re-initialize with new model
      this.currentModelMetadata = await modelMetadataService.getModelMetadata(newModelName, true);
      this.currentContextBudget = modelMetadataService.calculateContextBudget(
        this.currentModelMetadata,
        this.config.memoryReserveFactor
      );

      console.log('Dynamic context management updated for new model:', {
        model: newModelName,
        contextLimit: this.currentModelMetadata.contextLimit,
        budget: this.currentContextBudget
      });
    } catch (error) {
      console.warn('Failed to update model metadata for new model:', error);
      this.currentModelMetadata = null;
      this.currentContextBudget = null;
    }
  }

  isReady(): boolean {
    return this.isInitialized && 
           embeddingService.isInitialized() && 
           vectorStoreService.isInitialized();
  }

  async getStats(): Promise<{
    isReady: boolean;
    vectorStats: any;
    embeddingModel: string;
    config: ChatConfig;
    modelMetadata?: ModelMetadata;
    contextBudget?: ModelContextBudget;
    dynamicContextEnabled: boolean;
  }> {
    return {
      isReady: this.isReady(),
      vectorStats: await vectorStoreService.getStats(),
      embeddingModel: embeddingService.getConfig().model,
      config: this.getConfig(),
      modelMetadata: this.currentModelMetadata || undefined,
      contextBudget: this.currentContextBudget || undefined,
      dynamicContextEnabled: this.config.dynamicContextManagement
    };
  }
}

// Export singleton instance
export const chatService = ChatService.getInstance();