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
  /**
   * Per-domain DB RPCs — the only DB surface exposed to the renderer. No SQL
   * crosses the IPC boundary; inputs are validated in the main process. (The
   * generic db-query passthrough was removed in Tier 0.6 / C-SEC-3.)
   */
  db: {
    settings: {
      /** Returns the value for `key`, or null if not set. */
      get: (key: string) => Promise<string | null>;
      /** Returns a map of the keys that exist. Missing keys are omitted. */
      getMany: (keys: string[]) => Promise<Record<string, string>>;
      /** Returns every key/value pair in the settings table. */
      getAll: () => Promise<Record<string, string>>;
      /** Upserts a single key/value pair. Both must be strings. */
      set: (key: string, value: string) => Promise<{ success: true }>;
      /** Atomically upserts each key/value pair in `entries`. */
      setMany: (entries: Record<string, string>) => Promise<{ success: true }>;
    };

    /**
     * Single-table transcripts operations. Rows are returned RAW (JSON
     * columns are still strings, booleans are 0/1) — the renderer hydrates
     * them via hydrateTranscriptRow. Cross-table reads (transcripts JOIN
     * project_transcripts) live in their own domain, not here.
     */
    transcripts: {
      /** Non-trashed transcripts, newest first. */
      list: () => Promise<any[]>;
      /** Archived transcripts, newest archived first. */
      listArchived: () => Promise<any[]>;
      /** Trashed transcripts, newest deleted first. */
      listTrashed: () => Promise<any[]>;
      /** Full row by id, or null. */
      get: (id: string) => Promise<any | null>;
      /** { title, full_text, processed_text } for direct-LLM chat, or null. */
      getForChat: (id: string) => Promise<any | null>;
      /** { title, duration, speaker_count } for chat sizing, or null. */
      getMetadata: (id: string) => Promise<any | null>;
      /** Rows matching filename or title (upload dedup check). */
      findDuplicates: (filename: string, title: string) => Promise<any[]>;
      /** Completed transcripts lacking 'original' segments (back-fill). */
      listNeedingSegmentMigration: () => Promise<any[]>;
      /** Full-text-ish search over title/full_text/summary. */
      searchByText: (query: string) => Promise<any[]>;
      /** Inserts a new transcript row; created_at/updated_at set in main. */
      create: (input: {
        id: string;
        title: string;
        filename: string;
        file_path?: string | null;
        file_size?: number | null;
        status?: string;
        starred?: boolean | number;
      }) => Promise<{ id: string }>;
      /** Updates allow-listed columns only; rejects unknown column names. */
      update: (id: string, fields: Record<string, unknown>) => Promise<{ changes: number }>;
      archive: (id: string) => Promise<{ success: true }>;
      unarchive: (id: string) => Promise<{ success: true }>;
      softDelete: (id: string) => Promise<{ success: true }>;
      restore: (id: string) => Promise<{ success: true }>;
      remove: (id: string) => Promise<{ changes: number }>;
    };

    /**
     * Single-table projects operations. Rows are returned RAW (themes/
     * key_insights/tags are still JSON strings) — the renderer parses them.
     * The aggregate list/detail reads that JOIN project_transcripts +
     * transcripts live in their own domain, not here.
     */
    projects: {
      /** Full row by id (excludes trashed), or null. */
      get: (id: string) => Promise<any | null>;
      /** Archived projects, newest archived first. */
      listArchived: () => Promise<any[]>;
      /** Trashed projects, newest deleted first. */
      listTrashed: () => Promise<any[]>;
      /** Inserts a new project; created_at/updated_at set in main. */
      create: (input: {
        id: string;
        name: string;
        description?: string | null;
        themes?: unknown;
        key_insights?: unknown;
        tags?: unknown;
        color?: string | null;
        icon?: string | null;
      }) => Promise<{ id: string }>;
      /** Updates allow-listed columns only; rejects unknown column names. */
      update: (id: string, fields: Record<string, unknown>) => Promise<{ changes: number }>;
      archive: (id: string) => Promise<{ success: true }>;
      unarchive: (id: string) => Promise<{ success: true }>;
      restore: (id: string) => Promise<{ success: true }>;
      remove: (id: string) => Promise<{ changes: number }>;
    };

    /**
     * The project_transcripts junction plus the cross-table reads that join
     * projects ⇄ transcripts. The JOIN SQL lives in main; the renderer only
     * names the read it wants. Rows are returned RAW (JSON columns are still
     * strings) — the renderer hydrates.
     */
    projectTranscripts: {
      /** Live, non-archived projects + rollup stats (transcript_count, etc). */
      listProjectsWithStats: () => Promise<any[]>;
      /** One project + rollup stats (includes archived/trashed), or null. */
      getProjectWithStats: (id: string) => Promise<any | null>;
      /** A project's transcripts (raw rows + added_at). */
      listTranscriptsForProject: (
        projectId: string,
        options?: {
          includeDeleted?: boolean;
          completedOnly?: boolean;
          orderBy?: 'added_desc' | 'created_desc' | 'created_asc';
        }
      ) => Promise<any[]>;
      /** [{ project_id }] for each project a transcript is filed under. */
      listProjectIdsForTranscript: (transcriptId: string) => Promise<{ project_id: string }[]>;
      /** Number of transcripts filed under a project. */
      countForProject: (projectId: string) => Promise<number>;
      /** [{ id }] of a project's still-trashed transcripts (cascade-restore). */
      listTrashedTranscriptIdsForProject: (projectId: string) => Promise<{ id: string }[]>;
      /** Files a transcript under a project (INSERT OR IGNORE). */
      link: (projectId: string, transcriptId: string) => Promise<{ changes: number }>;
      /** Removes a transcript from a project. */
      unlink: (projectId: string, transcriptId: string) => Promise<{ changes: number }>;
    };

    /**
     * Transcript-chat tables (chat_conversations + chat_messages +
     * conversation_memory). Project-level chat lives in its own domain.
     * Reads return raw rows; the renderer maps them.
     */
    chat: {
      /** Chat-history list: conversations + message_count/last_message/title. */
      listConversationsWithMeta: () => Promise<any[]>;
      /** { id } of a transcript's most recent conversation, or null. */
      getLatestConversationId: (transcriptId: string) => Promise<{ id: string } | null>;
      /** Inserts a new conversation row. */
      createConversation: (id: string, transcriptId: string) => Promise<{ id: string }>;
      /** Deletes a conversation; messages + memory cascade. */
      deleteConversation: (id: string) => Promise<{ changes: number }>;
      /** Messages for a conversation, oldest first (raw rows). */
      listMessages: (conversationId: string) => Promise<any[]>;
      /** Appends a message; role must be 'user' or 'assistant'. */
      addMessage: (
        conversationId: string,
        message: { role: string; content: string; created_at?: string }
      ) => Promise<{ id: number | bigint }>;
      /** Compacted memory row for a conversation, or null. */
      getMemory: (conversationId: string) => Promise<any | null>;
      /** Upserts the compacted memory row (INSERT OR REPLACE). */
      setMemory: (
        conversationId: string,
        memory: {
          compactedSummary?: string;
          totalExchanges?: number;
          lastCompactionAt?: string;
        }
      ) => Promise<{ success: true }>;
      /** Clears a conversation's memory row. */
      deleteMemory: (conversationId: string) => Promise<{ changes: number }>;
    };

    /**
     * Project-level chat (project_chat_conversations + project_chat_messages).
     * Mirrors `chat` but keyed on a project. Reads return raw rows.
     */
    projectChat: {
      /** { id } of a project's most recent conversation, or null. */
      getLatestConversationId: (projectId: string) => Promise<{ id: string } | null>;
      /** Inserts a new project conversation. */
      createConversation: (id: string, projectId: string) => Promise<{ id: string }>;
      /** Deletes a conversation; messages cascade. */
      deleteConversation: (id: string) => Promise<{ changes: number }>;
      /** { conversation_count, message_count, last_activity } for a project. */
      getStats: (projectId: string) => Promise<{
        conversation_count: number;
        message_count: number;
        last_activity: string | null;
      }>;
      /** Messages for a conversation, oldest first (raw rows). */
      listMessages: (conversationId: string) => Promise<any[]>;
      /** Appends a message; role must be 'user' or 'assistant'. */
      addMessage: (
        conversationId: string,
        message: { role: string; content: string; created_at?: string }
      ) => Promise<{ id: number | bigint }>;
    };

    /**
     * The raw-SQL transcript_segments reads/deletes that used to go through
     * db-query. Distinct from the version-aware `electronAPI.segments` API:
     * this is an all-versions read (start_time order) + all-versions delete.
     */
    transcriptSegments: {
      /** All segments for a transcript (every version), ordered by start_time. */
      listByTranscript: (transcriptId: string) => Promise<any[]>;
      /** Deletes every segment for a transcript (all versions). */
      deleteByTranscript: (transcriptId: string) => Promise<{ changes: number }>;
    };

    /**
     * Cached Topics-tab clusters (transcript_topics). Reads return raw rows
     * (chunk_ids/centroid still JSON strings); the renderer hydrates.
     */
    topics: {
      /** Cached topics for a transcript, ordered by topic_index. */
      listByTranscript: (transcriptId: string) => Promise<any[]>;
      /** Atomically replaces a transcript's topic set with `rows`. */
      replaceForTranscript: (
        transcriptId: string,
        rows: Array<{
          id: string;
          topic_index?: number;
          label?: string;
          summary?: string | null;
          chunk_ids?: unknown;
          centroid?: unknown;
          model_used?: string | null;
        }>
      ) => Promise<{ count: number }>;
      /** Deletes all cached topics for a transcript. */
      deleteByTranscript: (transcriptId: string) => Promise<{ changes: number }>;
    };

    /**
     * Cached cross-transcript analysis (project_analysis). `results` is
     * serialized in main if an object is passed; reads return the raw row
     * (results still a JSON string) for the renderer to parse.
     */
    projectAnalysis: {
      /** Inserts one analysis row; createdAt optional (schema default else). */
      insert: (input: {
        id: string;
        projectId: string;
        analysisType: string;
        results: unknown;
        createdAt?: string;
      }) => Promise<{ id: string }>;
      /** Most recent { results } for a project, or null. */
      getLatestResults: (projectId: string) => Promise<{ results: string } | null>;
    };

    /**
     * Cached per-model context limits / capabilities (model_metadata). get
     * returns the raw row (JSON columns still strings, flags still 0/1);
     * upsert serializes + coerces in main.
     */
    modelMetadata: {
      /** Raw model_metadata row by model_name, or null. */
      get: (modelName: string) => Promise<any | null>;
      /** Inserts or replaces a model's metadata. */
      upsert: (input: {
        modelName: string;
        provider: string;
        contextLimit?: number;
        capabilities?: unknown;
        parameters?: unknown;
        lastUpdated?: string;
        userOverride?: boolean;
        isAvailable?: boolean;
      }) => Promise<{ success: true }>;
    };
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

  // Unified AI completion (main-process Completion module). Provider/key/model
  // resolution and JSON mode all live behind complete(); callers know nothing
  // about providers. Pass a requestId to enable mid-flight cancel.
  ai: {
    complete: (spec: {
      prompt: string;
      expects?: 'text' | 'json';
      options?: { temperature?: number; maxTokens?: number; timeout?: number };
      requestId?: string;
    }) => Promise<{
      ok: boolean;
      text?: string;
      raw?: string;
      data?: any | null;
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      error?: string;
      provider?: string;
      model?: string;
    }>;
    cancel: (requestId: string) => Promise<{ ok: boolean }>;
  };

  // Encrypt-only: no decrypt is exposed. Stored secrets are decrypted in main
  // (resolveApiKey / decryptIfNeeded) and never returned to the renderer.
  crypto: {
    isAvailable: () => Promise<boolean>;
    encrypt: (plain: string) => Promise<{
      success: boolean;
      encrypted?: string;
      fallback?: boolean;
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
