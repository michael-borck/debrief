import { Transcript } from '../types';

export interface ProjectAnalysisConfig {
  enableCrossTranscriptAnalysis: boolean;
  maxTranscriptsPerAnalysis: number;
  analysisDepth: 'basic' | 'detailed' | 'comprehensive';
  cacheResults: boolean;
}

export interface CollatedAnalysisResult {
  combinedSummary: string;
  mergedTopics: string[];
  mergedActionItems: string[];
  aggregatedThemes: Array<{
    theme: string;
    frequency: number;
    sources: Array<{
      transcriptId: string;
      transcriptTitle: string;
      relevance: number;
    }>;
  }>;
  consensusInsights: string[];
}

export interface ComprehensiveAnalysisResult extends CollatedAnalysisResult {
  themeEvolution: ThemeEvolution[];
  conceptFrequency: ConceptFrequency;
  speakerAnalysis: SpeakerAnalysis;
  timelineAnalysis: TimelineAnalysis;
  crossTranscriptPatterns: CrossTranscriptPattern[];
}

export interface ThemeEvolution {
  theme: string;
  occurrences: {
    transcript_id: string;
    transcript_title: string;
    date: string;
    count: number;
    quotes: string[];
    relevance: number;
  }[];
  trend: 'increasing' | 'decreasing' | 'stable' | 'emerging' | 'declining';
  totalOccurrences: number;
  avgRelevance: number;
}

export interface ConceptFrequency {
  [concept: string]: {
    totalCount: number;
    transcriptCount: number;
    avgFrequency: number;
    contexts: {
      transcript_id: string;
      transcript_title: string;
      count: number;
      examples: string[];
    }[];
    trend: 'increasing' | 'decreasing' | 'stable';
  };
}

export interface SpeakerAnalysis {
  totalSpeakers: number;
  speakerDistribution: {
    [speaker: string]: {
      transcriptCount: number;
      totalSegments: number;
      avgSegmentsPerTranscript: number;
      themes: string[];
      keyQuotes: string[];
    };
  };
  speakerInteractions: {
    transcript_id: string;
    transcript_title: string;
    speakers: string[];
    interactionPattern: 'interview' | 'discussion' | 'presentation' | 'unknown';
  }[];
}

export interface TimelineAnalysis {
  dateRange: {
    start: string;
    end: string;
  };
  transcriptsByPeriod: {
    period: string;
    count: number;
    totalDuration: number;
    themes: string[];
  }[];
  themeEvolutionTimeline: {
    date: string;
    themes: { theme: string; strength: number }[];
  }[];
  sentimentTrend: {
    date: string;
    avgSentiment: number;
    transcriptCount: number;
  }[];
}

export interface CrossTranscriptPattern {
  type: 'theme_consistency' | 'theme_evolution' | 'speaker_behavior' | 'sentiment_shift' | 'concept_emergence';
  description: string;
  strength: number; // 0-1
  evidence: {
    transcript_id: string;
    transcript_title: string;
    date: string;
    supporting_data: any;
  }[];
  insights: string[];
}

export class ProjectAnalysisService {
  private static instance: ProjectAnalysisService;
  private config: ProjectAnalysisConfig;

  private constructor() {
    this.config = {
      enableCrossTranscriptAnalysis: true,
      maxTranscriptsPerAnalysis: 10,
      analysisDepth: 'detailed',
      cacheResults: true
    };
  }

  static getInstance(): ProjectAnalysisService {
    if (!ProjectAnalysisService.instance) {
      ProjectAnalysisService.instance = new ProjectAnalysisService();
    }
    return ProjectAnalysisService.instance;
  }

  /**
   * Perform collated analysis - combine individual transcript analyses
   */
  async performCollatedAnalysis(projectId: string): Promise<CollatedAnalysisResult> {
    const startTime = Date.now();

    try {
      // Get project transcripts
      const transcripts = await this.getProjectTranscripts(projectId);
      
      if (transcripts.length === 0) {
        throw new Error('No transcripts found for project');
      }

      console.log(`Performing collated analysis for project ${projectId} with ${transcripts.length} transcripts`);

      // Aggregate data from individual transcripts
      const combinedData = this.aggregateTranscriptData(transcripts);

      // Generate combined summary
      const combinedSummary = await this.generateCombinedSummary(transcripts, combinedData);

      // Analyze for consensus
      const consensusAnalysis = this.analyzeConsensus(transcripts);

      const result: CollatedAnalysisResult = {
        combinedSummary,
        mergedTopics: combinedData.allTopics,
        mergedActionItems: combinedData.allActionItems,
        aggregatedThemes: combinedData.themeFrequency,
        consensusInsights: consensusAnalysis.consensus
      };

      // Cache result if enabled
      if (this.config.cacheResults) {
        await this.cacheAnalysisResult(projectId, 'collated_analysis', result);
      }

      console.log(`Collated analysis completed in ${Date.now() - startTime}ms`);
      return result;

    } catch (error) {
      console.error('Failed to perform collated analysis:', error);
      throw error;
    }
  }

