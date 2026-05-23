// Note: Cannot use path module in renderer process

import { promptService } from './promptService';
import { sentenceSegmentsService } from './sentenceSegmentsService';
import type { TranscriptionStage } from '../types';
import { abortable, checkCancelled, isCancelled } from '../utils/cancellation';

interface ProcessingCallbacks {
  onProgress?: (stage: TranscriptionStage, percent: number) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  onCancelled?: () => void;
  signal?: AbortSignal;
}

export class FileProcessor {
  async processFile(
    filePath: string,
    transcriptId: string,
    callbacks: ProcessingCallbacks = {}
  ): Promise<void> {
    const { signal } = callbacks;
    // Hoisted above the try so the finally can clean up the extracted WAV on
    // every exit path (success, error, cancel) — previously it only ran on the
    // happy path, so failed/cancelled video imports leaked temp WAVs.
    let audioPath = filePath;
    try {
      // Step 1: Get media info
      callbacks.onProgress?.('analyzing_media', 0);
      checkCancelled(signal);
      const mediaInfo = await abortable(window.electronAPI.audio.getMediaInfo(filePath), signal);

      if (!mediaInfo.success) {
        throw new Error(mediaInfo.error || 'Failed to get media info');
      }

      // Step 2: Extract audio if it's a video file
      if (mediaInfo.hasVideo) {
        callbacks.onProgress?.('extracting', 0);
        checkCancelled(signal);

        // Create temp audio file path
        const tempDir = await window.electronAPI.fs.getAppPath('temp');
        const audioFileName = `${transcriptId}_audio.wav`;
        audioPath = await window.electronAPI.fs.joinPath(tempDir, audioFileName);

        const extractResult = await abortable(
          window.electronAPI.audio.extractAudio(filePath, audioPath),
          signal
        );

        if (!extractResult.success) {
          throw new Error(extractResult.error || 'Failed to extract audio');
        }

        callbacks.onProgress?.('extracting', 100);
      }

      // Step 3: Send to STT service
      callbacks.onProgress?.('transcribing', 0);
      checkCancelled(signal);

      const transcriptResult = await this.transcribeAudio(audioPath, callbacks.onProgress, signal);

      console.log('Transcription result:', transcriptResult);

      if (!transcriptResult.success) {
        throw new Error(transcriptResult.error || 'Failed to transcribe audio');
      }

      if (!transcriptResult.text || transcriptResult.text.trim() === '') {
        console.warn('Warning: Empty transcript text received');
      }

      callbacks.onProgress?.('transcribing', 100);

      // Step 3.5: Validate transcript (if enabled)
      callbacks.onProgress?.('validating', 0);
      checkCancelled(signal);
      const validationResult = await this.validateTranscript(transcriptResult.text || '', signal);
      callbacks.onProgress?.('validating', 100);
      
      // Determine which text to use for analysis
      const analyzeValidated = await window.electronAPI.db.settings.get('analyzeValidatedTranscript');
      const textForAnalysis = (analyzeValidated === 'true' && validationResult.validatedText)
        ? validationResult.validatedText
        : transcriptResult.text || '';

      // Step 4: AI Analysis
      callbacks.onProgress?.('analyzing', 0);
      checkCancelled(signal);

      const analysisResult = await this.analyzeTranscript(textForAnalysis, callbacks.onProgress, signal);

      callbacks.onProgress?.('analyzing', 50);
      checkCancelled(signal);

      // Step 4.5: Advanced Analysis (sentiment, speakers, emotions)
      // Use validated text if available and setting is enabled
      const textForAdvancedAnalysis = (analyzeValidated === 'true' && validationResult.validatedText)
        ? validationResult.validatedText
        : transcriptResult.text || '';
      const advancedAnalysisResult = await this.performAdvancedAnalysis(textForAdvancedAnalysis, callbacks.onProgress, signal);

      // If the local diarisation pipeline produced real speaker turns,
      // they override anything the LLM speaker-tagging path produced.
      // Real audio diarisation > LLM guessing from text.
      if (transcriptResult.speakerTurns && transcriptResult.speakerTurns.length > 0) {
        const uniqueSpeakers = Array.from(
          new Set(transcriptResult.speakerTurns.map(t => t.speaker))
        );
        const segmentCounts: Record<string, number> = {};
        for (const turn of transcriptResult.speakerTurns) {
          segmentCounts[turn.speaker] = (segmentCounts[turn.speaker] || 0) + 1;
        }
        advancedAnalysisResult.speakerCount = uniqueSpeakers.length;
        advancedAnalysisResult.speakers = uniqueSpeakers.map((name) => ({
          id: name,
          name,
          segments: segmentCounts[name] || 0,
        }));
        console.log(`[fileProcessor] using diarisation speakers: ${uniqueSpeakers.length} found`);
      }

      callbacks.onProgress?.('analyzing', 75);
      checkCancelled(signal);

      // Step 4.6: Research Analysis (quotes, themes, Q&A, concepts)
      const researchAnalysisResult = await this.performResearchAnalysis(transcriptResult.text || '', callbacks.onProgress, signal);

      callbacks.onProgress?.('analyzing', 100);
      checkCancelled(signal);

      // Step 5: Save to database
      callbacks.onProgress?.('saving', 0);
      
      // Update transcript with results
      console.log('Saving transcript to database:', {
        transcriptId,
        textLength: (transcriptResult.text || '').length,
        duration: mediaInfo.duration || 0,
        analysisCompleted: !!analysisResult
      });
      
      const updateResult = await window.electronAPI.db.transcripts.update(transcriptId, {
        status: 'completed',
        duration: mediaInfo.duration || 0,
        full_text: transcriptResult.text || '',
        validated_text: validationResult.validatedText || transcriptResult.text || '',
        validation_changes: validationResult.changes || [],
        processed_text: advancedAnalysisResult.processedText || transcriptResult.text || '',
        summary: analysisResult.summary || '',
        key_topics: analysisResult.keyTopics || [],
        action_items: analysisResult.actionItems || [],
        sentiment_overall: advancedAnalysisResult.sentiment || 'neutral',
        sentiment_score: advancedAnalysisResult.sentimentScore || 0,
        emotions: advancedAnalysisResult.emotions || {},
        speaker_count: advancedAnalysisResult.speakerCount || 1,
        speakers: advancedAnalysisResult.speakers || [],
        notable_quotes: researchAnalysisResult.notableQuotes || [],
        research_themes: researchAnalysisResult.researchThemes || [],
        qa_pairs: researchAnalysisResult.qaPairs || [],
        concept_frequency: researchAnalysisResult.conceptFrequency || {},
        processing_completed_at: new Date().toISOString(),
      });
      
      console.log('Database update result:', updateResult);
      
      callbacks.onProgress?.('saving', 100);

      // Step 6: Create sentence segments from transcription
      if (transcriptResult.chunkTimings && transcriptResult.chunkTimings.length > 0) {
        console.log('Creating sentence segments from chunk timings...');
        try {
          const segmentSuccess = await sentenceSegmentsService.createSegmentsFromChunks(
            transcriptId,
            transcriptResult.chunkTimings,
            'original'
          );
          
          if (segmentSuccess) {
            console.log('Successfully created sentence segments');
          } else {
            console.warn('Failed to create sentence segments');
          }
        } catch (segmentError) {
          console.error('Error creating sentence segments:', segmentError);
          // Don't fail the whole process for segment creation errors
        }
      } else {
        console.warn('No chunk timings available for segment creation');
      }
      
      callbacks.onComplete?.();
    } catch (error) {
      if (isCancelled(error)) {
        console.log('Processing cancelled by user:', transcriptId);
        // The user expectation: cancel = it never happened. Delete the
        // transcript row outright (plus any segments already created) so
        // the library doesn't carry around a 'cancelled / error' ghost.
        try {
          await window.electronAPI.db.transcriptSegments.deleteByTranscript(transcriptId);
        } catch (segErr) {
          console.warn('Failed to delete cancelled transcript segments:', segErr);
        }
        try {
          await window.electronAPI.db.transcripts.remove(transcriptId);
        } catch (dbErr) {
          console.error('Failed to delete cancelled transcript:', dbErr);
        }
        callbacks.onCancelled?.();
        return;
      }

      console.error('Processing error:', error);

      // Same expectation as cancel: a failed import should not leave a
      // ghost row in the library. The error is surfaced via the
      // onError callback (toast/queue UI), then we wipe the partial
      // transcript + any segments already created. Without this, the
      // user sees a permanent "Error" entry they can't act on.
      try {
        await window.electronAPI.db.transcriptSegments.deleteByTranscript(transcriptId);
      } catch (segErr) {
        console.warn('Failed to delete failed-import segments:', segErr);
      }
      try {
        await window.electronAPI.db.transcripts.remove(transcriptId);
      } catch (dbErr) {
        console.error('Failed to delete failed-import transcript:', dbErr);
      }

      callbacks.onError?.(error as Error);
    } finally {
      // Always remove the extracted WAV if we made one — success, error, or
      // cancel (the cancel branch above returns, but finally still runs).
      if (audioPath !== filePath) {
        try {
          const deleteResult = await window.electronAPI.fs.deleteFile(audioPath);
          if (!deleteResult.success) {
            console.error('Failed to delete temp audio file:', deleteResult.error);
          }
        } catch (error) {
          console.error('Error deleting temp audio file:', error);
        }
      }
    }
  }

