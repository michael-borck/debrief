// Type definitions for the Electron preload bridge (window.electronAPI).
//
// CANONICAL SOURCE: this file mirrors public/preload.js 1:1.
// When you add or change a method in public/preload.js, update this file too.
// Do NOT add a competing electronAPI declaration in any other file — it will
// merge unpredictably with this one and create silent type drift.

import type { ChunkTimingInfo } from './index';

export interface AIUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
}

export interface AIUsageByProvider {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  lastModel: string;
}

export interface AIUsageStats {
  session: {
    startedAt: number;
    totals: AIUsageTotals;
    byProvider: Record<string, AIUsageByProvider>;
  };
  lifetime: {
    startedAt: number;
    totals: AIUsageTotals;
    byProvider: Record<string, AIUsageByProvider>;
  };
}

export interface AIProviderInfo {
  id: string;
  name: string;
  defaultUrl: string;
  requiresKey: boolean;
  isLocal: boolean;
  description: string;
}

export interface ElectronAPI {
  database: {
    query: (type: string, sql: string, params?: any[]) => Promise<any>;
    all: (sql: string, params?: any[]) => Promise<any[]>;
    get: (sql: string, params?: any[]) => Promise<any>;
    run: (sql: string, params?: any[]) => Promise<any>;
  };

  dialog: {
    openFile: () => Promise<string[]>;
    saveFile: (options: { defaultPath?: string; filters?: any[] }) => Promise<string | null>;
  };

  // readFile / writeFile are intentionally not exposed — see preload.js.
  // Any new file IO must go through a scoped IPC that validates its path.
  fs: {
    getAppPath: (type: string) => Promise<string>;
    getFileStats: (filePath: string) => Promise<{ size: number; mtime?: Date; error?: string }>;
    joinPath: (...pathSegments: string[]) => Promise<string>;
    // Only deletes paths under os.tmpdir(); rejects anything else.
    deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    // Replaces the non-standard File.path removed in Electron 32+.
    getPathForFile: (file: File) => string;
  };

  services: {
    testConnection: (url: string) => Promise<{
      success: boolean;
      status?: number;
      error?: string;
    }>;
    getOllamaModels: (url: string) => Promise<{
      success: boolean;
      models?: any[];
      error?: string;
    }>;
    getModelInfo: (options: { url: string; modelName: string }) => Promise<{
      success: boolean;
      info?: any;
      error?: string;
    }>;
    chatWithOllama: (data: { prompt: string; message: string; context: string }) => Promise<
      | { success: true; response: string; error?: undefined }
      | { success: false; response?: undefined; error?: string }
    >;
    validateTranscript: (text: string) => Promise<{
      success: boolean;
      validatedText: string;
      changes: any[];
      error?: string;
    }>;
    aiListModels: (provider: string, url?: string, apiKey?: string) => Promise<{
      success: boolean;
      models: string[];
      error?: string;
    }>;
    aiTestConnection: (provider: string, url?: string, apiKey?: string) => Promise<{
      success: boolean;
      modelCount?: number;
      error?: string;
    }>;
    aiGetProviders: () => Promise<AIProviderInfo[]>;
    aiGetUsageStats: () => Promise<AIUsageStats>;
    aiResetUsageStats: (scope?: 'session' | 'lifetime' | 'both') => Promise<{ success: boolean }>;
  };

  crypto: {
    isAvailable: () => Promise<boolean>;
    encrypt: (plain: string) => Promise<{
      success: boolean;
      encrypted?: string;
      fallback?: boolean;
      error?: string;
    }>;
    decrypt: (encrypted: string) => Promise<{
      success: boolean;
      plain?: string;
      wasPlain?: boolean;
      error?: string;
    }>;
  };

  vectorStore: {
    initialize: (dbPath?: string) => Promise<void>;
    storeChunks: (chunks: any[], embeddings: any[]) => Promise<void>;
    searchSimilar: (queryEmbedding: number[], options: any) => Promise<any[]>;
    deleteTranscriptChunks: (transcriptId: string) => Promise<void>;
    getTranscriptChunks: (transcriptId: string) => Promise<any[]>;
    updateChunks: (chunks: any[], embeddings: any[]) => Promise<void>;
    getStats: () => Promise<{
      totalChunks: number;
      transcripts: string[];
      avgChunkSize: number;
      speakers: string[];
    }>;
    close: () => Promise<void>;
    reset: () => Promise<{ success: boolean; error?: string }>;
  };

