// ============================================
// LanceDB-backed vector store for transcript chunks
// ============================================
//
// Stores per-chunk embeddings + metadata for semantic search and RAG.
// LanceDB is an optional dependency: if it fails to load, the store
// degrades to a no-op (initialize/store/search all succeed silently
// with empty results) so the rest of the app keeps working.

const path = require('path');
const fs = require('fs');
// electron is only needed to resolve the default userData path. Guard the
// require so the module can load (and be unit-tested) outside Electron, where
// require('electron') throws — callers that pass an explicit dbPath never need
// app at all.
let app;
try {
  ({ app } = require('electron'));
} catch {
  app = null;
}

let lancedb;
try {
  lancedb = require('@lancedb/lancedb');
} catch (error) {
  console.warn('LanceDB not available, using fallback vector store:', error.message);
  lancedb = null;
}

// Safe parse for the `speakers` JSON-string column. A single malformed
// chunk row used to throw out of the surrounding .map() and tank the
// whole RAG retrieval / stats call. Now bad rows fall back to [] and log.
// LanceDB 0.20 has a confirmed bug: string-equality `.where()` predicates on
// Utf8 columns return ZERO rows (numeric predicates work fine; unquoted
// identifiers get lowercased and error; correctly-quoted ones still match
// nothing). So we cannot filter or delete by transcriptId/id/speaker via SQL.
// Every read filters in JS and every delete rebuilds the table without the
// dropped rows. If LanceDB is upgraded to a version where Utf8 `.where()`
// works, these can all revert to simple predicates.

// Convert a row read back from LanceDB into a plain object suitable for
// re-insertion (the vector comes back as an Arrow Vector, not a JS array).
function rowToPlain(row) {
  const out = { ...row };
  if (out.vector != null && typeof out.vector.length === 'number') {
    out.vector = Array.from(out.vector);
  }
  return out;
}

// Schema-defining seed row. LanceDB infers column types from the first row, so
// every field must be present with a representative value (no nulls, JSON list
// fields stringified to match storeChunks). Used to (re)create the empty table.
const SEED_ROW = {
  id: 'sample',
  transcriptId: 'sample',
  text: 'sample text',
  vector: new Array(384).fill(0),
  startTime: 0,
  endTime: 1,
  speaker: '',
  chunkIndex: 0,
  wordCount: 2,
  speakers: JSON.stringify([]),
  method: 'sample',
  transcriptTitle: 'sample',
  transcriptSummary: 'sample',
  keyTopics: JSON.stringify([]),
  actionItems: JSON.stringify([]),
  totalSpeakers: 1,
  createdAt: new Date().toISOString(),
};

function parseSpeakers(raw, chunkId) {
  if (raw === null || raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') return Array.isArray(raw) ? raw : [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(
      `vector-store: malformed speakers JSON on chunk ${chunkId ?? '?'}, using []`,
      err.message
    );
    return [];
  }
}

class MainVectorStore {
  constructor() {
    this.db = null;
    this.table = null;
    this.isInitialized = false;
  }

  async initialize(dbPath) {
    try {
      if (this.isInitialized) {
        return;
      }

      // Use user data directory if no path specified
      const vectorDbPath = dbPath || path.join(app.getPath('userData'), 'vectordb');

      // Ensure directory exists
      if (!fs.existsSync(vectorDbPath)) {
        fs.mkdirSync(vectorDbPath, { recursive: true });
      }

      // Connect to LanceDB (if available)
      if (!lancedb) {
        console.warn('LanceDB not available, using fallback vector store');
        this.db = null;
        this.table = null;
        return;
      }

      this.db = await lancedb.connect(vectorDbPath);

      // Try to open existing table or create new one
      try {
        this.table = await this.db.openTable('chunks');
        console.log('Opened existing chunks table');
      } catch (error) {
        // Create table from the schema-defining seed row. The seed row stays
        // in the table (LanceDB 0.20's string `.where()` can't delete it — see
        // the note at the top), but it carries transcriptId 'sample' so the
        // JS transcript filter in searchSimilar excludes it from real results.
        this.table = await this.db.createTable('chunks', [{ ...SEED_ROW }]);
        console.log('Created new chunks table');
      }

      this.isInitialized = true;
      console.log('Vector store initialized at:', vectorDbPath);
    } catch (error) {
      console.error('Failed to initialize vector store:', error);
      throw error;
    }
  }

