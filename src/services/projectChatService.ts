import { chatService, ChatConfig, ChatMessage, ConversationMemory, ConversationMode } from './chatService';
import { modelMetadataService, ModelMetadata, ModelContextBudget } from './modelMetadataService';
import { embeddingService } from './embeddingService';
import { vectorStoreService, SearchResult } from './vectorStoreService';
import { promptService } from './promptService';
import { Project, Transcript } from '../types';

export interface ProjectChatConfig extends ChatConfig {
  crossTranscriptAnalysis: boolean;
  maxTranscriptsInContext: number;
  transcriptSelectionStrategy: 'recent' | 'relevant' | 'all';
  projectAnalysisMode: 'collated' | 'cross_transcript' | 'hybrid';
}

export interface ProjectChatMessage extends ChatMessage {
  metadata?: ChatMessage['metadata'] & {
    sourceTranscripts?: string[]; // IDs of transcripts that contributed to this response
    analysisType?: 'collated' | 'cross_transcript' | 'hybrid';
    contentSelection?: {
      strategy: string;
      transcriptCount: number;
      chunkCount: number;
    };
  };
}

export interface ProjectConversation {
  id: string;
  projectId: string;
  messages: ProjectChatMessage[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAnalysisResult {
  projectSummary: string;
  crossTranscriptThemes: Array<{
    theme: string;
    occurrences: Array<{
      transcriptId: string;
      transcriptTitle: string;
      evidence: string[];
    }>;
    strength: number;
  }>;
  consensusPoints: string[];
  divergencePoints: Array<{
    topic: string;
    perspectives: Array<{
      transcriptId: string;
      position: string;
    }>;
  }>;
}

export class ProjectChatService {
  private static instance: ProjectChatService;
  private config: ProjectChatConfig;
  private isInitialized = false;
  private currentModelMetadata: ModelMetadata | null = null;
  private currentContextBudget: ModelContextBudget | null = null;

  private constructor() {
    this.config = {
      // Inherit base chat config
      ...chatService.getConfig(),
      // Project-specific extensions
      crossTranscriptAnalysis: true,
      maxTranscriptsInContext: 5,
      transcriptSelectionStrategy: 'relevant',
      projectAnalysisMode: 'hybrid'
    };
  }

  static getInstance(): ProjectChatService {
    if (!ProjectChatService.instance) {
      ProjectChatService.instance = new ProjectChatService();
    }
    return ProjectChatService.instance;
  }

  /**
   * Initialize project chat service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Ensure base chat service is initialized
      if (!chatService.isReady()) {
        await chatService.initialize();
      }

      // Load project-specific configuration
      await this.loadProjectConfig();

      // Initialize model metadata for dynamic context management
      await this.initializeModelMetadata();

      this.isInitialized = true;
      console.log('Project chat service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize project chat service:', error);
      throw error;
    }
  }

  /**
   * Load project-specific configuration
   */
  private async loadProjectConfig(): Promise<void> {
    try {
      const settingsMap = await window.electronAPI.db.settings.getMany([
        'projectCrossTranscriptAnalysis',
        'projectMaxTranscriptsInContext',
        'projectTranscriptSelectionStrategy',
        'projectAnalysisMode',
      ]);

      this.config = {
        ...this.config,
        crossTranscriptAnalysis: settingsMap.projectCrossTranscriptAnalysis !== 'false',
        maxTranscriptsInContext: parseInt(settingsMap.projectMaxTranscriptsInContext, 10) || 5,
        transcriptSelectionStrategy: settingsMap.projectTranscriptSelectionStrategy as 'recent' | 'relevant' | 'all' || 'relevant',
        projectAnalysisMode: settingsMap.projectAnalysisMode as 'collated' | 'cross_transcript' | 'hybrid' || 'hybrid'
      };

      console.log('Project chat config loaded:', this.config);
    } catch (error) {
      console.error('Failed to load project chat config:', error);
    }
  }

  /**
   * Initialize model metadata for context management
   */
  private async initializeModelMetadata(): Promise<void> {
    try {
      const modelName = (await window.electronAPI.db.settings.get('aiModel')) || 'llama2';

      this.currentModelMetadata = await modelMetadataService.getModelMetadata(modelName);
      this.currentContextBudget = modelMetadataService.calculateContextBudget(
        this.currentModelMetadata,
        this.config.memoryReserveFactor
      );

      console.log('Project chat model metadata initialized:', {
        model: modelName,
        contextLimit: this.currentModelMetadata.contextLimit,
        budget: this.currentContextBudget
      });
    } catch (error) {
      console.warn('Failed to initialize project model metadata:', error);
    }
  }

  /**
   * Chat with project using cross-transcript analysis
   */
  async chatWithProject(
    projectId: string,
    conversationId: string,
    userMessage: string,
    conversationHistory: ProjectChatMessage[] = []
  ): Promise<ProjectChatMessage> {
    if (!this.isInitialized) {
      throw new Error('Project chat service not initialized');
    }

    const startTime = Date.now();

    try {
      // 1. Get project and its transcripts
      const project = await this.getProjectData(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      // 2. Manage conversation memory
      const memory = await this.manageProjectConversationMemory(conversationId, conversationHistory);

      // 3. Select and analyze relevant transcripts
      const transcriptSelection = await this.selectRelevantTranscripts(
        projectId, 
        userMessage, 
        this.config.transcriptSelectionStrategy
      );

      // 4. Generate response based on analysis mode
      let response: string;
      let searchResults: SearchResult[] = [];

      switch (this.config.projectAnalysisMode) {
        case 'collated': {
          const collatedResult = await this.handleCollatedAnalysis(
            transcriptSelection.transcripts,
            userMessage,
            memory
          );
          response = collatedResult.response;
          searchResults = collatedResult.searchResults;
          break;
        }

        case 'cross_transcript':
          response = await this.handleCrossTranscriptAnalysis(
            transcriptSelection.transcripts,
            userMessage,
            memory
          );
          break;

        case 'hybrid': {
          const hybridResult = await this.handleHybridAnalysis(
            transcriptSelection.transcripts,
            userMessage,
            memory
          );
          response = hybridResult.response;
          searchResults = hybridResult.searchResults;
          break;
        }

        default:
          throw new Error(`Unknown project analysis mode: ${this.config.projectAnalysisMode}`);
      }

      // 5. Create assistant message with project context
      const assistantMessage: ProjectChatMessage = {
        id: `${conversationId}_${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
        metadata: {
          chunks: searchResults,
          processingTime: Date.now() - startTime,
          mode: 'rag' as ConversationMode,
          model: 'project-chat',
          sourceTranscripts: transcriptSelection.transcripts.map(t => t.id),
          analysisType: this.config.projectAnalysisMode,
          contentSelection: {
            strategy: transcriptSelection.strategy,
            transcriptCount: transcriptSelection.transcripts.length,
            chunkCount: searchResults.length
          }
        }
      };

      // 6. Store messages in database
      const userChatMessage: ProjectChatMessage = {
        id: `${conversationId}_user_${Date.now()}`,
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      };
      
      await this.storeProjectChatMessage(conversationId, userChatMessage);
      await this.storeProjectChatMessage(conversationId, assistantMessage);

      return assistantMessage;
    } catch (error) {
      console.error('Failed to chat with project:', error);
      throw error;
    }
  }

  /**
   * Get project data with transcripts
   */
  private async getProjectData(projectId: string): Promise<{
    project: Project;
    transcripts: Transcript[];
  } | null> {
    try {
      const project = await window.electronAPI.db.projects.get(projectId);

      if (!project) return null;

      const transcripts =
        await window.electronAPI.db.projectTranscripts.listTranscriptsForProject(projectId, {
          orderBy: 'created_desc',
        });

      return { project, transcripts };
    } catch (error) {
      console.error('Failed to get project data:', error);
      return null;
    }
  }

  /**
   * Select relevant transcripts based on strategy
   */
  private async selectRelevantTranscripts(
    projectId: string,
    userMessage: string,
    strategy: 'recent' | 'relevant' | 'all'
  ): Promise<{
    transcripts: Transcript[];
    strategy: string;
    reasoning: string;
  }> {
    const projectData = await this.getProjectData(projectId);
    if (!projectData) {
      return { transcripts: [], strategy, reasoning: 'Project not found' };
    }

    const allTranscripts = projectData.transcripts;
    const maxTranscripts = this.config.maxTranscriptsInContext;

    switch (strategy) {
      case 'recent':
        return {
          transcripts: allTranscripts.slice(0, maxTranscripts),
          strategy: 'recent',
          reasoning: `Selected ${Math.min(allTranscripts.length, maxTranscripts)} most recent transcripts`
        };

      case 'all':
        return {
          transcripts: allTranscripts.slice(0, maxTranscripts),
          strategy: 'all',
          reasoning: `Selected all available transcripts (limited to ${maxTranscripts})`
        };

      case 'relevant': {
        // Use vector similarity to find most relevant transcripts
        const relevantTranscripts = await this.findRelevantTranscriptsByContent(
          allTranscripts,
          userMessage,
          maxTranscripts
        );
        return {
          transcripts: relevantTranscripts,
          strategy: 'relevant',
          reasoning: `Selected ${relevantTranscripts.length} most relevant transcripts based on content similarity`
        };
      }

      default:
        return {
          transcripts: allTranscripts.slice(0, maxTranscripts),
          strategy: 'fallback',
          reasoning: 'Unknown strategy, using recent transcripts'
        };
    }
  }

  /**
   * Find transcripts most relevant to user question using vector similarity
   */
  private async findRelevantTranscriptsByContent(
    transcripts: Transcript[],
    userMessage: string,
    limit: number
  ): Promise<Transcript[]> {
    try {
      // Generate embedding for user question
      await embeddingService.initialize();
      const questionEmbedding = await embeddingService.embedText(userMessage);

      // Search for relevant chunks across all transcripts
      const allResults = await vectorStoreService.searchSimilar(
        questionEmbedding.embedding,
        {
          limit: limit * 3, // Get more results to analyze transcript distribution
          minScore: 0.1
        }
      );

      // Group results by transcript and calculate relevance scores
      const transcriptScores = new Map<string, { transcript: Transcript; score: number; chunks: number }>();
      
      for (const result of allResults) {
        const transcriptId = result.chunk.transcriptId;
        const transcript = transcripts.find(t => t.id === transcriptId);
        
        if (transcript) {
          const existing = transcriptScores.get(transcriptId);
          if (existing) {
            existing.score += result.score;
            existing.chunks += 1;
          } else {
            transcriptScores.set(transcriptId, {
              transcript,
              score: result.score,
              chunks: 1
            });
          }
        }
      }

      // Sort by relevance score and return top transcripts
      const sortedTranscripts = Array.from(transcriptScores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.transcript);

      return sortedTranscripts;
    } catch (error) {
      console.error('Failed to find relevant transcripts:', error);
      // Fallback to recent transcripts
      return transcripts.slice(0, limit);
    }
  }

  /**
   * Handle collated analysis mode - combine individual transcript analyses
   */
  private async handleCollatedAnalysis(
    transcripts: Transcript[],
    userMessage: string,
    memory: ConversationMemory
  ): Promise<{ response: string; searchResults: SearchResult[] }> {
    try {
      // Get relevant chunks from each transcript
      await embeddingService.initialize();
      const questionEmbedding = await embeddingService.embedText(userMessage);

      const allSearchResults: SearchResult[] = [];
      const transcriptSummaries: string[] = [];

      for (const transcript of transcripts) {
        // Search within this transcript
        const transcriptResults = await vectorStoreService.searchSimilar(
          questionEmbedding.embedding,
          {
            limit: Math.ceil(this.config.contextChunks / transcripts.length),
            transcriptId: transcript.id,
            minScore: 0.1
          }
        );

        allSearchResults.push(...transcriptResults);

        // Create summary for this transcript
        if (transcriptResults.length > 0) {
          const transcriptContext = transcriptResults
            .map(r => r.chunk.text)
            .join('\n\n');
          
          transcriptSummaries.push(
            `**${transcript.title}**:\n${transcriptContext.substring(0, 500)}...`
          );
        }
      }

      // Build combined context
      const context = this.buildProjectContext(allSearchResults, memory, transcriptSummaries);

      // Generate response
      const response = await this.generateProjectResponse(
        context,
        userMessage,
        transcripts
      );

      return { response, searchResults: allSearchResults };
    } catch (error) {
      console.error('Collated analysis error:', error);
      return { 
        response: "I encountered an error analyzing the project transcripts. Please try again.",
        searchResults: []
      };
    }
  }

  /**
   * Handle cross-transcript analysis - analyze patterns across transcripts
   */
  private async handleCrossTranscriptAnalysis(
    transcripts: Transcript[],
    userMessage: string,
    memory: ConversationMemory
  ): Promise<string> {
    try {
      // Perform cross-transcript analysis
      const analysis = await this.performCrossTranscriptAnalysis(transcripts);

      // Build context from analysis results
      let context = 'CROSS-TRANSCRIPT ANALYSIS:\n\n';
      
      if (analysis.crossTranscriptThemes.length > 0) {
        context += 'RECURRING THEMES:\n';
        analysis.crossTranscriptThemes.forEach(theme => {
          context += `- ${theme.theme} (strength: ${(theme.strength * 100).toFixed(1)}%)\n`;
          theme.occurrences.forEach(occ => {
            context += `  • ${occ.transcriptTitle}: ${occ.evidence.join(', ')}\n`;
          });
        });
        context += '\n';
      }

      if (analysis.consensusPoints.length > 0) {
        context += 'CONSENSUS POINTS:\n';
        analysis.consensusPoints.forEach(point => {
          context += `- ${point}\n`;
        });
        context += '\n';
      }

      if (analysis.divergencePoints.length > 0) {
        context += 'DIVERGENT PERSPECTIVES:\n';
        analysis.divergencePoints.forEach(div => {
          context += `- ${div.topic}:\n`;
          div.perspectives.forEach(persp => {
            const transcript = transcripts.find(t => t.id === persp.transcriptId);
            context += `  • ${transcript?.title}: ${persp.position}\n`;
          });
        });
        context += '\n';
      }

      // Add memory context
      if (memory.compactedSummary) {
        context += `CONVERSATION SUMMARY:\n${memory.compactedSummary}\n\n`;
      }

      if (memory.activeMessages.length > 0) {
        context += 'RECENT CONVERSATION:\n';
        memory.activeMessages.forEach(msg => {
          context += `${msg.role.toUpperCase()}: ${msg.content}\n`;
        });
        context += '\n';
      }

      // Generate response using cross-transcript context
      return await this.generateProjectResponse(
        context,
        userMessage,
        transcripts
      );
    } catch (error) {
      console.error('Cross-transcript analysis error:', error);
      return "I encountered an error performing cross-transcript analysis. Please try again.";
    }
  }

  /**
   * Handle hybrid analysis - combine collated and cross-transcript approaches
   */
  private async handleHybridAnalysis(
    transcripts: Transcript[],
    userMessage: string,
    memory: ConversationMemory
  ): Promise<{ response: string; searchResults: SearchResult[]; analysisType: 'collated' | 'cross_transcript' | 'hybrid' }> {
    try {
      // Determine best approach based on question type and content
      const questionType = this.analyzeQuestionType(userMessage);
      
      if (questionType === 'specific' && transcripts.length <= 3) {
        // Use collated analysis for specific questions with few transcripts
        const result = await this.handleCollatedAnalysis(transcripts, userMessage, memory);
        return { ...result, analysisType: 'collated' };
      } else if (questionType === 'thematic' && transcripts.length > 2) {
        // Use cross-transcript for thematic questions with multiple transcripts
        const response = await this.handleCrossTranscriptAnalysis(transcripts, userMessage, memory);
        return { response, searchResults: [], analysisType: 'cross_transcript' };
      } else {
        // True hybrid approach - combine both
        const collatedResult = await this.handleCollatedAnalysis(transcripts, userMessage, memory);
        const crossTranscriptAnalysis = await this.performCrossTranscriptAnalysis(transcripts);
        
        // Combine both analyses in the context
        let hybridContext = collatedResult.searchResults.length > 0 
          ? this.buildProjectContext(collatedResult.searchResults, memory, [])
          : '';
        
        if (crossTranscriptAnalysis.crossTranscriptThemes.length > 0) {
          hybridContext += '\n\nCROSS-TRANSCRIPT PATTERNS:\n';
          crossTranscriptAnalysis.crossTranscriptThemes.slice(0, 3).forEach(theme => {
            hybridContext += `- ${theme.theme}: Found in ${theme.occurrences.length} transcripts\n`;
          });
        }

        const response = await this.generateProjectResponse(
          hybridContext,
          userMessage,
          transcripts
        );

        return { response, searchResults: collatedResult.searchResults, analysisType: 'hybrid' };
      }
    } catch (error) {
      console.error('Hybrid analysis error:', error);
      // Fallback to collated analysis
      const result = await this.handleCollatedAnalysis(transcripts, userMessage, memory);
      return { ...result, analysisType: 'collated' };
    }
  }

  /**
   * Analyze question type to determine best analysis approach
   */
  private analyzeQuestionType(question: string): 'specific' | 'thematic' | 'comparative' {
    const lowerQuestion = question.toLowerCase();
    
    // Thematic indicators
    const thematicKeywords = ['pattern', 'theme', 'trend', 'common', 'across', 'overall', 'generally', 'consistently'];
    
    // Comparative indicators  
    const comparativeKeywords = ['compare', 'difference', 'versus', 'vs', 'contrast', 'similar', 'different'];
    
    if (thematicKeywords.some(keyword => lowerQuestion.includes(keyword))) {
      return 'thematic';
    } else if (comparativeKeywords.some(keyword => lowerQuestion.includes(keyword))) {
      return 'comparative';
    } else {
      return 'specific';
    }
  }

  /**
   * Perform cross-transcript analysis to find patterns and themes
   */
  private async performCrossTranscriptAnalysis(
    transcripts: Transcript[]
  ): Promise<ProjectAnalysisResult> {
    // This is a simplified implementation - in a full system this would be more sophisticated
    const themes: ProjectAnalysisResult['crossTranscriptThemes'] = [];
    const consensusPoints: string[] = [];
    const divergencePoints: ProjectAnalysisResult['divergencePoints'] = [];

    // Analyze common themes from existing transcript analyses
    const transcriptAnalyses = transcripts.map(t => ({
      id: t.id,
      title: t.title,
      topics: t.key_topics ? (typeof t.key_topics === 'string' ? JSON.parse(t.key_topics) : t.key_topics) : [],
      summary: t.summary || ''
    }));

    // Find recurring topics
    const topicFrequency = new Map<string, Array<{ transcriptId: string; transcriptTitle: string }>>();
    
    transcriptAnalyses.forEach(analysis => {
      analysis.topics.forEach((topic: string) => {
        if (!topicFrequency.has(topic)) {
          topicFrequency.set(topic, []);
        }
        topicFrequency.get(topic)!.push({
          transcriptId: analysis.id,
          transcriptTitle: analysis.title
        });
      });
    });

    // Convert to themes with strength calculation
    topicFrequency.forEach((occurrences, topic) => {
      if (occurrences.length > 1) { // Only include topics that appear in multiple transcripts
        themes.push({
          theme: topic,
          occurrences: occurrences.map(occ => ({
            transcriptId: occ.transcriptId,
            transcriptTitle: occ.transcriptTitle,
            evidence: [`Mentioned in ${occ.transcriptTitle}`]
          })),
          strength: occurrences.length / transcripts.length
        });
      }
    });

    // Sort themes by strength
    themes.sort((a, b) => b.strength - a.strength);

    return {
      projectSummary: `Analysis of ${transcripts.length} transcripts`,
      crossTranscriptThemes: themes.slice(0, 5), // Top 5 themes
      consensusPoints,
      divergencePoints
    };
  }

  /**
   * Build project context from search results and summaries
   */
  private buildProjectContext(
    searchResults: SearchResult[],
    memory: ConversationMemory,
    transcriptSummaries: string[] = []
  ): string {
    let context = '';

    // Add transcript summaries if provided
    if (transcriptSummaries.length > 0) {
      context += 'PROJECT TRANSCRIPT SUMMARIES:\n\n';
      transcriptSummaries.forEach(summary => {
        context += `${summary}\n\n`;
      });
    }

    // Add relevant chunks
    if (searchResults.length > 0) {
      context += 'RELEVANT CONTENT:\n\n';
      searchResults.forEach((result) => {
        const timeStamp = this.formatTime(result.chunk.startTime);
        const speaker = result.chunk.speaker ? `[${result.chunk.speaker}]` : '';
        context += `[${timeStamp}] ${speaker} ${result.chunk.text}\n\n`;
      });
    }

    // Add conversation memory
    if (memory.compactedSummary) {
      context += 'CONVERSATION SUMMARY:\n\n';
      context += `${memory.compactedSummary}\n\n`;
    }

    if (memory.activeMessages.length > 0) {
      context += 'RECENT CONVERSATION:\n\n';
      memory.activeMessages.forEach(msg => {
        context += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
      });
    }

    return context;
  }

  /**
   * Generate project-specific response
   */
  private async generateProjectResponse(
    context: string,
    userMessage: string,
    transcripts: Transcript[]
  ): Promise<string> {
    try {
      const projectInfo = `Project with ${transcripts.length} transcript${transcripts.length > 1 ? 's' : ''}`;
      
      const systemPrompt = await promptService.getProcessedPrompt('chat', 'transcript_chat', {
        title: projectInfo,
        context: context,
        message: userMessage
      });

      const response = await window.electronAPI.ai.complete({
        prompt: systemPrompt,
        expects: 'text'
      });

      if (response.ok) {
        return response.text ?? '';
      } else {
        throw new Error(response.error || 'Failed to generate response');
      }
    } catch (error) {
      console.error('Failed to generate project response:', error);
      return "I'm sorry, I encountered an error while processing your question about the project. Please try again.";
    }
  }

  /**
   * Manage project conversation memory
   */
  private async manageProjectConversationMemory(
    conversationId: string,
    messages: ProjectChatMessage[]
  ): Promise<ConversationMemory> {
    // Reuse the memory management logic from base ChatService
    const baseMemory = messages.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp
    }));

    // Use chatService's memory management
    return await (chatService as any).manageConversationMemory(conversationId, baseMemory);
  }

  /**
   * Store project chat message
   */
  private async storeProjectChatMessage(conversationId: string, message: ProjectChatMessage): Promise<void> {
    try {
      await window.electronAPI.db.projectChat.addMessage(conversationId, {
        role: message.role,
        content: message.content,
        created_at: message.timestamp,
      });
    } catch (error) {
      console.error('Failed to store project chat message:', error);
    }
  }

  /**
   * Get or create project conversation
   */
  async getOrCreateProjectConversation(projectId: string): Promise<string> {
    try {
      const existing =
        await window.electronAPI.db.projectChat.getLatestConversationId(projectId);

      if (existing) {
        return existing.id;
      }

      const conversationId = `proj_conv_${projectId}_${Date.now()}`;
      await window.electronAPI.db.projectChat.createConversation(conversationId, projectId);

      return conversationId;
    } catch (error) {
      console.error('Failed to get or create project conversation:', error);
      return `proj_conv_${projectId}_${Date.now()}`;
    }
  }

  /**
   * Load project conversation history
   */
  async loadProjectConversationHistory(conversationId: string): Promise<ProjectChatMessage[]> {
    try {
      const messages = await window.electronAPI.db.projectChat.listMessages(conversationId);

      return messages.map((row: any) => ({
        id: row.id.toString(),
        role: row.role,
        content: row.content,
        timestamp: row.created_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      }));
    } catch (error) {
      console.error('Failed to load project conversation history:', error);
      return [];
    }
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get project chat statistics
   */
  async getProjectChatStats(projectId: string): Promise<{
    conversationCount: number;
    messageCount: number;
    transcriptCount: number;
    lastActivity?: string;
  }> {
    try {
      const stats = await window.electronAPI.db.projectChat.getStats(projectId);

      const transcriptCount =
        await window.electronAPI.db.projectTranscripts.countForProject(projectId);

      return {
        conversationCount: stats?.conversation_count || 0,
        messageCount: stats?.message_count || 0,
        transcriptCount: transcriptCount || 0,
        lastActivity: stats?.last_activity ?? undefined
      };
    } catch (error) {
      console.error('Failed to get project chat stats:', error);
      return {
        conversationCount: 0,
        messageCount: 0,
        transcriptCount: 0
      };
    }
  }

  isReady(): boolean {
    return this.isInitialized && chatService.isReady();
  }

  getConfig(): ProjectChatConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const projectChatService = ProjectChatService.getInstance();