  /**
   * Get project transcripts
   */
  private async getProjectTranscripts(projectId: string): Promise<Transcript[]> {
    try {
      return await window.electronAPI.db.projectTranscripts.listTranscriptsForProject(projectId, {
        completedOnly: true,
        orderBy: 'created_asc',
      });
    } catch (error) {
      console.error('Failed to get project transcripts:', error);
      return [];
    }
  }

  /**
   * Aggregate data from all transcripts
   */
  private aggregateTranscriptData(transcripts: Transcript[]): {
    allTopics: string[];
    allActionItems: string[];
    themeFrequency: Array<{
      theme: string;
      frequency: number;
      sources: Array<{
        transcriptId: string;
        transcriptTitle: string;
        relevance: number;
      }>;
    }>;
  } {
    const allTopics: string[] = [];
    const allActionItems: string[] = [];
    const themeMap = new Map<string, Array<{ transcriptId: string; transcriptTitle: string; relevance: number }>>();

    transcripts.forEach(transcript => {
      // Collect topics
      if (transcript.key_topics) {
        const topics = typeof transcript.key_topics === 'string' ? JSON.parse(transcript.key_topics) : transcript.key_topics;
        allTopics.push(...topics);

        // Track theme frequency
        topics.forEach((topic: string) => {
          if (!themeMap.has(topic)) {
            themeMap.set(topic, []);
          }
          themeMap.get(topic)!.push({
            transcriptId: transcript.id,
            transcriptTitle: transcript.title,
            relevance: 1.0
          });
        });
      }

      // Collect action items
      if (transcript.action_items) {
        const actionItems = typeof transcript.action_items === 'string' ? JSON.parse(transcript.action_items) : transcript.action_items;
        allActionItems.push(...actionItems);
      }
    });

    // Convert theme map to frequency array
    const themeFrequency = Array.from(themeMap.entries()).map(([theme, sources]) => ({
      theme,
      frequency: sources.length,
      sources
    })).sort((a, b) => b.frequency - a.frequency);

    // Remove duplicates
    const uniqueTopics = [...new Set(allTopics)];
    const uniqueActionItems = [...new Set(allActionItems)];

    return {
      allTopics: uniqueTopics,
      allActionItems: uniqueActionItems,
      themeFrequency
    };
  }

  /**
   * Generate combined summary from all transcripts
   */
  private async generateCombinedSummary(
    transcripts: Transcript[],
    aggregatedData: any
  ): Promise<string> {
    try {
      const summaries = transcripts
        .filter(t => t.summary)
        .map(t => `**${t.title}**: ${t.summary}`)
        .join('\n\n');

      if (!summaries) {
        return `Project contains ${transcripts.length} transcripts. Individual summaries not yet available.`;
      }

      const prompt = `Please create a cohesive project summary that combines the following transcript summaries. Focus on overarching themes, common patterns, and key insights:

${summaries}

Create a comprehensive summary (200-300 words) that identifies main themes and overall project scope.`;

      const response = await window.electronAPI.services.chatWithOllama({
        prompt: prompt,
        message: '',
        context: ''
      });

      if (response.success) {
        return response.response.trim();
      } else {
        return this.createFallbackSummary(transcripts, aggregatedData);
      }
    } catch (error) {
      console.error('Failed to generate combined summary:', error);
      return this.createFallbackSummary(transcripts, aggregatedData);
    }
  }

  /**
   * Create fallback summary when AI generation fails
   */
  private createFallbackSummary(transcripts: Transcript[], aggregatedData: any): string {
    const topThemes = aggregatedData.themeFrequency.slice(0, 5).map((t: any) => t.theme);
    
    return `This project consists of ${transcripts.length} transcripts spanning from ${new Date(transcripts[0].created_at).toLocaleDateString()} to ${new Date(transcripts[transcripts.length - 1].created_at).toLocaleDateString()}. 

Main themes include: ${topThemes.join(', ')}. 

The project contains ${aggregatedData.allActionItems.length} action items and covers ${aggregatedData.allTopics.length} distinct topics.`;
  }