  async storeChunks(chunks, embeddings) {
    try {
      if (!this.isInitialized) {
        throw new Error('Vector store not initialized');
      }

      // If LanceDB is not available, skip storing
      if (!this.db || !this.table) {
        console.warn('LanceDB not available, skipping chunk storage');
        return;
      }

      const records = chunks.map((chunk, i) => {
        const embedding = embeddings[i];
        return {
          id: chunk.id,
          transcriptId: chunk.transcriptId,
          text: chunk.text,
          vector: embedding?.embedding || new Array(384).fill(0),
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          speaker: chunk.speaker || '',
          chunkIndex: chunk.metadata?.chunkIndex || i,
          wordCount: chunk.metadata?.wordCount || chunk.text.split(' ').length,
          speakers: JSON.stringify(chunk.metadata?.speakers || []),
          method: chunk.metadata?.method || 'unknown',
          // Enhanced metadata from embedding
          transcriptTitle: embedding?.metadata?.transcriptTitle || '',
          transcriptSummary: embedding?.metadata?.transcriptSummary || '',
          keyTopics: JSON.stringify(embedding?.metadata?.keyTopics || []),
          actionItems: JSON.stringify(embedding?.metadata?.actionItems || []),
          totalSpeakers: embedding?.metadata?.totalSpeakers || 1,
          createdAt: new Date().toISOString()
        };
      });

      await this.table.add(records);
      console.log(`Stored ${records.length} chunks in vector database`);
    } catch (error) {
      console.error('Failed to store chunks:', error);
      throw error;
    }
  }

  async searchSimilar(queryEmbedding, options = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('Vector store not initialized');
      }

      // If LanceDB is not available, return empty results
      if (!this.db || !this.table) {
        console.warn('LanceDB not available, returning empty search results');
        return [];
      }

      const limit = options.limit || 10;
      const needsFilter = !!(options.transcriptId || options.speaker);
      // String `.where()` is broken in LanceDB 0.20, so filter in JS. When a
      // transcript/speaker filter is requested we over-fetch by vector distance
      // (the matching chunks may not be in the global top-N) and trim after.
      const fetchLimit = needsFilter ? Math.max(limit * 20, 200) : limit;

      let results = await this.table.search(queryEmbedding).limit(fetchLimit).toArray();

      // Exclude the schema seed row, then apply the requested filters in JS.
      results = results.filter((r) => r.transcriptId !== 'sample');
      if (options.transcriptId) {
        results = results.filter((r) => r.transcriptId === options.transcriptId);
      }
      if (options.speaker) {
        results = results.filter((r) => r.speaker === options.speaker);
      }
      if (options.minScore) {
        results = results.filter((r) => r._distance <= (1 - options.minScore));
      }
      results = results.slice(0, limit);

