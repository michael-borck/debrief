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
const { app } = require('electron');

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
// Render a value as a single-quoted SQL string literal for a LanceDB /
// DataFusion `.where()` / `.delete()` filter, doubling any embedded single
// quotes. Without this, a value like  x' OR '1'='1  would break out of the
// literal and inject filter logic. Quote-doubling is standard SQL escaping and
// preserves legitimate data — e.g. a speaker named "John O'Brien" stays intact,
// which a strict charset whitelist would have rejected.
function sqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

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
        // Create table if it doesn't exist
        // Schema-defining seed. LanceDB infers types from this row, so
        // every field must be present with a value of the type we'll
        // actually store. Nulls and raw arrays break inference — use
        // empty strings, and JSON-stringify list fields to match the
        // format produced by storeChunks().
        const sampleData = [{
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
          createdAt: new Date().toISOString()
        }];

        this.table = await this.db.createTable('chunks', sampleData);
        // Remove sample data
        await this.table.delete('id = "sample"');
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

      let query = this.table.search(queryEmbedding).limit(options.limit || 10);

      // Add filters
      if (options.transcriptId) {
        // Identifiers must be double-quoted — newer LanceDB's SQL parser
        // lowercases unquoted identifiers, so `transcriptId` becomes
        // `transcriptid` and fails to match the schema column.
        query = query.where(`"transcriptId" = ${sqlStringLiteral(options.transcriptId)}`);
      }

      if (options.speaker) {
        query = query.where(`"speaker" = ${sqlStringLiteral(options.speaker)}`);
      }

      const results = await query.toArray();

      // Filter by minimum score if specified
      const filteredResults = options.minScore
        ? results.filter(r => r._distance <= (1 - options.minScore))
        : results;

      // Transform to expected format
      return filteredResults.map((result, i) => ({
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

  async deleteTranscriptChunks(transcriptId) {
    try {
      if (!this.isInitialized) {
        throw new Error('Vector store not initialized');
      }

      await this.table.delete(`"transcriptId" = ${sqlStringLiteral(transcriptId)}`);
      console.log(`Deleted chunks for transcript: ${transcriptId}`);
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
      // Delete existing chunks with same IDs
      for (const chunk of chunks) {
        await this.table.delete(`id = ${sqlStringLiteral(chunk.id)}`);
      }

      // Add updated chunks
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