  async transcribeAudio(
    audioPath: string,
    onProgress?: (stage: TranscriptionStage, percent: number) => void,
    signal?: AbortSignal
  ): Promise<{
    success: boolean;
    text?: string;
    error?: string;
    chunkTimings?: Array<{
      chunkIndex: number;
      startTime: number;
      endTime: number;
      duration: number;
      text: string;
      speaker?: string;
    }>;
    speakerTurns?: Array<{ start: number; end: number; speaker: string }>;
  }> {
    try {
      // Read the chosen local Whisper model from settings (defaults to tiny.en)
      const modelName = (await window.electronAPI.db.settings.get('localTranscriptionModel')) || 'Xenova/whisper-tiny.en';

      // Speaker detection is on by default; users can opt out in Settings
      const enableDiarisation = (await window.electronAPI.db.settings.get('enableSpeakerDiarisation')) !== 'false';

      onProgress?.('transcribing', 25);

      // Run Whisper + (optional) diarisation entirely in the main process.
      // Wrap in abortable so cancel returns control to the renderer
      // immediately even though the IPC keeps running in main.
      const result = await abortable(
        window.electronAPI.audio.transcribe(audioPath, modelName, enableDiarisation),
        signal
      );

      onProgress?.('transcribing', 75);

      return result;
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Transcription error:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async analyzeTranscript(
    transcriptText: string,
    onProgress?: (stage: TranscriptionStage, percent: number) => void,
    signal?: AbortSignal
  ): Promise<{
    summary: string;
    keyTopics: string[];
    actionItems: string[];
  }> {
    try {
      if (!transcriptText || transcriptText.trim() === '') {
        console.warn('No transcript text to analyze');
        return { summary: '', keyTopics: [], actionItems: [] };
      }

      onProgress?.('analyzing', 25);

      // Get configurable analysis prompt
      const analysisPrompt = await promptService.getProcessedPrompt('analysis', 'basic_analysis', {
        transcript: transcriptText
      });

      onProgress?.('analyzing', 50);
      checkCancelled(signal);

      // Run via the Completion module (provider/key/model resolved in main).
      const res = await this.aiComplete(analysisPrompt, 'json', signal);

      onProgress?.('analyzing', 75);

      if (!res.ok) {
        throw new Error(res.error || 'AI service error');
      }

      // data is the tolerant JSON parse; fall back to schema-specific parsing.
      const analysisData = res.data ?? this.parseAnalysisText(res.raw);

      console.log('Analysis completed:', analysisData);
      
      return {
        summary: analysisData.summary || '',
        keyTopics: Array.isArray(analysisData.keyTopics) ? analysisData.keyTopics : [],
        actionItems: Array.isArray(analysisData.actionItems) ? analysisData.actionItems : []
      };
      
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Analysis error:', error);
      // Return empty analysis rather than failing the entire process
      return { summary: '', keyTopics: [], actionItems: [] };
    }
  }

  private parseAnalysisText(text: string): { summary: string; keyTopics: string[]; actionItems: string[] } {
    // Fallback parser for when JSON parsing fails
    const summary = this.extractSection(text, 'summary') || '';
    const keyTopics = this.extractList(text, 'key topics') || [];
    const actionItems = this.extractList(text, 'action items') || [];
    
    return { summary, keyTopics, actionItems };
  }

  private extractSection(text: string, section: string): string {
    const regex = new RegExp(`${section}[:"\\s]*([^\\n\\r]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  }

  private extractList(text: string, section: string): string[] {
    const regex = new RegExp(`${section}[:"\\s]*([\\s\\S]*?)(?=\\n\\n|$)`, 'i');
    const match = text.match(regex);
    if (!match) return [];
    
    const listText = match[1];
    const items = listText.split(/[-•*]\s*/).filter(item => item.trim().length > 0);
    return items.map(item => item.trim().replace(/\n/g, ' '));
  }


  /**
   * Single entry point for AI calls from the import pipeline. Routes to the
   * main-process Completion module — provider, URL, key, model and JSON mode
   * are all resolved there, so the pipeline honours whatever provider the
   * user configured (not just local Ollama).
   *
   * Cancellation is threaded both ways: abortable() rejects the renderer side
   * the moment the signal fires, and ai.cancel(requestId) aborts the in-flight
   * request in main so it stops truly, not just gets orphaned.
   */
  private async aiComplete(
    prompt: string,
    expects: 'text' | 'json',
    signal?: AbortSignal
  ): Promise<{ ok: boolean; text: string; raw: string; data: any | null; error?: string }> {
    const requestId = `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onAbort = () => {
      void window.electronAPI.ai.cancel(requestId);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await abortable(
        window.electronAPI.ai.complete({ prompt, expects, requestId }),
        signal
      );
      return {
        ok: !!res.ok,
        text: res.text || '',
        raw: res.raw || '',
        data: res.data ?? null,
        error: res.error,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async performSentimentAnalysis(transcriptText: string, signal?: AbortSignal): Promise<{
    sentiment: string;
    sentimentScore: number;
  }> {
    try {
      const prompt = await promptService.getProcessedPrompt('analysis', 'sentiment_analysis', {
        transcript: transcriptText
      });

      const res = await this.aiComplete(prompt, 'json', signal);
      const result = res.data || {};
      return {
        sentiment: result.sentiment || 'neutral',
        sentimentScore: typeof result.sentimentScore === 'number' ? result.sentimentScore : 0
      };
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Sentiment analysis error:', error);
      return { sentiment: 'neutral', sentimentScore: 0 };
    }
  }

  async performEmotionAnalysis(transcriptText: string, signal?: AbortSignal): Promise<Record<string, number>> {
    try {
      const prompt = await promptService.getProcessedPrompt('analysis', 'emotion_analysis', {
        transcript: transcriptText
      });

      const res = await this.aiComplete(prompt, 'json', signal);
      return res.data || {};
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Emotion analysis error:', error);
      return {};
    }
  }

  // Enhanced hybrid speaker detection with rule-based preprocessing

  /**
   * Run sentiment + emotion analysis as separate focused LLM calls.
   * Speaker info is populated upstream by the audio-level diarisation
   * pipeline (pyannote + wespeaker) and overridden in processFile, so
   * we return placeholder values here.
   *
   * Previously this method had two paths gated by the `oneTaskAtATime`
   * setting: the one-task path (separate calls per analysis) and a
   * legacy monolithic path that tried to do everything in one giant
   * prompt. The monolithic path was unreliable on smaller models and
   * its speaker output was being discarded anyway. Both paths have been
   * collapsed into the one-task approach.
   */
  async performAdvancedAnalysis(
    transcriptText: string,
    onProgress?: (stage: TranscriptionStage, percent: number) => void,
    signal?: AbortSignal
  ): Promise<{
    sentiment: string;
    sentimentScore: number;
    emotions: Record<string, number>;
    speakerCount: number;
    speakers: Array<{ id: string; name: string; segments: number }>;
    processedText: string;
  }> {
    try {
      if (!transcriptText || transcriptText.trim() === '') {
        console.warn('No transcript text for advanced analysis');
        return { sentiment: 'neutral', sentimentScore: 0, emotions: {}, speakerCount: 1, speakers: [], processedText: transcriptText };
      }

      onProgress?.('analyzing', 60);
      const sentimentResult = await this.performSentimentAnalysis(transcriptText, signal);
      onProgress?.('analyzing', 70);
      const emotionResult = await this.performEmotionAnalysis(transcriptText, signal);
      onProgress?.('analyzing', 85);

      return {
        sentiment: sentimentResult.sentiment,
        sentimentScore: sentimentResult.sentimentScore,
        emotions: emotionResult,
        speakerCount: 1,
        speakers: [],
        processedText: transcriptText,
      };
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Advanced analysis error:', error);
      return { sentiment: 'neutral', sentimentScore: 0, emotions: {}, speakerCount: 1, speakers: [], processedText: transcriptText };
    }
  }

  async validateTranscript(transcriptText: string, signal?: AbortSignal): Promise<{
    validatedText: string;
    changes: Array<{ type: string; original: string; corrected: string; position: number }>;
  }> {
    // Initialize variables outside try block for catch block access
    let processedText = transcriptText;
    let duplicateRemovalChanges: any[] = [];

    try {
      // Get validation settings in one batch
      const valSettings = await window.electronAPI.db.settings.getMany([
        'enableTranscriptValidation',
        'validationOptions',
        'enableDuplicateRemoval',
      ]);

      if (valSettings.enableTranscriptValidation !== 'true') {
        return { validatedText: transcriptText, changes: [] };
      }

      let options: any = {};
      if (valSettings.validationOptions) {
        try {
          options = JSON.parse(valSettings.validationOptions);
        } catch (err) {
          console.warn('validationOptions: malformed JSON, using defaults', err);
        }
      }

      // First, remove duplicate sentences if enabled (separate setting)
      if (valSettings.enableDuplicateRemoval !== 'false') {
        const duplicateResult = await this.removeDuplicateSentences(transcriptText, signal);
        processedText = duplicateResult.cleanedText;
        
        if (duplicateResult.removedCount > 0) {
          duplicateRemovalChanges = duplicateResult.removedSentences.map(sentence => ({
            type: 'duplicate_removal',
            original: sentence,
            corrected: '[REMOVED]',
            position: -1
          }));
        }
      }
      
      // Create validation options string
      const validationOptions = [
        options.spelling !== false ? '- Spelling errors' : '',
        options.grammar !== false ? '- Grammar mistakes' : '',
        options.punctuation !== false ? '- Punctuation' : '',
        options.capitalization !== false ? '- Proper capitalization' : ''
      ].filter(opt => opt !== '').join('\n');

      // Create validation prompt using configurable prompt
      const validationPrompt = await promptService.getProcessedPrompt('validation', 'transcript_validation', {
        validation_options: validationOptions,
        transcript: processedText
      });

      console.log(`Validation input length: ${processedText.length} characters`);
      
      // For very long transcripts, use chunked validation
      if (processedText.length > 4000) {
        console.log('Using chunked validation for long transcript');
        const chunkResult = await this.performChunkedValidation(processedText, options, signal);
        return {
          validatedText: chunkResult.validatedText,
          changes: [...duplicateRemovalChanges, ...chunkResult.changes]
        };
      }

      // Run via the Completion module (provider/key/model resolved in main).
      const res = await this.aiComplete(validationPrompt, 'json', signal);
      console.log(`Validation output length: ${res.raw?.length || 0} characters`);

      if (!res.ok) {
        throw new Error(res.error || 'AI service error');
      }

      const validationData = res.data;
      if (!validationData) {
        console.warn('Failed to parse validation response as JSON');
        return {
          validatedText: processedText, // Use duplicate-cleaned text as fallback
          changes: duplicateRemovalChanges
        };
      }
      
      // Check if AI returned full text (within 10% of original length)
      const originalLength = processedText.length;
      const validatedLength = validationData.validatedText?.length || 0;
      const lengthRatio = validatedLength / originalLength;
      
      if (lengthRatio < 0.9) {
        console.warn(`AI validation may have truncated text. Original: ${originalLength}, Validated: ${validatedLength}`);
        // Return original text with duplicate removal only
        return {
          validatedText: processedText,
          changes: duplicateRemovalChanges
        };
      }
      
      return {
        validatedText: validationData.validatedText || processedText,
        changes: [
          ...duplicateRemovalChanges,
          ...(Array.isArray(validationData.changes) ? validationData.changes : [])
        ]
      };
      
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Validation error:', error);
      // Return duplicate-cleaned text if validation fails, or original if duplicate removal also failed
      return {
        validatedText: processedText || transcriptText,
        changes: duplicateRemovalChanges || []
      };
    }
  }

  async performChunkedValidation(
    text: string,
    options: any,
    signal?: AbortSignal
  ): Promise<{
    validatedText: string;
    changes: Array<{ type: string; original: string; corrected: string; position: number }>;
  }> {
    const CHUNK_SIZE = 3500; // Safe size for most models
    const chunks = [];
    let currentPos = 0;
    
    // Split into chunks at sentence boundaries
    while (currentPos < text.length) {
      let chunkEnd = currentPos + CHUNK_SIZE;
      
      if (chunkEnd >= text.length) {
        chunks.push(text.substring(currentPos));
        break;
      }
      
      // Find the last sentence ending within chunk size
      const chunk = text.substring(currentPos, chunkEnd);
      const lastSentenceEnd = Math.max(
        chunk.lastIndexOf('.'),
        chunk.lastIndexOf('!'),
        chunk.lastIndexOf('?')
      );
      
      if (lastSentenceEnd > 0) {
        chunkEnd = currentPos + lastSentenceEnd + 1;
      }
      
      chunks.push(text.substring(currentPos, chunkEnd));
      currentPos = chunkEnd;
    }
    
    console.log(`Processing ${chunks.length} chunks for validation`);
    
    const validatedChunks: string[] = [];
    const allChanges: Array<{ type: string; original: string; corrected: string; position: number }> = [];
    
    for (let i = 0; i < chunks.length; i++) {
      checkCancelled(signal);
      const chunk = chunks[i];
      console.log(`Validating chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);

      try {
        const validationPrompt = `Please validate and correct the following text segment. Focus on:
${options.spelling !== false ? '- Spelling errors' : ''}
${options.grammar !== false ? '- Grammar mistakes' : ''}
${options.punctuation !== false ? '- Punctuation' : ''}
${options.capitalization !== false ? '- Proper capitalization' : ''}

Important: 
- Preserve the original meaning and speaker intent
- Do not change technical terms or proper nouns unless clearly misspelled
- Return the corrected text and a list of changes made

Text segment:
${chunk}

Please format your response as JSON:
{
  "validatedText": "The corrected text segment",
  "changes": [
    {
      "type": "spelling|grammar|punctuation|capitalization",
      "original": "original text",
      "corrected": "corrected text",
      "position": 0
    }
  ]
}`;

        const res = await this.aiComplete(validationPrompt, 'json', signal);

        if (res.ok && res.data) {
          const chunkData = res.data;
          validatedChunks.push(chunkData.validatedText || chunk);

          if (Array.isArray(chunkData.changes)) {
            // Adjust positions for the full text
            const adjustedChanges = chunkData.changes.map((change: any) => ({
              ...change,
              position: change.position + (i > 0 ? validatedChunks.slice(0, i).join('').length : 0)
            }));
            allChanges.push(...adjustedChanges);
          }
        } else {
          console.warn(`Failed to validate chunk ${i + 1}, using original`);
          validatedChunks.push(chunk);
        }
      } catch (error) {
        if (isCancelled(error)) throw error;
        console.warn(`Error validating chunk ${i + 1}:`, error);
        validatedChunks.push(chunk);
      }
      
      // Small delay to be nice to the AI service
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return {
      validatedText: validatedChunks.join(''),
      changes: allChanges
    };
  }

  async removeDuplicateSentences(transcriptText: string, _signal?: AbortSignal): Promise<{
    cleanedText: string;
    removedCount: number;
    removedSentences: string[];
  }> {
    try {
      if (!transcriptText || transcriptText.trim() === '') {
        return { cleanedText: transcriptText, removedCount: 0, removedSentences: [] };
      }

      // Split into sentences
      const sentences = transcriptText
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      if (sentences.length <= 1) {
        return { cleanedText: transcriptText, removedCount: 0, removedSentences: [] };
      }

      const uniqueSentences: string[] = [];
      const removedSentences: string[] = [];
      const seenSentences = new Set<string>();

      for (let i = 0; i < sentences.length; i++) {
        let sentence = sentences[i].trim();
        
        // Normalize sentence for comparison (lowercase, remove extra spaces, common words)
        const normalized = sentence
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/[^\w\s]/g, '')
          .trim();

        // Skip very short sentences (likely fragments)
        if (normalized.length < 10) {
          uniqueSentences.push(sentence);
          continue;
        }

        // Check for exact or near-exact duplicates
        let isDuplicate = false;

        // Check against all previously seen sentences
        for (const seenNormalized of seenSentences) {
          const similarity = this.calculateSimilarity(normalized, seenNormalized);
          
          // Consider duplicates if >85% similar
          if (similarity > 0.85) {
            isDuplicate = true;
            removedSentences.push(sentence);
            break;
          }
        }

        if (!isDuplicate) {
          seenSentences.add(normalized);
          uniqueSentences.push(sentence);
        }
      }

      // Rebuild text with proper punctuation
      const cleanedText = uniqueSentences
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .join('. ')
        .replace(/\.\s*\./g, '.') // Remove double periods
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();

      console.log(`Removed ${removedSentences.length} duplicate sentences from transcript`);

      return {
        cleanedText: cleanedText + (cleanedText.endsWith('.') ? '' : '.'),
        removedCount: removedSentences.length,
        removedSentences
      };

    } catch (error) {
      console.error('Error removing duplicate sentences:', error);
      return { cleanedText: transcriptText, removedCount: 0, removedSentences: [] };
    }
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Simple similarity calculation using Levenshtein distance
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async performResearchAnalysis(
    transcriptText: string,
    onProgress?: (stage: TranscriptionStage, percent: number) => void,
    signal?: AbortSignal
  ): Promise<{
    notableQuotes: Array<{ text: string; speaker?: string; timestamp?: number; relevance: number }>;
    researchThemes: Array<{ theme: string; confidence: number; examples: string[] }>;
    qaPairs: Array<{ question: string; answer: string; speaker?: string; timestamp?: number }>;
    conceptFrequency: Record<string, { count: number; contexts: string[] }>;
  }> {
    try {
      if (!transcriptText || transcriptText.trim() === '') {
        console.warn('No transcript text for research analysis');
        return { notableQuotes: [], researchThemes: [], qaPairs: [], conceptFrequency: {} };
      }

      onProgress?.('analyzing', 80);

      // Create research analysis prompt using configurable prompt
      const researchPrompt = await promptService.getProcessedPrompt('analysis', 'research_analysis', {
        transcript: transcriptText
      });

      onProgress?.('analyzing', 90);

      // Run via the Completion module (provider/key/model resolved in main).
      const res = await this.aiComplete(researchPrompt, 'json', signal);

      onProgress?.('analyzing', 95);

      if (!res.ok) {
        throw new Error(res.error || 'AI service error');
      }

      // data is the tolerant JSON parse; fall back to schema-specific parsing.
      const analysisData = res.data ?? this.parseResearchAnalysisText(res.raw, transcriptText);

      console.log('Research analysis completed:', analysisData);
      
      return {
        notableQuotes: Array.isArray(analysisData.notableQuotes) ? analysisData.notableQuotes : [],
        researchThemes: Array.isArray(analysisData.researchThemes) ? analysisData.researchThemes : [],
        qaPairs: Array.isArray(analysisData.qaPairs) ? analysisData.qaPairs : [],
        conceptFrequency: analysisData.conceptFrequency || {}
      };
      
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Research analysis error:', error);
      // Return empty analysis rather than failing the entire process
      return { notableQuotes: [], researchThemes: [], qaPairs: [], conceptFrequency: {} };
    }
  }

  private parseResearchAnalysisText(text: string, transcript: string): any {
    // Fallback parser for research analysis when JSON parsing fails
    return {
      notableQuotes: this.extractNotableQuotes(text, transcript),
      researchThemes: this.extractResearchThemes(text),
      qaPairs: this.extractQAPairs(text, transcript),
      conceptFrequency: this.extractConceptFrequency(text, transcript)
    };
  }

  private extractNotableQuotes(text: string, transcript: string): Array<{ text: string; speaker?: string; relevance: number }> {
    // Look for quoted text in the AI response or extract interesting sentences from transcript
    const quotes: Array<{ text: string; speaker?: string; relevance: number }> = [];
    
    // Try to find quotes in AI response
    const quoteMatches = text.match(/"([^"]{20,200})"/g);
    if (quoteMatches) {
      quoteMatches.slice(0, 5).forEach(quote => {
        quotes.push({
          text: quote.replace(/"/g, ''),
          relevance: 0.7
        });
      });
    }
    
    // Fallback: extract meaningful sentences from transcript
    if (quotes.length === 0) {
      const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 30);
      sentences.slice(0, 3).forEach(sentence => {
        quotes.push({
          text: sentence.trim(),
          relevance: 0.5
        });
      });
    }
    
    return quotes;
  }

  private extractResearchThemes(text: string): Array<{ theme: string; confidence: number; examples: string[] }> {
    const themes: Array<{ theme: string; confidence: number; examples: string[] }> = [];
    
    // Look for theme-related keywords
    const themeKeywords = ['theme', 'category', 'pattern', 'topic', 'concept'];
    const lines = text.split('\n');
    
    lines.forEach(line => {
      if (themeKeywords.some(keyword => line.toLowerCase().includes(keyword))) {
        const themeMatch = line.match(/([A-Z][^:.\n]{10,50})/);
        if (themeMatch) {
          themes.push({
            theme: themeMatch[1].trim(),
            confidence: 0.6,
            examples: []
          });
        }
      }
    });
    
    // Default themes if none found
    if (themes.length === 0) {
      themes.push({
        theme: 'General Discussion',
        confidence: 0.5,
        examples: ['Content analysis needed']
      });
    }
    
    return themes.slice(0, 5);
  }

  private extractQAPairs(_text: string, transcript: string): Array<{ question: string; answer: string; speaker?: string }> {
    const pairs: Array<{ question: string; answer: string; speaker?: string }> = [];
    
    // Look for question patterns in transcript
    const questionPattern = /([^.!?]*\?)/g;
    const questions = transcript.match(questionPattern);
    
    if (questions) {
      questions.slice(0, 3).forEach(question => {
        // Find the text that follows this question
        const questionIndex = transcript.indexOf(question);
        const afterQuestion = transcript.substring(questionIndex + question.length, questionIndex + question.length + 200);
        const firstSentence = afterQuestion.split(/[.!?]/)[0];
        
        if (firstSentence && firstSentence.trim().length > 10) {
          pairs.push({
            question: question.trim(),
            answer: firstSentence.trim()
          });
        }
      });
    }
    
    return pairs;
  }

  private extractConceptFrequency(_text: string, transcript: string): Record<string, { count: number; contexts: string[] }> {
    const concepts: Record<string, { count: number; contexts: string[] }> = {};
    
    // Common concepts to look for
    const conceptWords = [
      'technology', 'innovation', 'process', 'system', 'solution', 'challenge', 'opportunity',
      'experience', 'perspective', 'approach', 'strategy', 'method', 'tool', 'platform',
      'communication', 'collaboration', 'efficiency', 'improvement', 'change', 'development'
    ];
    
    const transcriptLower = transcript.toLowerCase();
    
    conceptWords.forEach(concept => {
      const regex = new RegExp(`\\b${concept}\\b`, 'gi');
      const matches = transcriptLower.match(regex);
      
      if (matches && matches.length > 1) {
        concepts[concept] = {
          count: matches.length,
          contexts: [`Mentioned ${matches.length} times throughout the conversation`]
        };
      }
    });
    
    return concepts;
  }

  getStageLabel(stage: string): string {
    switch (stage) {
      case 'analyzing':
        return 'Analyzing media...';
      case 'extracting':
        return 'Extracting audio...';
      case 'transcribing':
        return 'Transcribing...';
      case 'validating':
        return 'Validating transcript...';
      case 'saving':
        return 'Saving results...';
      default:
        return 'Processing...';
    }
  }
}

export const fileProcessor = new FileProcessor();