  /**
   * Analyze consensus points
   */
  private analyzeConsensus(transcripts: Transcript[]): {
    consensus: string[];
  } {
    const consensus: string[] = [];
    const topicOccurrences = new Map<string, string[]>();
    
    transcripts.forEach(transcript => {
      if (transcript.key_topics) {
        const topics = typeof transcript.key_topics === 'string' ? JSON.parse(transcript.key_topics) : transcript.key_topics;
        topics.forEach((topic: string) => {
          if (!topicOccurrences.has(topic)) {
            topicOccurrences.set(topic, []);
          }
          topicOccurrences.get(topic)!.push(transcript.id);
        });
      }
    });

    // Topics appearing in most transcripts are consensus points
    topicOccurrences.forEach((transcriptIds, topic) => {
      const frequency = transcriptIds.length / transcripts.length;
      if (frequency >= 0.6) {
        consensus.push(`${topic} (mentioned across ${transcriptIds.length} transcripts)`);
      }
    });

    return { consensus };
  }

  /**
   * Cache analysis result
   */
  private async cacheAnalysisResult(projectId: string, analysisType: string, result: any): Promise<void> {
    try {
      const id = `${projectId}_${analysisType}_${Date.now()}`;
      await window.electronAPI.database.run(
        'INSERT INTO project_analysis (id, project_id, analysis_type, results) VALUES (?, ?, ?, ?)',
        [id, projectId, analysisType, JSON.stringify(result)]
      );
    } catch (error) {
      console.error('Failed to cache analysis result:', error);
    }
  }

  /**
   * Main project analysis method - performs comprehensive analysis
   */
  async analyzeProject(projectId: string): Promise<ComprehensiveAnalysisResult> {
    console.log(`Starting comprehensive analysis for project ${projectId}`);
    
    const startTime = Date.now();
    
    try {
      // Get project transcripts
      const transcripts = await this.getProjectTranscripts(projectId);
      
      if (transcripts.length === 0) {
        throw new Error('No transcripts found for project');
      }

      console.log(`Performing comprehensive analysis for ${transcripts.length} transcripts`);

      // Perform basic collated analysis first
      const collatedAnalysis = await this.performCollatedAnalysis(projectId);
      
      // Generate comprehensive analysis components
      const [themeEvolution, conceptFrequency, speakerAnalysis, timelineAnalysis, crossTranscriptPatterns] = await Promise.all([
        this.generateThemeEvolution(transcripts),
        this.generateConceptFrequency(transcripts),
        this.generateSpeakerAnalysis(transcripts),
        this.generateTimelineAnalysis(transcripts),
        this.generateCrossTranscriptPatterns(transcripts)
      ]);

      const comprehensiveResult: ComprehensiveAnalysisResult = {
        ...collatedAnalysis,
        themeEvolution,
        conceptFrequency,
        speakerAnalysis,
        timelineAnalysis,
        crossTranscriptPatterns
      };

      // Cache comprehensive result
      if (this.config.cacheResults) {
        await this.cacheAnalysisResult(projectId, 'comprehensive_analysis', comprehensiveResult);
      }

      console.log(`Comprehensive analysis completed in ${Date.now() - startTime}ms`);
      return comprehensiveResult;

    } catch (error) {
      console.error('Failed to perform comprehensive analysis:', error);
      throw error;
    }
  }

