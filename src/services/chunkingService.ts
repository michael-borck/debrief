import { TranscriptSegment } from '../types';

export interface ChunkingConfig {
  method: 'speaker' | 'time' | 'hybrid';
  maxChunkSize: number; // seconds
  chunkOverlap: number; // seconds
  minChunkSize: number; // seconds
}

export interface TextChunk {
  id: string;
  transcriptId: string;
  text: string;
  startTime: number;
  endTime: number;
  speaker?: string;
  metadata: {
    chunkIndex: number;
    wordCount: number;
    speakers: string[];
    method: string;
  };
}

export class ChunkingService {
  private static instance: ChunkingService;
  private config: ChunkingConfig;

  private constructor() {
    this.config = {
      method: 'speaker',
      maxChunkSize: 60, // 1 minute
      chunkOverlap: 10, // 10 seconds
      minChunkSize: 5, // 5 seconds minimum
    };
  }

  static getInstance(): ChunkingService {
    if (!ChunkingService.instance) {
      ChunkingService.instance = new ChunkingService();
    }
    return ChunkingService.instance;
  }

  updateConfig(config: Partial<ChunkingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ChunkingConfig {
    return { ...this.config };
  }

  /**
   * Chunk transcript segments based on configuration
   */
  chunkTranscript(
    transcriptId: string,
    segments: TranscriptSegment[],
    fullText?: string
  ): TextChunk[] {
    if (!segments || segments.length === 0) {
      // Fallback to full text chunking if no segments
      return this.chunkFullText(transcriptId, fullText || '');
    }

    switch (this.config.method) {
      case 'speaker':
        return this.chunkBySpeaker(transcriptId, segments);
      case 'time':
        return this.chunkByTime(transcriptId, segments);
      case 'hybrid':
        return this.chunkHybrid(transcriptId, segments);
      default:
        return this.chunkBySpeaker(transcriptId, segments);
    }
  }

  /**
   * Speaker-based chunking (default)
   */
  private chunkBySpeaker(transcriptId: string, segments: TranscriptSegment[]): TextChunk[] {
    const chunks: TextChunk[] = [];
    let currentChunk: TranscriptSegment[] = [];
    let currentSpeaker: string | undefined;
    let chunkIndex = 0;

    for (const segment of segments) {
      // Start new chunk if speaker changes or chunk gets too long
      const shouldStartNewChunk = 
        (segment.speaker !== currentSpeaker && currentChunk.length > 0) ||
        (currentChunk.length > 0 && 
         (segment.end_time - currentChunk[0].start_time) > this.config.maxChunkSize);

      if (shouldStartNewChunk) {
        const chunk = this.createChunkFromSegments(
          transcriptId, 
          currentChunk, 
          chunkIndex++, 
          'speaker'
        );
        if (chunk) chunks.push(chunk);
        
        // Start new chunk with overlap if needed
        currentChunk = this.getOverlapSegments(currentChunk, segments, segment);
      }

      currentChunk.push(segment);
      currentSpeaker = segment.speaker;
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      const chunk = this.createChunkFromSegments(
        transcriptId, 
        currentChunk, 
        chunkIndex, 
        'speaker'
      );
      if (chunk) chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Time-based chunking
   */
  private chunkByTime(transcriptId: string, segments: TranscriptSegment[]): TextChunk[] {
    const chunks: TextChunk[] = [];
    let currentChunk: TranscriptSegment[] = [];
    let chunkStartTime = 0;
    let chunkIndex = 0;

    for (const segment of segments) {
      // Check if adding this segment would exceed max chunk size
      if (currentChunk.length > 0 && 
          (segment.end_time - chunkStartTime) > this.config.maxChunkSize) {
        
        const chunk = this.createChunkFromSegments(
          transcriptId, 
          currentChunk, 
          chunkIndex++, 
          'time'
        );
        if (chunk) chunks.push(chunk);

        // Start new chunk with overlap
        const overlapStartTime = Math.max(
          0, 
          chunkStartTime + this.config.maxChunkSize - this.config.chunkOverlap
        );
        
        currentChunk = segments.filter(s => 
          s.start_time >= overlapStartTime && s.start_time < segment.start_time
        );
        chunkStartTime = overlapStartTime;
      }

      if (currentChunk.length === 0) {
        chunkStartTime = segment.start_time;
      }

      currentChunk.push(segment);
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      const chunk = this.createChunkFromSegments(
        transcriptId, 
        currentChunk, 
        chunkIndex, 
        'time'
      );
      if (chunk) chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Hybrid chunking (speaker-based with time limits)
   */
  private chunkHybrid(transcriptId: string, segments: TranscriptSegment[]): TextChunk[] {
    // Use speaker-based chunking but enforce time limits more strictly
    const speakerChunks = this.chunkBySpeaker(transcriptId, segments);
    const refinedChunks: TextChunk[] = [];

    for (const chunk of speakerChunks) {
      const duration = chunk.endTime - chunk.startTime;
      
      if (duration <= this.config.maxChunkSize) {
        refinedChunks.push(chunk);
      } else {
        // Split large chunks by time
        const chunkSegments = segments.filter(s => 
          s.start_time >= chunk.startTime && s.end_time <= chunk.endTime
        );
        const timeChunks = this.chunkByTime(transcriptId, chunkSegments);
        refinedChunks.push(...timeChunks);
      }
    }

    return refinedChunks;
  }

  /**
   * Fallback: chunk full text when no segments available
   */
  private chunkFullText(transcriptId: string, text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    const words = text.split(/\s+/);
    const wordsPerChunk = Math.ceil(this.config.maxChunkSize * 10); // Rough estimate: 10 words per second
    
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunkWords = words.slice(i, i + wordsPerChunk);
      const chunkText = chunkWords.join(' ');
      
      chunks.push({
        id: `${transcriptId}_chunk_${Math.floor(i / wordsPerChunk)}`,
        transcriptId,
        text: chunkText,
        startTime: (i / wordsPerChunk) * this.config.maxChunkSize,
        endTime: Math.min(((i + chunkWords.length) / wordsPerChunk) * this.config.maxChunkSize, 
                          (words.length / wordsPerChunk) * this.config.maxChunkSize),
        metadata: {
          chunkIndex: Math.floor(i / wordsPerChunk),
          wordCount: chunkWords.length,
          speakers: [],
          method: 'text'
        }
      });
    }

    return chunks;
  }

  /**
   * Create a chunk from transcript segments
   */
  private createChunkFromSegments(
    transcriptId: string,
    segments: TranscriptSegment[],
    index: number,
    method: string
  ): TextChunk | null {
    if (segments.length === 0) return null;

    const text = segments.map(s => s.text).join(' ').trim();
    const startTime = segments[0].start_time;
    const endTime = segments[segments.length - 1].end_time;
    const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))] as string[];
    const wordCount = text.split(/\s+/).length;

    // Skip very short chunks
    if ((endTime - startTime) < this.config.minChunkSize || wordCount < 5) {
      return null;
    }

    return {
      id: `${transcriptId}_chunk_${index}`,
      transcriptId,
      text,
      startTime,
      endTime,
      speaker: speakers.length === 1 ? speakers[0] : undefined,
      metadata: {
        chunkIndex: index,
        wordCount,
        speakers,
        method
      }
    };
  }

  /**
   * Get overlap segments for smooth transitions
   */
  private getOverlapSegments(
    currentChunk: TranscriptSegment[],
    allSegments: TranscriptSegment[],
    nextSegment: TranscriptSegment
  ): TranscriptSegment[] {
    if (this.config.chunkOverlap <= 0 || currentChunk.length === 0) {
      return [];
    }

    const overlapStartTime = Math.max(
      0,
      nextSegment.start_time - this.config.chunkOverlap
    );

    return allSegments.filter(s => 
      s.start_time >= overlapStartTime && 
      s.start_time < nextSegment.start_time
    );
  }

  /**
   * Get chunking statistics
   */
  getChunkingStats(chunks: TextChunk[]): {
    totalChunks: number;
    avgChunkSize: number;
    avgWordCount: number;
    speakers: string[];
    method: string;
  } {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        avgChunkSize: 0,
        avgWordCount: 0,
        speakers: [],
        method: 'none'
      };
    }

    const totalDuration = chunks.reduce((sum, chunk) => 
      sum + (chunk.endTime - chunk.startTime), 0);
    const totalWords = chunks.reduce((sum, chunk) => 
      sum + chunk.metadata.wordCount, 0);
    const allSpeakers = [...new Set(
      chunks.flatMap(chunk => chunk.metadata.speakers)
    )];

    return {
      totalChunks: chunks.length,
      avgChunkSize: totalDuration / chunks.length,
      avgWordCount: totalWords / chunks.length,
      speakers: allSpeakers,
      method: chunks[0]?.metadata.method || 'unknown'
    };
  }
}

// Export singleton instance
export const chunkingService = ChunkingService.getInstance();