      // Transform to expected format
      return results.map((result, i) => ({
        chunk: {
          id: result.id,
          transcriptId: result.transcriptId,
          text: result.text,
          startTime: result.startTime,
          endTime: result.endTime,
          speaker: result.speaker,
          chunkIndex: result.chunkIndex,
          wordCount: result.wordCount,
          speakers: parseSpeakers(result.speakers, result.id),
          method: result.method,
          createdAt: result.createdAt
        },
        score: 1 - result._distance, // Convert distance to similarity score
        rank: i + 1
      }));
    } catch (error) {
      console.error('Failed to search similar chunks:', error);
      throw error;
    }
  }

  // Rebuild the chunks table keeping only rows for which keepFn returns true.
  // This is how we "delete" — LanceDB 0.20's string `.where()` can't match
  // Utf8 columns, so predicate deletes are no-ops. Read all, filter in JS, drop
  // and recreate. Returns the number of rows removed.
  async _rebuildKeeping(keepFn) {
    if (!this.db || !this.table) return 0;
    const all = await this.table.query().toArray();
    const remaining = all.filter(keepFn);
    const removed = all.length - remaining.length;
    if (removed === 0) return 0;
    await this.db.dropTable('chunks');
    if (remaining.length > 0) {
      this.table = await this.db.createTable('chunks', remaining.map(rowToPlain));
    } else {
      // Keep an empty (seed-only) table so future adds still work.
      this.table = await this.db.createTable('chunks', [{ ...SEED_ROW }]);
    }
    return removed;
  }

  async deleteTranscriptChunks(transcriptId) {
    try {
      if (!this.isInitialized) {
        throw new Error('Vector store not initialized');
      }
      if (!this.db || !this.table) return;

      const removed = await this._rebuildKeeping((r) => r.transcriptId !== transcriptId);
      console.log(`Deleted ${removed} chunks for transcript: ${transcriptId}`);
    } catch (error) {
      console.error('Failed to delete transcript chunks:', error);
      throw error;
    }
  }

  async getTranscriptChunks(transcriptId) {
    try {
      if (!this.isInitialized) {
        throw new Error('Vector store not initialized');
      }

      // LanceDB 0.20's SQL filter via .where() silently returns 0 rows
      // for string-equality predicates on our tables (verified locally:
      // countRows=3, toArray()+JS-filter=3, .where("col = 'val'")=0).
      // Looks like a Lance/DataFusion bug specific to this version. Until
      // it's fixed upstream, fetch all rows and filter in JS — the
      // dataset is small enough (hundreds of chunks per transcript max)
      // that the cost is negligible compared to the vector-search path.
      const all = await this.table.query().toArray();
      const results = all.filter(r => r.transcriptId === transcriptId);

      return results.map(result => ({
        id: result.id,
        transcriptId: result.transcriptId,
        text: result.text,
        vector: result.vector,
        startTime: result.startTime,
        endTime: result.endTime,
        speaker: result.speaker,
        chunkIndex: result.chunkIndex,
        wordCount: result.wordCount,
        speakers: parseSpeakers(result.speakers, result.id),
        method: result.method,
        createdAt: result.createdAt
      }));
    } catch (error) {
      console.error('Failed to get transcript chunks:', error);
      throw error;
    }
  }

  async updateChunks(chunks, embeddings) {
    try {
      // Remove existing rows with the same ids (one table rebuild), then add
      // the updated versions. Predicate deletes don't work in LanceDB 0.20.
      const ids = new Set(chunks.map((c) => c.id));
      if (this.db && this.table) {
        await this._rebuildKeeping((r) => !ids.has(r.id));
      }
      await this.storeChunks(chunks, embeddings);
    } catch (error) {
      console.error('Failed to update chunks:', error);
      throw error;
    }
  }

  async getStats() {
    try {
      if (!this.isInitialized) {
        return {
          totalChunks: 0,
          transcripts: [],
          avgChunkSize: 0,
          speakers: []
        };
      }

      const allChunks = await this.table.query().toArray();
      const transcriptIds = [...new Set(allChunks.map(c => c.transcriptId))];
      const speakers = [...new Set(allChunks.flatMap(c => parseSpeakers(c.speakers, c.id)))];

      const avgChunkSize = allChunks.length > 0
        ? allChunks.reduce((sum, c) => sum + (c.endTime - c.startTime), 0) / allChunks.length
        : 0;

      return {
        totalChunks: allChunks.length,
        transcripts: transcriptIds,
        avgChunkSize,
        speakers
      };
    } catch (error) {
      console.error('Failed to get vector store stats:', error);
      return {
        totalChunks: 0,
        transcripts: [],
        avgChunkSize: 0,
        speakers: []
      };
    }
  }

  async close() {
    try {
      if (this.db) {
        await this.db.close();
      }
      this.isInitialized = false;
      console.log('Vector store closed');
    } catch (error) {
      console.error('Error closing vector store:', error);
    }
  }

  async reset() {
    try {
      if (this.isInitialized && this.table) {
        // Delete all records from the table
        await this.table.delete('1 = 1'); // Delete all
        console.log('Vector store reset - all chunks deleted');
      }
    } catch (error) {
      console.error('Error resetting vector store:', error);
      throw error;
    }
  }
}

module.exports = { MainVectorStore };