  /**
   * Generate theme evolution analysis
   */
  private async generateThemeEvolution(transcripts: Transcript[]): Promise<ThemeEvolution[]> {
    const themeMap = new Map<string, {
      occurrences: Array<{
        transcript_id: string;
        transcript_title: string;
        date: string;
        count: number;
        quotes: string[];
        relevance: number;
      }>;
      totalOccurrences: number;
    }>();

    // Collect theme data from transcripts
    transcripts.forEach(transcript => {
      if (transcript.key_topics) {
        const topics = typeof transcript.key_topics === 'string' ? JSON.parse(transcript.key_topics) : transcript.key_topics;
        topics.forEach((topic: string) => {
          if (!themeMap.has(topic)) {
            themeMap.set(topic, { occurrences: [], totalOccurrences: 0 });
          }
          
          const themeData = themeMap.get(topic)!;
          
          // Extract quotes related to this theme (simplified approach)
          const quotes: string[] = [];
          if (transcript.notable_quotes) {
            const notableQuotes = typeof transcript.notable_quotes === 'string' 
              ? JSON.parse(transcript.notable_quotes) 
              : transcript.notable_quotes;
            
            quotes.push(...notableQuotes
              .filter((q: any) => q.text.toLowerCase().includes(topic.toLowerCase()))
              .slice(0, 2)
              .map((q: any) => q.text)
            );
          }

          themeData.occurrences.push({
            transcript_id: transcript.id,
            transcript_title: transcript.title,
            date: transcript.created_at,
            count: 1,
            quotes,
            relevance: 1.0
          });
          themeData.totalOccurrences += 1;
        });
      }
    });

    // Convert to ThemeEvolution format and analyze trends
    return Array.from(themeMap.entries())
      .map(([theme, data]) => {
        // Sort occurrences by date
        data.occurrences.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // Determine trend based on temporal distribution
        const firstHalf = data.occurrences.slice(0, Math.floor(data.occurrences.length / 2));
        const secondHalf = data.occurrences.slice(Math.floor(data.occurrences.length / 2));
        
        let trend: 'increasing' | 'decreasing' | 'stable' | 'emerging' | 'declining' = 'stable';
        if (data.occurrences.length === 1) {
          trend = 'emerging';
        } else if (secondHalf.length > firstHalf.length) {
          trend = 'increasing';
        } else if (firstHalf.length > secondHalf.length) {
          trend = 'decreasing';
        }

        return {
          theme,
          occurrences: data.occurrences,
          trend,
          totalOccurrences: data.totalOccurrences,
          avgRelevance: data.occurrences.reduce((sum, occ) => sum + occ.relevance, 0) / data.occurrences.length
        };
      })
      .sort((a, b) => b.totalOccurrences - a.totalOccurrences)
      .slice(0, 15); // Top 15 themes
  }

  /**
   * Generate concept frequency analysis
   */
  private async generateConceptFrequency(transcripts: Transcript[]): Promise<ConceptFrequency> {
    const conceptMap = new Map<string, {
      totalCount: number;
      transcriptCount: number;
      contexts: Array<{
        transcript_id: string;
        transcript_title: string;
        count: number;
        examples: string[];
      }>;
    }>();

    transcripts.forEach(transcript => {
      const transcriptConcepts = new Set<string>();
      
      // Extract concepts from key topics
      if (transcript.key_topics) {
        const topics = typeof transcript.key_topics === 'string' ? JSON.parse(transcript.key_topics) : transcript.key_topics;
        topics.forEach((topic: string) => {
          transcriptConcepts.add(topic.toLowerCase());
        });
      }

      // Extract concepts from concept frequency if available
      if (transcript.concept_frequency) {
        const concepts = typeof transcript.concept_frequency === 'string' 
          ? JSON.parse(transcript.concept_frequency) 
          : transcript.concept_frequency;
        
        Object.entries(concepts).forEach(([concept, data]: [string, any]) => {
          transcriptConcepts.add(concept.toLowerCase());
          
          if (!conceptMap.has(concept)) {
            conceptMap.set(concept, {
              totalCount: 0,
              transcriptCount: 0,
              contexts: []
            });
          }
          
          const conceptData = conceptMap.get(concept)!;
          conceptData.totalCount += data.count || 1;
          conceptData.contexts.push({
            transcript_id: transcript.id,
            transcript_title: transcript.title,
            count: data.count || 1,
            examples: data.contexts?.slice(0, 2) || []
          });
        });
      }

      // Count unique concepts per transcript
      transcriptConcepts.forEach(concept => {
        if (!conceptMap.has(concept)) {
          conceptMap.set(concept, {
            totalCount: 1,
            transcriptCount: 0,
            contexts: []
          });
        }
        conceptMap.get(concept)!.transcriptCount += 1;
      });
    });

    // Convert to ConceptFrequency format
    const result: ConceptFrequency = {};
    conceptMap.forEach((data, concept) => {
      if (data.transcriptCount > 1) { // Only include concepts that appear in multiple transcripts
        result[concept] = {
          totalCount: data.totalCount,
          transcriptCount: data.transcriptCount,
          avgFrequency: data.totalCount / data.transcriptCount,
          contexts: data.contexts,
          trend: data.transcriptCount > transcripts.length * 0.6 ? 'increasing' : 'stable'
        };
      }
    });

    return result;
  }

