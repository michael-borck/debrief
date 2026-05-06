export interface ModelMetadata {
  modelName: string;
  provider: 'ollama' | 'openai' | 'custom';
  contextLimit: number;
  capabilities: {
    supportsChat: boolean;
    supportsCompletion: boolean;
    supportsFunctionCalling: boolean;
    supportsEmbeddings: boolean;
    maxTokens?: number;
    reasoningCapable?: boolean;
    multimodal?: boolean;
  };
  parameters?: {
    parameterSize?: string;
    quantization?: string;
    architecture?: string;
  };
  lastUpdated: string;
  userOverride: boolean;
  isAvailable: boolean;
}

export interface ModelContextBudget {
  totalLimit: number;
  memoryReserve: number;
  contentBudget: number;
  safetyMargin: number;
  estimatedTokens?: number;
}

export interface ModelFamilyMapping {
  family: string;
  contextLimit: number;
  patterns: string[];
}

export class ModelMetadataService {
  private static instance: ModelMetadataService;
  private modelCache = new Map<string, ModelMetadata>();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  
  // Known model families and their context limits
  private readonly MODEL_FAMILIES: ModelFamilyMapping[] = [
    { family: 'llama3', contextLimit: 128000, patterns: ['llama3', 'llama-3'] },
    { family: 'llama2', contextLimit: 4096, patterns: ['llama2', 'llama-2'] },
    { family: 'codellama', contextLimit: 16384, patterns: ['codellama', 'code-llama'] },
    { family: 'mistral', contextLimit: 32768, patterns: ['mistral', 'mixtral'] },
    { family: 'phi', contextLimit: 2048, patterns: ['phi-'] },
    { family: 'gemma', contextLimit: 8192, patterns: ['gemma'] },
    { family: 'qwen', contextLimit: 32768, patterns: ['qwen'] },
    { family: 'yi', contextLimit: 200000, patterns: ['yi-'] },
    { family: 'openchat', contextLimit: 8192, patterns: ['openchat'] },
    { family: 'vicuna', contextLimit: 4096, patterns: ['vicuna'] },
    { family: 'gpt-4', contextLimit: 128000, patterns: ['gpt-4'] },
    { family: 'gpt-3.5', contextLimit: 16385, patterns: ['gpt-3.5'] },
    { family: 'claude', contextLimit: 200000, patterns: ['claude'] }
  ];

  private constructor() {}

  static getInstance(): ModelMetadataService {
    if (!ModelMetadataService.instance) {
      ModelMetadataService.instance = new ModelMetadataService();
    }
    return ModelMetadataService.instance;
  }

  /**
   * Get model metadata with caching and fallback strategies
   */
  async getModelMetadata(modelName: string, forceRefresh: boolean = false): Promise<ModelMetadata> {
    // Check cache first (unless force refresh)
    if (!forceRefresh && this.modelCache.has(modelName)) {
      const cached = this.modelCache.get(modelName)!;
      if (Date.now() - new Date(cached.lastUpdated).getTime() < this.CACHE_TTL) {
        return cached;
      }
    }

    // Try to get from database first
    let metadata = await this.getModelMetadataFromDatabase(modelName);
    
    if (!metadata || forceRefresh) {
      // Query the model service
      metadata = await this.queryModelFromService(modelName);
      
      if (metadata) {
        // Store in database
        await this.storeModelMetadata(metadata);
      } else {
        // Fallback to model family detection
        metadata = this.createFallbackMetadata(modelName);
      }
    }

    // Cache the result
    this.modelCache.set(modelName, metadata);
    
    return metadata;
  }

  /**
   * Calculate context budget based on model capabilities
   */
  calculateContextBudget(
    modelMetadata: ModelMetadata,
    memoryReserveFactor: number = 0.2,
    safetyMarginFactor: number = 0.1
  ): ModelContextBudget {
    const totalLimit = modelMetadata.contextLimit;
    const safetyMargin = Math.floor(totalLimit * safetyMarginFactor);
    const effectiveLimit = totalLimit - safetyMargin;
    const memoryReserve = Math.floor(effectiveLimit * memoryReserveFactor);
    const contentBudget = effectiveLimit - memoryReserve;

    return {
      totalLimit,
      memoryReserve,
      contentBudget,
      safetyMargin,
      // Rough token estimation (1 token ≈ 4 characters for most models)
      estimatedTokens: Math.floor(contentBudget / 4)
    };
  }