  embedding: {
    initialize: () => Promise<void>;
    embedText: (text: string, metadata?: any) => Promise<{
      embedding: number[];
      text: string;
      metadata?: any;
    }>;
    embedBatch: (texts: string[], metadata?: any[]) => Promise<Array<{
      embedding: number[];
      text: string;
      metadata?: any;
    }>>;
    updateConfig: (config: any) => Promise<void>;
  };

  onNavigate: (callback: (page: string) => void) => void;
  onMenuAction: (callback: (action: string) => void) => void;
  removeAllListeners: (channel: string) => void;

  sidecar: {
    status: () => Promise<{
      state: 'stopped' | 'setting_up' | 'starting' | 'ready' | 'failed';
      port: number | null;
      lastError: string | null;
      setupSteps: string[];
    }>;
    restart: () => Promise<{
      state: 'stopped' | 'setting_up' | 'starting' | 'ready' | 'failed';
      port: number | null;
      lastError: string | null;
      setupSteps: string[];
    }>;
  };

  audio: {
    extractAudio: (inputPath: string, outputPath: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    getMediaInfo: (filePath: string) => Promise<{
      success: boolean;
      duration?: number;
      hasVideo?: boolean;
      hasAudio?: boolean;
      error?: string;
    }>;
    transcribe: (audioPath: string, modelName?: string, enableDiarisation?: boolean) => Promise<{
      success: boolean;
      text?: string;
      error?: string;
      chunkTimings?: Array<ChunkTimingInfo & { speaker?: string }>;
      speakerTurns?: Array<{ start: number; end: number; speaker: string }>;
    }>;
    rediarise: (
      audioPath: string,
      overrides?: {
        clusterThreshold?: number;
        medianFilterFrames?: number;
        minDurationOn?: number;
        minDurationOff?: number;
        noiseMinTotalSeconds?: number;
      }
    ) => Promise<{
      success: boolean;
      speakerTurns?: Array<{ start: number; end: number; speaker: string }>;
      audioDurationSeconds?: number;
      error?: string;
    }>;
    loadTranscriptionModel: (modelName?: string) => Promise<{
      success: boolean;
      modelName?: string;
      error?: string;
    }>;
    onTranscriptionProgress: (
      callback: (data: { status: string; file?: string; progress?: number; model?: string }) => void
    ) => void;
    offTranscriptionProgress: () => void;
  };

  segments: {
    create: (data: { transcriptId: string; segments: any[] }) => Promise<{
      success: boolean;
      error?: string;
    }>;
    getByTranscript: (data: { transcriptId: string; version?: string }) => Promise<any[]>;
    update: (data: { segmentId: string; updates: any }) => Promise<{
      success: boolean;
      error?: string;
    }>;
    deleteByTranscript: (data: { transcriptId: string; version?: string }) => Promise<{
      success: boolean;
      error?: string;
    }>;
    createFromChunks: (data: {
      transcriptId: string;
      chunkTimings: any[];
      version?: string;
    }) => Promise<{ success: boolean; segmentCount?: number; error?: string }>;
  };

  aiPrompts: {
    getByCategory: (category: string) => Promise<any[]>;
    get: (options: { category: string; type: string }) => Promise<any | null>;
    save: (prompt: any) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    resetToDefault: (options: { category: string; type: string }) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };

  // Top-level convenience for compatibility with ModelMetadataService.
  getModelInfo: (options: { url: string; modelName: string }) => Promise<{
    success: boolean;
    info?: any;
    error?: string;
  }>;

  getDatabaseInfo: () => Promise<any>;
  changeDatabaseLocation: (newPath: string) => Promise<{ success: boolean; error?: string }>;
  backupDatabase: (backupPath: string) => Promise<{ success: boolean; error?: string }>;

  shell: {
    showItemInFolder: (fullPath: string) => void;
  };

  platform: NodeJS.Platform;
  versions: {
    electron: string;
    node: string;
    chrome: string;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