  /**
   * Generate speaker analysis
   */
  private async generateSpeakerAnalysis(transcripts: Transcript[]): Promise<SpeakerAnalysis> {
    const speakerMap = new Map<string, {
      transcriptCount: number;
      totalSegments: number;
      themes: Set<string>;
      keyQuotes: string[];
    }>();

    const speakerInteractions: SpeakerAnalysis['speakerInteractions'] = [];

    transcripts.forEach(transcript => {
      const transcriptSpeakers: string[] = [];
      
      if (transcript.speakers && Array.isArray(transcript.speakers)) {
        transcript.speakers.forEach(speaker => {
          const speakerName = speaker.name || speaker.id || 'Unknown';
          transcriptSpeakers.push(speakerName);
          
          if (!speakerMap.has(speakerName)) {
            speakerMap.set(speakerName, {
              transcriptCount: 0,
              totalSegments: 0,
              themes: new Set(),
              keyQuotes: []
            });
          }
          
          const speakerData = speakerMap.get(speakerName)!;
          speakerData.transcriptCount += 1;
          speakerData.totalSegments += speaker.segments || 0;
          
          // Add themes from transcript
          if (transcript.key_topics) {
            const topics = typeof transcript.key_topics === 'string' ? JSON.parse(transcript.key_topics) : transcript.key_topics;
            topics.forEach((topic: string) => speakerData.themes.add(topic));
          }
          
          // Add notable quotes
          if (transcript.notable_quotes) {
            const quotes = typeof transcript.notable_quotes === 'string' ? JSON.parse(transcript.notable_quotes) : transcript.notable_quotes;
            const speakerQuotes = quotes
              .filter((q: any) => q.speaker === speakerName)
              .slice(0, 2)
              .map((q: any) => q.text);
            speakerData.keyQuotes.push(...speakerQuotes);
          }
        });
      }

      // Determine interaction pattern
      let interactionPattern: 'interview' | 'discussion' | 'presentation' | 'unknown' = 'unknown';
      if (transcriptSpeakers.length === 1) {
        interactionPattern = 'presentation';
      } else if (transcriptSpeakers.length === 2) {
        interactionPattern = 'interview';
      } else if (transcriptSpeakers.length > 2) {
        interactionPattern = 'discussion';
      }

      speakerInteractions.push({
        transcript_id: transcript.id,
        transcript_title: transcript.title,
        speakers: transcriptSpeakers,
        interactionPattern
      });
    });

    // Convert speaker data
    const speakerDistribution: SpeakerAnalysis['speakerDistribution'] = {};
    speakerMap.forEach((data, speakerName) => {
      speakerDistribution[speakerName] = {
        transcriptCount: data.transcriptCount,
        totalSegments: data.totalSegments,
        avgSegmentsPerTranscript: data.totalSegments / data.transcriptCount,
        themes: Array.from(data.themes),
        keyQuotes: data.keyQuotes.slice(0, 3)
      };
    });

    return {
      totalSpeakers: speakerMap.size,
      speakerDistribution,
      speakerInteractions
    };
  }

  /**
   * Generate timeline analysis
   */
  private async generateTimelineAnalysis(transcripts: Transcript[]): Promise<TimelineAnalysis> {
    if (transcripts.length === 0) {
      return {
        dateRange: { start: '', end: '' },
        transcriptsByPeriod: [],
        themeEvolutionTimeline: [],
        sentimentTrend: []
      };
    }

    // Sort by date
    const sortedTranscripts = [...transcripts].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const dateRange = {
      start: sortedTranscripts[0].created_at,
      end: sortedTranscripts[sortedTranscripts.length - 1].created_at
    };

    // Group by month
    const monthlyData = new Map<string, {
      count: number;
      totalDuration: number;
      themes: Set<string>;
      sentiments: number[];
    }>();

    sortedTranscripts.forEach(transcript => {
      const month = new Date(transcript.created_at).toISOString().substring(0, 7); // YYYY-MM
      
      if (!monthlyData.has(month)) {
        monthlyData.set(month, {
          count: 0,
          totalDuration: 0,
          themes: new Set(),
          sentiments: []
        });
      }
      
      const monthData = monthlyData.get(month)!;
      monthData.count += 1;
      monthData.totalDuration += transcript.duration || 0;
      
      // Add themes
      if (transcript.key_topics) {
        const topics = typeof transcript.key_topics === 'string' ? JSON.parse(transcript.key_topics) : transcript.key_topics;
        topics.forEach((topic: string) => monthData.themes.add(topic));
      }
      
      // Add sentiment
      if (transcript.sentiment_score !== undefined) {
        monthData.sentiments.push(transcript.sentiment_score);
      }
    });

    // Convert to timeline format
    const transcriptsByPeriod = Array.from(monthlyData.entries()).map(([period, data]) => ({
      period,
      count: data.count,
      totalDuration: data.totalDuration,
      themes: Array.from(data.themes).slice(0, 5)
    }));

    const sentimentTrend = Array.from(monthlyData.entries())
      .filter(([_, data]) => data.sentiments.length > 0)
      .map(([date, data]) => ({
        date,
        avgSentiment: data.sentiments.reduce((sum, s) => sum + s, 0) / data.sentiments.length,
        transcriptCount: data.count
      }));

    // Theme evolution timeline (simplified)
    const themeEvolutionTimeline = Array.from(monthlyData.entries()).map(([date, data]) => ({
      date,
      themes: Array.from(data.themes).slice(0, 3).map(theme => ({
        theme,
        strength: Math.random() * 0.5 + 0.5 // Placeholder - would need more sophisticated analysis
      }))
    }));

    return {
      dateRange,
      transcriptsByPeriod,
      themeEvolutionTimeline,
      sentimentTrend
    };
  }

