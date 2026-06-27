// Note: Cannot use path module in renderer process

import { promptService } from './promptService';
import { sentenceSegmentsService } from './sentenceSegmentsService';
import { transcriptValidationService } from './transcriptValidationService';
import { aiComplete } from './aiCompletion';
import {
  BasicAnalysisSchema,
  SentimentResultSchema,
  EmotionResultSchema,
  ResearchAnalysisSchema,
  type ResearchAnalysis,
} from './analysisSchemas';
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
      const validationResult = await transcriptValidationService.validate(transcriptResult.text || '', signal);
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
      const res = await aiComplete(analysisPrompt, 'json', signal);

      onProgress?.('analyzing', 75);

      if (!res.ok) {
        throw new Error(res.error || 'AI service error');
      }

      // data is the tolerant JSON parse; fall back to schema-specific parsing.
      // Validate model JSON (or the text-fallback parse) into a typed shape.
      // The schema coerces and defaults, so this never throws and replaces the
      // old Array.isArray(...) guards.
      const analysisData = BasicAnalysisSchema.parse(
        res.data ?? this.parseAnalysisText(res.raw)
      );

      console.log('Analysis completed:', analysisData);

      return analysisData;
      
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

  async performSentimentAnalysis(transcriptText: string, signal?: AbortSignal): Promise<{
    sentiment: string;
    sentimentScore: number;
  }> {
    try {
      const prompt = await promptService.getProcessedPrompt('analysis', 'sentiment_analysis', {
        transcript: transcriptText
      });

      const res = await aiComplete(prompt, 'json', signal);
      return SentimentResultSchema.parse(res.data ?? {});
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

      const res = await aiComplete(prompt, 'json', signal);
      return EmotionResultSchema.parse(res.data ?? {});
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
      const res = await aiComplete(researchPrompt, 'json', signal);

      onProgress?.('analyzing', 95);

      if (!res.ok) {
        throw new Error(res.error || 'AI service error');
      }

      // Validate model JSON (or the text-fallback parse) into a typed shape.
      const analysisData = ResearchAnalysisSchema.parse(
        res.data ?? this.parseResearchAnalysisText(res.raw, transcriptText)
      );

      console.log('Research analysis completed:', analysisData);

      return analysisData;
      
    } catch (error) {
      if (isCancelled(error)) throw error;
      console.error('Research analysis error:', error);
      // Return empty analysis rather than failing the entire process
      return { notableQuotes: [], researchThemes: [], qaPairs: [], conceptFrequency: {} };
    }
  }

  private parseResearchAnalysisText(text: string, transcript: string): ResearchAnalysis {
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