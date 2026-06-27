// Tests for ChatService — the RAG / vector-only / direct-LLM routing and the
// context-building + memory-compaction logic it depends on.
//
// The four collaborator singletons (embedding / vectorStore / prompt /
// modelMetadata) plus the chunking service are mocked, and window.electronAPI
// is replaced with a minimal stub covering exactly the IPC the chat flow
// touches (ai.complete, chat.getMemory/setMemory/addMessage,
// transcripts.getMetadata). No Electron, no DB, no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  chatService,
  type ChatMessage,
  type ConversationMemory,
} from '../src/services/chatService';
import type { SearchResult } from '../src/services/vectorStoreService';
import { embeddingService } from '../src/services/embeddingService';
import { vectorStoreService } from '../src/services/vectorStoreService';

vi.mock('../src/services/embeddingService', () => ({
  embeddingService: {
    initialize: vi.fn(async () => undefined),
    embedText: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3] })),
    isInitialized: () => true,
    getConfig: () => ({ model: 'test-model' }),
  },
}));
vi.mock('../src/services/vectorStoreService', () => ({
  vectorStoreService: {
    initialize: vi.fn(async () => undefined),
    searchSimilar: vi.fn(async () => [] as SearchResult[]),
    storeChunks: vi.fn(async () => undefined),
    deleteTranscriptChunks: vi.fn(async () => undefined),
    getStats: vi.fn(async () => ({ totalChunks: 0, transcripts: [], avgChunkSize: 0, speakers: [] })),
    isInitialized: () => true,
  },
}));
vi.mock('../src/services/promptService', () => ({
  promptService: { getProcessedPrompt: vi.fn(async () => 'MOCK PROMPT') },
}));
vi.mock('../src/services/modelMetadataService', () => ({
  modelMetadataService: {
    getModelMetadata: vi.fn(),
    calculateContextBudget: vi.fn(),
    clearCache: vi.fn(),
  },
}));
vi.mock('../src/services/chunkingService', () => ({
  chunkingService: { updateConfig: vi.fn() },
}));

// The global window.electronAPI is typed (electron.d.ts) as the full bridge;
// tests inject a minimal stub. `as unknown as` widens window to accept it.
// typeof-stub keeps every field concrete — no fabricated shape.
const electronAPI = {
  ai: { complete: vi.fn(async () => ({ ok: true, text: 'LLM ANSWER' })) },
  db: {
    chat: {
      getMemory: vi.fn(async () => null),
      setMemory: vi.fn(async () => undefined),
      addMessage: vi.fn(async () => undefined),
    },
    transcripts: { getMetadata: vi.fn(async () => ({ title: 'T' })) },
  },
};
const win = window as unknown as { electronAPI: typeof electronAPI };
win.electronAPI = electronAPI;

// White-box access to pure private helpers. The public chatWithTranscript
// path needs a fully-initialised service (embeddings + vector store + DB);
// the helpers under test here (context build, fallback summary, time format,
// memory management) carry the real logic with none of those dependencies, so
// we reach them directly via a named, structurally-typed const.
interface ChatServiceInternals {
  isInitialized: boolean;
  buildContextWithMemory(search: SearchResult[], memory: ConversationMemory): string;
  createFallbackSummary(messages: ChatMessage[]): string;
  formatTime(seconds: number): string;
  manageConversationMemory(conversationId: string, messages: ChatMessage[]): Promise<ConversationMemory>;
}
const internals = chatService as unknown as ChatServiceInternals;

function makeMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return { id: `${role}-${Math.random()}`, role, content, timestamp: '' };
}

const searchResult: SearchResult = {
  chunk: {
    id: 'c1',
    transcriptId: 't1',
    text: 'hello there',
    vector: [1],
    startTime: 125,
    endTime: 130,
    chunkIndex: 0,
    wordCount: 2,
    speakers: [],
    method: 'speaker',
    createdAt: '2026-01-01',
    speaker: 'A',
  },
  score: 0.9,
  rank: 1,
};

beforeEach(async () => {
  vi.clearAllMocks();
  // reset default stub implementations + service state
  vi.mocked(electronAPI.ai.complete).mockResolvedValue({ ok: true, text: 'LLM ANSWER' });
  vi.mocked(electronAPI.db.chat.getMemory).mockResolvedValue(null);
  vi.mocked(vectorStoreService.searchSimilar).mockResolvedValue([]);
  internals.isInitialized = true;
  await chatService.updateConfig({ conversationMode: 'rag', conversationMemoryLimit: 20 });
});

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(internals.formatTime(0)).toBe('0:00');
    expect(internals.formatTime(59)).toBe('0:59');
    expect(internals.formatTime(125)).toBe('2:05');
  });
});