  /**
   * Estimate token count from text (rough approximation)
   */
  estimateTokenCount(text: string): number {
    // Simple heuristic: ~4 characters per token for most models
    // This can be enhanced with proper tokenization libraries later
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if content fits within context budget
   */
  validateContextUsage(
    content: string, 
    conversationMemory: string, 
    modelMetadata: ModelMetadata
  ): { fits: boolean; usage: number; budget: ModelContextBudget } {
    const budget = this.calculateContextBudget(modelMetadata);
    const contentTokens = this.estimateTokenCount(content);
    const memoryTokens = this.estimateTokenCount(conversationMemory);
    const totalUsage = contentTokens + memoryTokens;
    
    return {
      fits: totalUsage <= budget.estimatedTokens!,
      usage: totalUsage,
      budget
    };
  }

  /**
   * Get available models from service
   */
  async getAvailableModels(): Promise<ModelMetadata[]> {
    try {
      // Get models from Ollama
      const ollamaModels = await this.getOllamaModels();
      
      // Could add other providers here (OpenAI, etc.)
      
      return ollamaModels;
    } catch (error) {
      console.error('Failed to get available models:', error);
      return [];
    }
  }

  /**
   * Query Ollama service for available models
   */
  private async getOllamaModels(): Promise<ModelMetadata[]> {
    try {
      const aiUrlSetting = await window.electronAPI.database.get(
        'SELECT value FROM settings WHERE key = ?', 
        ['aiAnalysisUrl']
      );
      const aiUrl = aiUrlSetting?.value || 'http://localhost:11434';

      const response = await window.electronAPI.services.getOllamaModels(aiUrl);
      
      if (!response.success) {
        console.warn('Failed to get Ollama models:', response.error);
        return [];
      }

      const models: ModelMetadata[] = [];
      
      for (const model of response.models || []) {
        const modelName = model.name;
        let metadata = this.modelCache.get(modelName);
        
        if (!metadata) {
          // Try to get detailed info for this model
          const fetchedMetadata = await this.queryOllamaModelInfo(modelName);
          if (fetchedMetadata) {
            metadata = fetchedMetadata;
            this.modelCache.set(modelName, metadata);
          }
        }
        
        if (metadata) {
          models.push(metadata);
        }
      }

      return models;
    } catch (error) {
      console.error('Error fetching Ollama models:', error);
      return [];
    }
  }

  /**
   * Query specific model info from Ollama
   */
  private async queryOllamaModelInfo(modelName: string): Promise<ModelMetadata | null> {
    try {
      const aiUrlSetting = await window.electronAPI.database.get(
        'SELECT value FROM settings WHERE key = ?', 
        ['aiAnalysisUrl']
      );
      const aiUrl = aiUrlSetting?.value || 'http://localhost:11434';

      const response = await window.electronAPI.getModelInfo({
        url: aiUrl,
        modelName
      });
      
      if (response.success && response.info) {
        return this.parseOllamaModelInfo(modelName, response.info);
      }
      
      return null;
    } catch (error) {
      console.warn(`Failed to get info for model ${modelName}:`, error);
      return null;
    }
  }

  /**
   * Parse Ollama model info response
   */
  private parseOllamaModelInfo(modelName: string, info: any): ModelMetadata {
    // Extract context length from model info
    let contextLimit = 4096; // Default fallback
    
    if (info.parameters && info.parameters.num_ctx) {
      contextLimit = parseInt(info.parameters.num_ctx);
    } else if (info.template && info.template.includes('context_length')) {
      // Try to extract from template
      const match = info.template.match(/context_length["\s:]*(\d+)/);
      if (match) {
        contextLimit = parseInt(match[1]);
      }
    }
    
    // Fallback to model family detection if no explicit context found
    if (contextLimit === 4096) {
      const familyData = this.detectModelFamily(modelName);
      if (familyData) {
        contextLimit = familyData.contextLimit;
      }
    }

    return {
      modelName,
      provider: 'ollama',
      contextLimit,
      capabilities: {
        supportsChat: true,
        supportsCompletion: true,
        supportsFunctionCalling: false,
        supportsEmbeddings: false,
        maxTokens: contextLimit,
        reasoningCapable: this.isReasoningModel(modelName),
        multimodal: this.isMultimodalModel(modelName)
      },
      parameters: {
        parameterSize: info.details?.parameter_size || 'unknown',
        quantization: info.details?.quantization_level || 'unknown',
        architecture: info.details?.family || this.detectModelFamily(modelName)?.family || 'unknown'
      },
      lastUpdated: new Date().toISOString(),
      userOverride: false,
      isAvailable: true
    };
  }

  /**
   * Query model from service (generic)
   */
  private async queryModelFromService(modelName: string): Promise<ModelMetadata | null> {
    // For now, only Ollama is implemented
    // Can be extended for other providers
    return await this.queryOllamaModelInfo(modelName);
  }

  /**
   * Get model metadata from database
   */
  private async getModelMetadataFromDatabase(modelName: string): Promise<ModelMetadata | null> {
    try {
      const result = await window.electronAPI.database.get(
        'SELECT * FROM model_metadata WHERE model_name = ?',
        [modelName]
      );
      
      if (result) {
        return {
          modelName: result.model_name,
          provider: result.provider,
          contextLimit: result.context_limit,
          capabilities: result.capabilities ? JSON.parse(result.capabilities) : {},
          parameters: result.parameters ? JSON.parse(result.parameters) : {},
          lastUpdated: result.last_updated,
          userOverride: !!result.user_override,
          isAvailable: !!result.is_available
        };
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to get model metadata from database:', error);
      return null;
    }
  }

  /**
   * Store model metadata in database
   */
  private async storeModelMetadata(metadata: ModelMetadata): Promise<void> {
    try {
      await window.electronAPI.database.run(
        `INSERT OR REPLACE INTO model_metadata 
         (model_name, provider, context_limit, capabilities, parameters, last_updated, user_override, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          metadata.modelName,
          metadata.provider,
          metadata.contextLimit,
          JSON.stringify(metadata.capabilities),
          JSON.stringify(metadata.parameters),
          metadata.lastUpdated,
          metadata.userOverride ? 1 : 0,
          metadata.isAvailable ? 1 : 0
        ]
      );
    } catch (error) {
      console.warn('Failed to store model metadata:', error);
    }
  }

  /**
   * Create fallback metadata using model family detection
   */
  private createFallbackMetadata(modelName: string): ModelMetadata {
    const familyData = this.detectModelFamily(modelName);
    const contextLimit = familyData?.contextLimit || 4096;

    return {
      modelName,
      provider: 'custom',
      contextLimit,
      capabilities: {
        supportsChat: true,
        supportsCompletion: true,
        supportsFunctionCalling: false,
        supportsEmbeddings: false,
        maxTokens: contextLimit,
        reasoningCapable: this.isReasoningModel(modelName),
        multimodal: this.isMultimodalModel(modelName)
      },
      parameters: {
        architecture: familyData?.family || 'unknown'
      },
      lastUpdated: new Date().toISOString(),
      userOverride: false,
      isAvailable: false // Marked as unavailable since it's a fallback
    };
  }

  /**
   * Detect model family from name
   */
  private detectModelFamily(modelName: string): ModelFamilyMapping | null {
    const lowerName = modelName.toLowerCase();
    
    for (const family of this.MODEL_FAMILIES) {
      if (family.patterns.some(pattern => lowerName.includes(pattern))) {
        return family;
      }
    }
    
    return null;
  }

  /**
   * Check if model has reasoning capabilities
   */
  private isReasoningModel(modelName: string): boolean {
    const reasoningPatterns = ['gpt-4', 'claude', 'llama3', 'qwen', 'yi'];
    const lowerName = modelName.toLowerCase();
    return reasoningPatterns.some(pattern => lowerName.includes(pattern));
  }

  /**
   * Check if model supports multimodal input
   */
  private isMultimodalModel(modelName: string): boolean {
    const multimodalPatterns = ['llava', 'vision', 'multimodal', 'gpt-4'];
    const lowerName = modelName.toLowerCase();
    return multimodalPatterns.some(pattern => lowerName.includes(pattern));
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.modelCache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; models: string[] } {
    return {
      size: this.modelCache.size,
      models: Array.from(this.modelCache.keys())
    };
  }
}

// Export singleton instance
export const modelMetadataService = ModelMetadataService.getInstance();