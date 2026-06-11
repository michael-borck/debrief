import { SentenceSegment, ChunkTimingInfo } from '../types';

export class SentenceSegmentsService {
  private static instance: SentenceSegmentsService;

  private constructor() {}

  static getInstance(): SentenceSegmentsService {
    if (!SentenceSegmentsService.instance) {
      SentenceSegmentsService.instance = new SentenceSegmentsService();
    }
    return SentenceSegmentsService.instance;
  }

  /**
   * Get sentence segments for a transcript
   */
  async getSegments(transcriptId: string, version?: 'original' | 'corrected' | 'speaker_tagged'): Promise<SentenceSegment[]> {
    try {
      const segments = await window.electronAPI.segments.getByTranscript({
        transcriptId,
        version
      });
      return segments;
    } catch (error) {
      console.error('Error fetching sentence segments:', error);
      return [];
    }
  }

  /**
   * Create segments from chunk timings (used after transcription)
   */
  async createSegmentsFromChunks(
    transcriptId: string, 
    chunkTimings: ChunkTimingInfo[], 
    version: 'original' | 'corrected' | 'speaker_tagged' = 'original'
  ): Promise<boolean> {
    try {
      console.log('Creating segments from chunks:', { 
        transcriptId, 
        chunkCount: chunkTimings.length, 
        version,
        chunkTimings: chunkTimings.map(c => ({
          chunkIndex: c.chunkIndex,
          startTime: c.startTime,
          endTime: c.endTime,
          textLength: c.text.length
        }))
      });
      
      const result = await window.electronAPI.segments.createFromChunks({
        transcriptId,
        chunkTimings,
        version
      });
      
      console.log('Segment creation result:', result);
      
      if (!result.success) {
        console.error('Segment creation failed:', result.error);
      }
      
      return result.success;
    } catch (error) {
      console.error('Error creating segments from chunks:', error);
      return false;
    }
  }

  /**
   * Update a specific segment
   */
  async updateSegment(segmentId: string, updates: Partial<SentenceSegment>): Promise<boolean> {
    try {
      const result = await window.electronAPI.segments.update({
        segmentId,
        updates
      });
      return result.success;
    } catch (error) {
      console.error('Error updating segment:', error);
      return false;
    }
  }

  /**
   * Delete segments for a transcript
   */
  async deleteSegments(transcriptId: string, version?: 'original' | 'corrected' | 'speaker_tagged'): Promise<boolean> {
    try {
      const result = await window.electronAPI.segments.deleteByTranscript({
        transcriptId,
        version
      });
      return result.success;
    } catch (error) {
      console.error('Error deleting segments:', error);
      return false;
    }
  }

  /**
   * Convert segments to full text with optional timestamps
   */
  segmentsToText(segments: SentenceSegment[], includeTimestamps: boolean = false): string {
    return segments
      .sort((a, b) => a.sentence_index - b.sentence_index)
      .map(segment => {
        if (includeTimestamps && segment.start_time !== undefined) {
          const timestamp = this.formatTimestamp(segment.start_time);
          return `${timestamp} ${segment.text}`;
        }
        return segment.text;
      })
      .join('\n\n');
  }

