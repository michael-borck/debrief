// Embedding Service - Main Process Interface
// This service runs in the main process due to native dependencies

export interface EmbeddingConfig {
  model: string;
  maxLength: number;
  normalize: boolean;
}

export interface EmbeddingResult {
  embedding: number[];
  text: string;
  metadata?: Record<string, unknown>;
}

export class EmbeddingService {
  private static instance: EmbeddingService;

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  async initialize(_onProgress?: (progress: { loaded: number; total: number; status: string }) => void): Promise<void> {
    // Callback intentionally dropped — functions can't cross IPC.
    return window.electronAPI.embedding.initialize();
  }

  async embedText(text: string, metadata?: Record<string, unknown>): Promise<EmbeddingResult> {
    return window.electronAPI.embedding.embedText(text, metadata);
  }

  async embedBatch(texts: string[], metadata?: Record<string, unknown>[]): Promise<EmbeddingResult[]> {
    return window.electronAPI.embedding.embedBatch(texts, metadata);
  }

  getDimensions(): number {
    // all-MiniLM-L6-v2 produces 384-dimensional embeddings
    return 384;
  }

  isInitialized(): boolean {
    return true;
  }

  updateConfig(config: Partial<EmbeddingConfig>): void {
    window.electronAPI.embedding.updateConfig(config);
  }

  getConfig(): EmbeddingConfig {
    return {
      model: 'Xenova/all-MiniLM-L6-v2',
      maxLength: 512,
      normalize: true
    };
  }
}

// Export singleton instance
export const embeddingService = EmbeddingService.getInstance();