describe('buildContextWithMemory', () => {
  it('assembles chunks, summary and recent messages with timestamps/speakers', () => {
    const memory: ConversationMemory = {
      activeMessages: [makeMessage('user', 'what about pricing?')],
      compactedSummary: 'PRIOR SUMMARY',
      totalExchanges: 1,
    };

    const ctx = internals.buildContextWithMemory([searchResult], memory);

    expect(ctx).toContain('[2:05]'); // formatTime(125)
    expect(ctx).toContain('[A]'); // speaker tag
    expect(ctx).toContain('hello there'); // chunk text
    expect(ctx).toContain('PRIOR SUMMARY'); // compacted memory
    expect(ctx).toContain('USER: what about pricing?'); // recent turn
  });

  it('omits the summary/recent sections when memory is empty', () => {
    const empty: ConversationMemory = {
      activeMessages: [],
      compactedSummary: '',
      totalExchanges: 0,
    };
    const ctx = internals.buildContextWithMemory([], empty);
    expect(ctx).toBe('');
  });
});

describe('createFallbackSummary', () => {
  it('lists user topics and excludes assistant turns', () => {
    const summary = internals.createFallbackSummary([
      makeMessage('user', 'pricing'),
      makeMessage('assistant', 'internal detail'),
      makeMessage('user', 'timeline'),
    ]);

    expect(summary).toContain('pricing');
    expect(summary).toContain('timeline');
    expect(summary).not.toContain('internal detail');
    expect(summary).toContain('3 total exchanges');
  });
});

describe('manageConversationMemory', () => {
  it('keeps history as-is when under the limit (no compaction)', async () => {
    const history = [makeMessage('user', 'a'), makeMessage('user', 'b'), makeMessage('user', 'c')];
    await chatService.updateConfig({ conversationMemoryLimit: 5 });

    const memory = await internals.manageConversationMemory('conv', history);

    expect(memory.activeMessages).toHaveLength(3);
    expect(memory.compactedSummary).toBe('');
    expect(electronAPI.db.chat.getMemory).not.toHaveBeenCalled();
    expect(electronAPI.ai.complete).not.toHaveBeenCalled();
  });

  it('compacts older messages and persists memory when over the limit', async () => {
    await chatService.updateConfig({ conversationMemoryLimit: 5 }); // keepCount = floor(5*0.4) = 2
    const history = Array.from({ length: 6 }, (_, i) => makeMessage('user', `m${i}`));
    vi.mocked(electronAPI.ai.complete).mockResolvedValue({ ok: true, text: 'COMPACTION SUMMARY' });

    const memory = await internals.manageConversationMemory('conv', history);

    expect(memory.activeMessages).toHaveLength(2); // last 40% kept active
    expect(memory.compactedSummary).toBe('COMPACTION SUMMARY');
    expect(memory.totalExchanges).toBe(6);
    expect(electronAPI.ai.complete).toHaveBeenCalled(); // compaction call
    expect(electronAPI.db.chat.setMemory).toHaveBeenCalledWith('conv', expect.objectContaining({
      compactedSummary: 'COMPACTION SUMMARY',
      totalExchanges: 6,
    }));
  });
});

describe('chatWithTranscript', () => {
  it('RAG mode: embeds the question, retrieves chunks, calls the LLM', async () => {
    vi.mocked(vectorStoreService.searchSimilar).mockResolvedValue([searchResult]);

    const msg = await chatService.chatWithTranscript('t1', 'conv1', 'What is X?', []);

    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('LLM ANSWER');
    expect(msg.metadata?.mode).toBe('rag');
    expect(msg.metadata?.chunks).toHaveLength(1);
    // question was embedded, then used to search the right transcript
    expect(embeddingService.embedText).toHaveBeenCalledWith('What is X?');
    expect(vectorStoreService.searchSimilar).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ transcriptId: 't1', limit: 4, minScore: 0.1 })
    );
    expect(electronAPI.ai.complete).toHaveBeenCalledTimes(1); // generation only
    // both the user turn and the assistant reply are persisted
    expect(electronAPI.db.chat.addMessage).toHaveBeenCalledTimes(2);
  });

  it('vector-only mode: returns excerpts directly, never calls the LLM', async () => {
    await chatService.updateConfig({ conversationMode: 'vector-only' });
    vi.mocked(vectorStoreService.searchSimilar).mockResolvedValue([searchResult]);

    const msg = await chatService.chatWithTranscript('t1', 'conv1', 'q', []);

    expect(msg.metadata?.mode).toBe('vector-only');
    expect(msg.content).toContain('hello there');
    expect(msg.content).toMatch(/1 relevant excerpt/i);
    expect(electronAPI.ai.complete).not.toHaveBeenCalled();
  });

  it('throws if the service is not initialised', async () => {
    internals.isInitialized = false;
    await expect(chatService.chatWithTranscript('t1', 'conv1', 'q', [])).rejects.toThrow(
      /not initialized/i
    );
  });
});