  /**
   * Format seconds to MM:SS or HH:MM:SS timestamp
   */
  private formatTimestamp(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `[${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    } else {
      return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    }
  }

  /**
   * Check if segments exist for a transcript
   */
  async hasSegments(transcriptId: string, version?: 'original' | 'corrected' | 'speaker_tagged'): Promise<boolean> {
    const segments = await this.getSegments(transcriptId, version);
    return segments.length > 0;
  }

  /**
   * Get text for display - either from segments or fallback to full text
   */
  async getDisplayText(
    transcript: any, 
    version: 'original' | 'corrected' | 'speaker_tagged',
    includeTimestamps: boolean = false
  ): Promise<string> {
    // First try to get from segments
    const segments = await this.getSegments(transcript.id, version);
    
    if (segments.length > 0) {
      return this.segmentsToText(segments, includeTimestamps);
    }

    // Fallback to full text fields
    switch (version) {
      case 'corrected':
        return transcript.validated_text || transcript.full_text || '';
      case 'speaker_tagged':
        return transcript.processed_text || transcript.validated_text || transcript.full_text || '';
      default:
        return transcript.full_text || '';
    }
  }

  /**
   * Create corrected version segments from original segments
   */
  async createCorrectedSegments(transcriptId: string, correctedText: string): Promise<boolean> {
    try {
      // Get original segments for timing reference
      const originalSegments = await this.getSegments(transcriptId, 'original');
      
      if (originalSegments.length === 0) {
        console.warn('No original segments found, cannot create corrected segments');
        return false;
      }

      // Simple approach: split corrected text and map to original segment timing
      const correctedSentences = this.splitIntoSentences(correctedText);
      const correctedSegments: any[] = [];

      // Map corrected sentences to original segment timing
      for (let i = 0; i < correctedSentences.length; i++) {
        const originalSegment = originalSegments[i] || originalSegments[originalSegments.length - 1];
        
        correctedSegments.push({
          transcriptId,
          sentenceIndex: i,
          text: correctedSentences[i],
          startTime: originalSegment.start_time,
          endTime: originalSegment.end_time,
          confidence: 0.9, // High confidence for corrected text
          version: 'corrected',
          sourceChunkIndex: originalSegment.source_chunk_index,
          wordCount: this.countWords(correctedSentences[i])
        });
      }

      // Delete existing corrected segments
      await this.deleteSegments(transcriptId, 'corrected');

      // Create new corrected segments
      const result = await window.electronAPI.segments.create({
        transcriptId,
        segments: correctedSegments
      });

      return result.success;
    } catch (error) {
      console.error('Error creating corrected segments:', error);
      return false;
    }
  }

  /**
   * Simple sentence splitting
   */
  private splitIntoSentences(text: string): string[] {
    if (!text?.trim()) return [];

    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && this.countWords(s) >= 2);
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Migrate all existing transcripts to have sentence segments
   */
  async migrateAllTranscripts(): Promise<{ migrated: number; skipped: number; errors: number }> {
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    try {
      // Get all transcripts that don't have segments yet
      const transcripts = await window.electronAPI.db.transcripts.listNeedingSegmentMigration();

      console.log(`Found ${transcripts.length} transcripts to migrate`);

      for (const transcript of transcripts) {
        try {
          if (await this.createBasicSegments(transcript.id, transcript.full_text)) {
            migrated++;
            console.log(`Migrated transcript ${transcript.id}`);
          } else {
            skipped++;
            console.log(`Skipped transcript ${transcript.id} (no content or already exists)`);
          }
        } catch (error) {
          errors++;
          console.error(`Failed to migrate transcript ${transcript.id}:`, error);
        }
      }

      console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
      return { migrated, skipped, errors };
    } catch (error) {
      console.error('Migration failed:', error);
      return { migrated, skipped, errors: errors + 1 };
    }
  }

  /**
   * Create basic segments for existing transcripts without chunk timing
   */
  async createBasicSegments(transcriptId: string, text: string): Promise<boolean> {
    try {
      if (!text?.trim()) {
        console.warn('No text provided for basic segment creation');
        return false;
      }

      // Split text into sentences
      const sentences = this.splitIntoSentences(text);
      if (sentences.length === 0) {
        console.warn('No sentences found in text');
        return false;
      }

      const basicSegments: any[] = [];

      // Create segments without timing info (existing transcripts)
      for (let i = 0; i < sentences.length; i++) {
        basicSegments.push({
          transcriptId,
          sentenceIndex: i,
          text: sentences[i],
          startTime: null, // No timing available for existing transcripts
          endTime: null,
          confidence: 0.8, // Medium confidence for basic segmentation
          version: 'original',
          sourceChunkIndex: null,
          wordCount: this.countWords(sentences[i])
        });
      }

      // Create segments via IPC
      const result = await window.electronAPI.segments.create({
        transcriptId,
        segments: basicSegments
      });

      if (result.success) {
        console.log(`Created ${basicSegments.length} basic segments for transcript ${transcriptId}`);
        return true;
      } else {
        console.error('Failed to create basic segments:', result.error);
        return false;
      }
    } catch (error) {
      console.error('Error creating basic segments:', error);
      return false;
    }
  }
}

// Export singleton instance
export const sentenceSegmentsService = SentenceSegmentsService.getInstance();