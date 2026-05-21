const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object.
//
// TYPE MIRROR: src/types/electron.d.ts must stay in sync with this file.
// When you add, remove, or rename a method here, update electron.d.ts too —
// it is the canonical type definition for window.electronAPI.
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  // LEGACY: generic SQL passthrough. Being migrated to electronAPI.db.*
  // per-domain RPCs (see settings below). Do not add new callers.
  database: {
    query: (type, sql, params) => ipcRenderer.invoke('db-query', { type, sql, params }),
    all: (sql, params) => ipcRenderer.invoke('db-query', { type: 'all', sql, params }),
    get: (sql, params) => ipcRenderer.invoke('db-query', { type: 'get', sql, params }),
    run: (sql, params) => ipcRenderer.invoke('db-query', { type: 'run', sql, params })
  },

  // Per-domain DB RPCs. New code should call these instead of
  // electronAPI.database.* — no SQL crosses the IPC boundary.
  db: {
    settings: {
      get: (key) => ipcRenderer.invoke('settings:get', key),
      getMany: (keys) => ipcRenderer.invoke('settings:get-many', keys),
      getAll: () => ipcRenderer.invoke('settings:get-all'),
      set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
      setMany: (entries) => ipcRenderer.invoke('settings:set-many', entries),
    },
    transcripts: {
      list: () => ipcRenderer.invoke('transcripts:list'),
      listArchived: () => ipcRenderer.invoke('transcripts:list-archived'),
      listTrashed: () => ipcRenderer.invoke('transcripts:list-trashed'),
      get: (id) => ipcRenderer.invoke('transcripts:get', id),
      getForChat: (id) => ipcRenderer.invoke('transcripts:get-for-chat', id),
      getMetadata: (id) => ipcRenderer.invoke('transcripts:get-metadata', id),
      findDuplicates: (filename, title) =>
        ipcRenderer.invoke('transcripts:find-duplicates', { filename, title }),
      listNeedingSegmentMigration: () =>
        ipcRenderer.invoke('transcripts:list-needing-segment-migration'),
      searchByText: (query) => ipcRenderer.invoke('transcripts:search-by-text', query),
      create: (input) => ipcRenderer.invoke('transcripts:create', input),
      update: (id, fields) => ipcRenderer.invoke('transcripts:update', { id, fields }),
      archive: (id) => ipcRenderer.invoke('transcripts:archive', id),
      unarchive: (id) => ipcRenderer.invoke('transcripts:unarchive', id),
      softDelete: (id) => ipcRenderer.invoke('transcripts:soft-delete', id),
      restore: (id) => ipcRenderer.invoke('transcripts:restore', id),
      remove: (id) => ipcRenderer.invoke('transcripts:remove', id),
    },
    projects: {
      get: (id) => ipcRenderer.invoke('projects:get', id),
      listArchived: () => ipcRenderer.invoke('projects:list-archived'),
      listTrashed: () => ipcRenderer.invoke('projects:list-trashed'),
      create: (input) => ipcRenderer.invoke('projects:create', input),
      update: (id, fields) => ipcRenderer.invoke('projects:update', { id, fields }),
      archive: (id) => ipcRenderer.invoke('projects:archive', id),
      unarchive: (id) => ipcRenderer.invoke('projects:unarchive', id),
      restore: (id) => ipcRenderer.invoke('projects:restore', id),
      remove: (id) => ipcRenderer.invoke('projects:remove', id),
    },
    projectTranscripts: {
      listProjectsWithStats: () =>
        ipcRenderer.invoke('project-transcripts:list-projects-with-stats'),
      getProjectWithStats: (id) =>
        ipcRenderer.invoke('project-transcripts:get-project-with-stats', id),
      listTranscriptsForProject: (projectId, options) =>
        ipcRenderer.invoke('project-transcripts:list-transcripts-for-project', {
          projectId,
          options,
        }),
      listProjectIdsForTranscript: (transcriptId) =>
        ipcRenderer.invoke('project-transcripts:list-project-ids-for-transcript', transcriptId),
      countForProject: (projectId) =>
        ipcRenderer.invoke('project-transcripts:count-for-project', projectId),
      listTrashedTranscriptIdsForProject: (projectId) =>
        ipcRenderer.invoke(
          'project-transcripts:list-trashed-transcript-ids-for-project',
          projectId
        ),
      link: (projectId, transcriptId) =>
        ipcRenderer.invoke('project-transcripts:link', { projectId, transcriptId }),
      unlink: (projectId, transcriptId) =>
        ipcRenderer.invoke('project-transcripts:unlink', { projectId, transcriptId }),
    },
    chat: {
      listConversationsWithMeta: () =>
        ipcRenderer.invoke('chat:list-conversations-with-meta'),
      getLatestConversationId: (transcriptId) =>
        ipcRenderer.invoke('chat:get-latest-conversation-id', transcriptId),
      createConversation: (id, transcriptId) =>
        ipcRenderer.invoke('chat:create-conversation', { id, transcriptId }),
      deleteConversation: (id) => ipcRenderer.invoke('chat:delete-conversation', id),
      listMessages: (conversationId) => ipcRenderer.invoke('chat:list-messages', conversationId),
      addMessage: (conversationId, message) =>
        ipcRenderer.invoke('chat:add-message', { conversationId, message }),
      getMemory: (conversationId) => ipcRenderer.invoke('chat:get-memory', conversationId),
      setMemory: (conversationId, memory) =>
        ipcRenderer.invoke('chat:set-memory', { conversationId, memory }),
      deleteMemory: (conversationId) => ipcRenderer.invoke('chat:delete-memory', conversationId),
    },
    projectChat: {
      getLatestConversationId: (projectId) =>
        ipcRenderer.invoke('project-chat:get-latest-conversation-id', projectId),
      createConversation: (id, projectId) =>
        ipcRenderer.invoke('project-chat:create-conversation', { id, projectId }),
      deleteConversation: (id) => ipcRenderer.invoke('project-chat:delete-conversation', id),
      getStats: (projectId) => ipcRenderer.invoke('project-chat:get-stats', projectId),
      listMessages: (conversationId) =>
        ipcRenderer.invoke('project-chat:list-messages', conversationId),
      addMessage: (conversationId, message) =>
        ipcRenderer.invoke('project-chat:add-message', { conversationId, message }),
    },
    transcriptSegments: {
      listByTranscript: (transcriptId) =>
        ipcRenderer.invoke('transcript-segments:list-by-transcript', transcriptId),
      deleteByTranscript: (transcriptId) =>
        ipcRenderer.invoke('transcript-segments:delete-by-transcript', transcriptId),
    },
    topics: {
      listByTranscript: (transcriptId) =>
        ipcRenderer.invoke('topics:list-by-transcript', transcriptId),
      replaceForTranscript: (transcriptId, rows) =>
        ipcRenderer.invoke('topics:replace-for-transcript', { transcriptId, rows }),
      deleteByTranscript: (transcriptId) =>
        ipcRenderer.invoke('topics:delete-by-transcript', transcriptId),
    },
    projectAnalysis: {
      insert: (input) => ipcRenderer.invoke('project-analysis:insert', input),
      getLatestResults: (projectId) =>
        ipcRenderer.invoke('project-analysis:get-latest-results', projectId),
    },
  },

  // Dialog operations
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog-open-file'),
    saveFile: (options) => ipcRenderer.invoke('dialog-save-file', options)
  },

  // File system operations.
  // Note: readFile / writeFile are intentionally NOT exposed. Any new file
  // IO needed by the renderer should go through a scoped IPC that
  // validates paths against an explicit allow-list root (see fs-delete-file
  // for the pattern). The old generic handlers were a full FS escape.
  fs: {
    getAppPath: (type) => ipcRenderer.invoke('get-app-path', type),
    getFileStats: (filePath) => ipcRenderer.invoke('fs-get-file-stats', filePath),
    joinPath: (...pathSegments) => ipcRenderer.invoke('fs-join-path', ...pathSegments),
    deleteFile: (filePath) => ipcRenderer.invoke('fs-delete-file', filePath),
    // Get the absolute path for a File object obtained from a drag-drop event.
    // Replaces the non-standard File.path that was removed in Electron 32+.
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch (err) {
        console.error('webUtils.getPathForFile failed:', err);
        return '';
      }
    }
  },

  // Service operations
  services: {
    testConnection: (url) => ipcRenderer.invoke('test-service-connection', { url }),
    getOllamaModels: (url) => ipcRenderer.invoke('get-ollama-models', { url }),
    getModelInfo: (options) => ipcRenderer.invoke('get-model-info', options),
    chatWithOllama: (data) => ipcRenderer.invoke('chat-with-ollama', data),
    validateTranscript: (text) => ipcRenderer.invoke('validate-transcript', { text }),
    // Multi-provider AI support
    aiListModels: (provider, url, apiKey) => ipcRenderer.invoke('ai-list-models', { provider, url, apiKey }),
    aiTestConnection: (provider, url, apiKey) => ipcRenderer.invoke('ai-test-connection', { provider, url, apiKey }),
    aiGetProviders: () => ipcRenderer.invoke('ai-get-providers'),
    aiGetUsageStats: () => ipcRenderer.invoke('ai-get-usage-stats'),
    aiResetUsageStats: (scope) => ipcRenderer.invoke('ai-reset-usage-stats', { scope })
  },

  // Sensitive value encryption (uses Electron safeStorage / OS keychain)
  crypto: {
    isAvailable: () => ipcRenderer.invoke('crypto-is-available'),
    encrypt: (plain) => ipcRenderer.invoke('crypto-encrypt-string', { plain }),
    decrypt: (encrypted) => ipcRenderer.invoke('crypto-decrypt-string', { encrypted })
  },

  // Vector store operations (delegated to main process)
  vectorStore: {
    initialize: (dbPath) => ipcRenderer.invoke('vector-store-initialize', dbPath),
    storeChunks: (chunks, embeddings) => ipcRenderer.invoke('vector-store-store-chunks', { chunks, embeddings }),
    searchSimilar: (queryEmbedding, options) => ipcRenderer.invoke('vector-store-search-similar', { queryEmbedding, options }),
    deleteTranscriptChunks: (transcriptId) => ipcRenderer.invoke('vector-store-delete-transcript-chunks', transcriptId),
    getTranscriptChunks: (transcriptId) => ipcRenderer.invoke('vector-store-get-transcript-chunks', transcriptId),
    updateChunks: (chunks, embeddings) => ipcRenderer.invoke('vector-store-update-chunks', { chunks, embeddings }),
    getStats: () => ipcRenderer.invoke('vector-store-get-stats'),
    close: () => ipcRenderer.invoke('vector-store-close'),
    reset: () => ipcRenderer.invoke('vector-store-reset')
  },

  // Embedding operations (delegated to main process)
  embedding: {
    initialize: () => ipcRenderer.invoke('embedding-initialize'),
    embedText: (text, metadata) => ipcRenderer.invoke('embedding-embed-text', { text, metadata }),
    embedBatch: (texts, metadata) => ipcRenderer.invoke('embedding-embed-batch', { texts, metadata }),
    updateConfig: (config) => ipcRenderer.invoke('embedding-update-config', config)
  },

  // Navigation events
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (event, page) => callback(page));
  },

  // Menu actions
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (event, action) => callback(action));
  },

  // Remove all listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Embedded Python sidecar (lens/speech-analyser)
  sidecar: {
    status: () => ipcRenderer.invoke('sidecar:status'),
    restart: () => ipcRenderer.invoke('sidecar:restart'),
  },

  // Audio + local Whisper transcription
  audio: {
    extractAudio: (inputPath, outputPath) =>
      ipcRenderer.invoke('extract-audio', { inputPath, outputPath }),
    getMediaInfo: (filePath) =>
      ipcRenderer.invoke('get-media-info', { filePath }),
    transcribe: (audioPath, modelName, enableDiarisation) =>
      ipcRenderer.invoke('local-transcription-transcribe', { audioPath, modelName, enableDiarisation }),
    rediarise: (audioPath, overrides) =>
      ipcRenderer.invoke('local-transcription-rediarise', { audioPath, overrides }),
    loadTranscriptionModel: (modelName) =>
      ipcRenderer.invoke('local-transcription-load-model', { modelName }),
    onTranscriptionProgress: (callback) => {
      ipcRenderer.on('local-transcription-progress', (_event, data) => callback(data));
    },
    offTranscriptionProgress: () => {
      ipcRenderer.removeAllListeners('local-transcription-progress');
    }
  },

  // Sentence segments operations
  segments: {
    create: (data) => ipcRenderer.invoke('segments-create', data),
    getByTranscript: (data) => ipcRenderer.invoke('segments-get-by-transcript', data),
    update: (data) => ipcRenderer.invoke('segments-update', data),
    deleteByTranscript: (data) => ipcRenderer.invoke('segments-delete-by-transcript', data),
    createFromChunks: (data) => ipcRenderer.invoke('segments-create-from-chunks', data)
  },

  // AI Prompts operations
  aiPrompts: {
    getByCategory: (category) => ipcRenderer.invoke('ai-prompts-get-by-category', category),
    get: (options) => ipcRenderer.invoke('ai-prompts-get', options),
    save: (prompt) => ipcRenderer.invoke('ai-prompts-save', prompt),
    delete: (id) => ipcRenderer.invoke('ai-prompts-delete', id),
    resetToDefault: (options) => ipcRenderer.invoke('ai-prompts-reset-to-default', options)
  },

  // Model info (for compatibility with ModelMetadataService)
  getModelInfo: (options) => ipcRenderer.invoke('get-model-info', options),

  // Database management
  getDatabaseInfo: () => ipcRenderer.invoke('get-database-info'),
  changeDatabaseLocation: (newPath) => ipcRenderer.invoke('change-database-location', newPath),
  backupDatabase: (backupPath) => ipcRenderer.invoke('backup-database', backupPath),
  
  // Shell operations
  shell: {
    showItemInFolder: (fullPath) => ipcRenderer.send('show-item-in-folder', fullPath)
  },
  
  // System information
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }
});