  /**
   * Generate cross-transcript patterns
   */
  private async generateCrossTranscriptPatterns(transcripts: Transcript[]): Promise<CrossTranscriptPattern[]> {
    const patterns: CrossTranscriptPattern[] = [];

    // Theme consistency pattern
    const themeOccurrences = new Map<string, string[]>();
    transcripts.forEach(transcript => {
      if (transcript.key_topics) {
        const topics = typeof transcript.key_topics === 'string' ? JSON.parse(transcript.key_topics) : transcript.key_topics;
        topics.forEach((topic: string) => {
          if (!themeOccurrences.has(topic)) {
            themeOccurrences.set(topic, []);
          }
          themeOccurrences.get(topic)!.push(transcript.id);
        });
      }
    });

    // Find themes that appear in most transcripts
    themeOccurrences.forEach((transcriptIds, theme) => {
      const consistency = transcriptIds.length / transcripts.length;
      if (consistency >= 0.6 && transcriptIds.length >= 3) {
        patterns.push({
          type: 'theme_consistency',
          description: `Theme "${theme}" appears consistently across transcripts`,
          strength: consistency,
          evidence: transcriptIds.map(id => {
            const transcript = transcripts.find(t => t.id === id)!;
            return {
              transcript_id: id,
              transcript_title: transcript.title,
              date: transcript.created_at,
              supporting_data: { theme }
            };
          }),
          insights: [
            `This theme appears in ${Math.round(consistency * 100)}% of project transcripts`,
            'Indicates a core focus area across the project timeline'
          ]
        });
      }
    });

    // Sentiment shift pattern
    const sentimentData = transcripts
      .filter(t => t.sentiment_score !== undefined)
      .map(t => ({ 
        id: t.id, 
        title: t.title, 
        date: t.created_at, 
        sentiment: t.sentiment_score! 
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (sentimentData.length >= 3) {
      const firstThird = sentimentData.slice(0, Math.floor(sentimentData.length / 3));
      const lastThird = sentimentData.slice(-Math.floor(sentimentData.length / 3));
      
      const avgFirst = firstThird.reduce((sum, d) => sum + d.sentiment, 0) / firstThird.length;
      const avgLast = lastThird.reduce((sum, d) => sum + d.sentiment, 0) / lastThird.length;
      const shift = Math.abs(avgLast - avgFirst);

      if (shift > 0.2) {
        patterns.push({
          type: 'sentiment_shift',
          description: `Sentiment ${avgLast > avgFirst ? 'improved' : 'declined'} over time`,
          strength: Math.min(shift, 1.0),
          evidence: [
            ...firstThird.slice(0, 2),
            ...lastThird.slice(0, 2)
          ].map(d => ({
            transcript_id: d.id,
            transcript_title: d.title,
            date: d.date,
            supporting_data: { sentiment: d.sentiment }
          })),
          insights: [
            `Sentiment ${avgLast > avgFirst ? 'increased' : 'decreased'} by ${shift.toFixed(2)} points`,
            'May indicate changing project dynamics or outcomes'
          ]
        });
      }
    }

    return patterns.slice(0, 5); // Limit to top 5 patterns
  }

  getConfig(): ProjectAnalysisConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const projectAnalysisService = ProjectAnalysisService.getInstance();