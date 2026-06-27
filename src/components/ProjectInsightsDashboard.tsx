import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import { Project } from '../types';
import { ProjectAnalysisExport } from './ProjectAnalysisExport';

interface ProjectInsightsDashboardProps {
  project: Project;
  onAnalyze: () => Promise<void>;
}

interface DetailedAnalysis {
  // Current collated analysis structure
  aggregatedThemes?: Array<{
    theme: string;
    frequency: number;
    sources: Array<{
      transcriptId: string;
      transcriptTitle: string;
      relevance: number;
    }>;
  }>;
  mergedTopics?: string[];
  mergedActionItems?: string[];
  consensusInsights?: string[];
  
  // Comprehensive analysis structure
  themeEvolution?: Array<{
    theme: string;
    occurrences: Array<{
      transcript_id: string;
      transcript_title: string;
      date: string;
      count: number;
      quotes: string[];
      relevance: number;
    }>;
    trend: 'increasing' | 'decreasing' | 'stable' | 'emerging' | 'declining';
    totalOccurrences: number;
    avgRelevance: number;
  }>;
  conceptFrequency?: {
    [concept: string]: {
      totalCount: number;
      transcriptCount: number;
      avgFrequency: number;
      contexts: Array<{
        transcript_id: string;
        transcript_title: string;
        count: number;
        examples: string[];
      }>;
      trend: 'increasing' | 'decreasing' | 'stable';
    };
  };
  speakerAnalysis?: {
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
    speakerInteractions: Array<{
      transcript_id: string;
      transcript_title: string;
      speakers: string[];
      interactionPattern: 'interview' | 'discussion' | 'presentation' | 'unknown';
    }>;
  };
  timelineAnalysis?: {
    dateRange: {
      start: string;
      end: string;
    };
    transcriptsByPeriod: Array<{
      period: string;
      count: number;
      totalDuration: number;
      themes: string[];
    }>;
    themeEvolutionTimeline: Array<{
      date: string;
      themes: Array<{ theme: string; strength: number }>;
    }>;
    sentimentTrend: Array<{
      date: string;
      avgSentiment: number;
      transcriptCount: number;
    }>;
  };
  crossTranscriptPatterns?: Array<{
    type: 'theme_consistency' | 'theme_evolution' | 'speaker_behavior' | 'sentiment_shift' | 'concept_emergence';
    description: string;
    strength: number;
    evidence: Array<{
      transcript_id: string;
      transcript_title: string;
      date: string;
      supporting_data: unknown;
    }>;
    insights: string[];
  }>;
}

export const ProjectInsightsDashboard: React.FC<ProjectInsightsDashboardProps> = ({ 
  project, 
  onAnalyze 
}) => {
  const [detailedAnalysis, setDetailedAnalysis] = useState<DetailedAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeView, setActiveView] = useState<'overview' | 'themes' | 'concepts' | 'speakers' | 'timeline' | 'patterns'>('overview');
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    loadDetailedAnalysis();
  }, [project.id]);

  const loadDetailedAnalysis = async () => {
    try {
      const result = await window.electronAPI.db.projectAnalysis.getLatestResults(project.id);

      if (result?.results) {
        setDetailedAnalysis(JSON.parse(result.results));
      }
    } catch (error) {
      logger.error('Failed to load detailed analysis:', error);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      await onAnalyze();
      await loadDetailedAnalysis();
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-surface-900">🔍 Project Analysis</h2>
        <div className="flex gap-2">
          {project.last_analysis_at && (
            <button
              onClick={() => setShowExportModal(true)}
              className="px-4 py-2 text-primary-800 border border-primary-600 rounded-lg hover:bg-primary-100 transition-colors"
            >
              Export
            </button>
          )}
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="btn-primary px-4 py-2"
          >
            {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {/* Last Analysis Info */}
      {project.last_analysis_at && (
        <div className="text-sm text-surface-500">
          Last analyzed: {formatDate(project.last_analysis_at)}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex gap-4 border-b">
        {[
          { key: 'overview', label: '📊 Overview' },
          { key: 'themes', label: '🏷️ Theme Evolution' },
          { key: 'concepts', label: '🔍 Concept Analysis' },
          { key: 'speakers', label: '👥 Speaker Patterns' },
          { key: 'timeline', label: '📅 Timeline' },
          { key: 'patterns', label: '🔗 Cross-Patterns' }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveView(key as 'overview' | 'themes' | 'concepts' | 'speakers' | 'timeline' | 'patterns')}
            className={`pb-2 px-3 border-b-2 transition-colors ${
              activeView === key
                ? 'border-primary-600 text-primary-800 font-medium'
                : 'border-transparent text-surface-600 hover:text-surface-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-white rounded-lg border">
        {activeView === 'overview' && (
          <div className="p-6 space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-primary-100 rounded-lg p-4">
                <div className="text-2xl font-display text-primary-800">{project.transcript_count || 0}</div>
                <div className="text-sm text-surface-600">Transcripts</div>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <div className="text-2xl font-display text-green-600">
                  {project.total_duration ? formatDuration(project.total_duration) : '0h 0m'}
                </div>
                <div className="text-sm text-surface-600">Total Duration</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <div className="text-2xl font-display text-purple-600">{project.themes?.length || 0}</div>
                <div className="text-sm text-surface-600">Key Themes</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-4">
                <div className="text-2xl font-display text-orange-600">
                  {detailedAnalysis?.speakerAnalysis?.totalSpeakers || 0}
                </div>
                <div className="text-sm text-surface-600">Total Speakers</div>
              </div>
            </div>

            {/* Project Summary */}
            {project.summary && (
              <div>
                <h3 className="text-lg font-medium text-surface-900 mb-3">📝 Project Summary</h3>
                <p className="text-surface-700 leading-relaxed">{project.summary}</p>
              </div>
            )}

            {/* Key Themes */}
            {project.themes && project.themes.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-surface-900 mb-3">🏷️ Key Themes</h3>
                <div className="flex flex-wrap gap-2">
                  {project.themes.map((theme, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-primary-100 text-primary-800 rounded-full text-sm font-medium"
                    >
                      {theme}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Project Action Items — surfaced from mergedActionItems
                across all transcripts. Computed by analyzeProject but
                previously never displayed. */}
            {detailedAnalysis?.mergedActionItems && detailedAnalysis.mergedActionItems.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-surface-900 mb-3">Project Action Items</h3>
                <p className="text-xs text-surface-500 mb-3">
                  Action items collected from every transcript in this project.
                </p>
                <ul className="space-y-2">
                  {detailedAnalysis.mergedActionItems.slice(0, 20).map((item: string, index: number) => (
                    <li
                      key={index}
                      className="flex items-start gap-2 p-2.5 rounded-lg border border-surface-200 bg-white"
                    >
                      <span className="text-accent-500 mt-1 flex-shrink-0">▸</span>
                      <span className="text-sm text-surface-700">{item}</span>
                    </li>
                  ))}
                  {detailedAnalysis.mergedActionItems.length > 20 && (
                    <li className="text-xs text-surface-500 text-center pt-1">
                      +{detailedAnalysis.mergedActionItems.length - 20} more action items
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Key Insights */}
            {project.key_insights && project.key_insights.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-surface-900 mb-3">Key Insights</h3>
                <ul className="space-y-2">
                  {project.key_insights.map((insight, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary-800 mt-1 text-sm">•</span>
                      <span className="text-surface-700 text-sm">{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeView === 'themes' && (
          <div className="p-6">
            <h3 className="text-lg font-medium text-surface-900 mb-4">🏷️ Theme Evolution Analysis</h3>
            
            {detailedAnalysis?.themeEvolution ? (
              <div className="space-y-4">
                {detailedAnalysis.themeEvolution.slice(0, 10).map((theme, index: number) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-surface-900">{theme.theme}</h4>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          theme.trend === 'increasing' ? 'bg-green-100 text-green-800' :
                          theme.trend === 'decreasing' ? 'bg-red-100 text-red-800' :
                          theme.trend === 'emerging' ? 'bg-primary-100 text-primary-800' :
                          'bg-surface-100 text-surface-800'
                        }`}>
                          {theme.trend}
                        </span>
                        <span className="text-sm text-surface-500">
                          {theme.totalOccurrences} occurrences
                        </span>
                      </div>
                    </div>
                    
                    <div className="text-sm text-surface-600 mb-3">
                      Appears in {theme.occurrences.length} transcript(s) • 
                      Avg relevance: {(theme.avgRelevance * 100).toFixed(1)}%
                    </div>
                    
                    {/* Timeline */}
                    <div className="mb-3">
                      <div className="text-xs text-surface-500 mb-1">Timeline:</div>
                      <div className="flex gap-1">
                        {theme.occurrences.slice(0, 8).map((occ, i: number) => (
                          <div
                            key={i}
                            className="h-2 bg-primary-200 rounded flex-1"
                            title={`${occ.transcript_title} (${formatDate(occ.date)})`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Sample quotes */}
                    {theme.occurrences.some((occ) => occ.quotes.length > 0) && (
                      <div>
                        <div className="text-xs text-surface-500 mb-1">Sample quotes:</div>
                        <div className="text-sm text-surface-700 italic">
                          {theme.occurrences
                            .flatMap((occ) => occ.quotes)
                            .slice(0, 2)
                            .map((quote: string, i: number) => (
                              <div key={i} className="truncate">"{quote.substring(0, 100)}..."</div>
                            ))
                          }
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-surface-500">
                Run analysis to see theme evolution patterns
              </div>
            )}
          </div>
        )}

        {activeView === 'concepts' && (
          <div className="p-6">
            <h3 className="text-lg font-medium text-surface-900 mb-4">🔍 Concept Frequency Analysis</h3>
            
            {detailedAnalysis?.conceptFrequency ? (
              <div className="grid gap-4 md:grid-cols-2">
                {Object.entries(detailedAnalysis.conceptFrequency).slice(0, 12).map(([concept, data]: [string, any]) => (
                  <div key={concept} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-surface-900">{concept}</h4>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        data.trend === 'increasing' ? 'bg-green-100 text-green-800' :
                        data.trend === 'decreasing' ? 'bg-red-100 text-red-800' :
                        'bg-surface-100 text-surface-800'
                      }`}>
                        {data.trend}
                      </span>
                    </div>
                    
                    <div className="text-sm text-surface-600 mb-2">
                      Total: {data.totalCount} • Avg: {data.avgFrequency.toFixed(1)} per transcript
                    </div>
                    
                    <div className="text-sm text-surface-600">
                      Appears in {data.transcriptCount} transcript(s)
                    </div>
                    
                    {/* Context examples */}
                    {data.contexts.length > 0 && data.contexts[0].examples.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs text-surface-500 mb-1">Example context:</div>
                        <div className="text-xs text-surface-700 italic truncate">
                          "{data.contexts[0].examples[0]}"
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-surface-500">
                Run analysis to see concept frequency patterns
              </div>
            )}
          </div>
        )}

        {activeView === 'speakers' && (
          <div className="p-6">
            <h3 className="text-lg font-medium text-surface-900 mb-4">👥 Speaker Analysis</h3>
            
            {detailedAnalysis?.speakerAnalysis ? (
              <div className="space-y-6">
                {/* Speaker Distribution */}
                <div>
                  <h4 className="font-medium text-surface-900 mb-3">Speaker Distribution</h4>
                  <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(detailedAnalysis.speakerAnalysis.speakerDistribution).map(([speaker, data]) => (
                      <div key={speaker} className="border rounded-lg p-3">
                        <div className="font-medium text-surface-900 mb-1">{speaker}</div>
                        <div className="text-sm text-surface-600">
                          {data.transcriptCount} transcript(s) • {data.totalSegments} segments
                        </div>
                        {data.themes.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs text-surface-500 mb-1">Key themes:</div>
                            <div className="flex flex-wrap gap-1">
                              {data.themes.slice(0, 3).map((theme: string, i: number) => (
                                <span key={i} className="px-2 py-1 bg-surface-100 text-surface-700 rounded text-xs">
                                  {theme}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Key quotes — populated by projectAnalysisService
                            but previously never rendered. */}
                        {Array.isArray(data.keyQuotes) && data.keyQuotes.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-surface-100">
                            <div className="text-xs text-surface-500 mb-1.5">Notable quotes:</div>
                            <ul className="space-y-1.5">
                              {data.keyQuotes.slice(0, 3).map((quote: string, i: number) => (
                                <li
                                  key={i}
                                  className="text-xs text-surface-700 italic border-l-2 border-accent-300 pl-2 leading-snug"
                                >
                                  &ldquo;{quote}&rdquo;
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Speaker Interactions */}
                <div>
                  <h4 className="font-medium text-surface-900 mb-3">Interaction Patterns</h4>
                  <div className="space-y-2">
                    {detailedAnalysis.speakerAnalysis.speakerInteractions.slice(0, 5).map((interaction, index: number) => (
                      <div key={index} className="border rounded p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-surface-900">{interaction.transcript_title}</div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            interaction.interactionPattern === 'interview' ? 'bg-primary-100 text-primary-800' :
                            interaction.interactionPattern === 'discussion' ? 'bg-green-100 text-green-800' :
                            interaction.interactionPattern === 'presentation' ? 'bg-purple-100 text-purple-800' :
                            'bg-surface-100 text-surface-800'
                          }`}>
                            {interaction.interactionPattern}
                          </span>
                        </div>
                        <div className="text-sm text-surface-600 mt-1">
                          Speakers: {interaction.speakers.join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-surface-500">
                Run analysis to see speaker patterns
              </div>
            )}
          </div>
        )}

        {activeView === 'timeline' && (
          <div className="p-6">
            <h3 className="text-lg font-medium text-surface-900 mb-4">📅 Timeline Analysis</h3>
            
            {detailedAnalysis?.timelineAnalysis ? (
              <div className="space-y-6">
                {/* Date Range */}
                <div className="bg-surface-50 rounded-lg p-4">
                  <div className="text-sm font-medium text-surface-700">Project Timeline</div>
                  <div className="text-lg font-semibold text-surface-900">
                    {formatDate(detailedAnalysis.timelineAnalysis.dateRange.start)} → {formatDate(detailedAnalysis.timelineAnalysis.dateRange.end)}
                  </div>
                </div>

                {/* Transcripts by Period */}
                <div>
                  <h4 className="font-medium text-surface-900 mb-3">Activity by Month</h4>
                  <div className="space-y-2">
                    {detailedAnalysis.timelineAnalysis.transcriptsByPeriod.map((period, index: number) => (
                      <div key={index} className="flex items-center justify-between border rounded p-3">
                        <div>
                          <div className="font-medium text-surface-900">{period.period}</div>
                          <div className="text-sm text-surface-600">
                            {period.count} transcript(s) • {formatDuration(period.totalDuration)}
                          </div>
                        </div>
                        <div className="text-right">
                          {period.themes.slice(0, 2).map((theme: string, i: number) => (
                            <div key={i} className="text-xs text-surface-500">{theme}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sentiment Trend */}
                {detailedAnalysis.timelineAnalysis.sentimentTrend.length > 0 && (
                  <div>
                    <h4 className="font-medium text-surface-900 mb-3">Sentiment Trend</h4>
                    <div className="space-y-2">
                      {detailedAnalysis.timelineAnalysis.sentimentTrend.map((point, index: number) => (
                        <div key={index} className="flex items-center justify-between border rounded p-2">
                          <div className="text-sm text-surface-700">{formatDate(point.date)}</div>
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${
                              point.avgSentiment > 0.1 ? 'bg-green-400' :
                              point.avgSentiment < -0.1 ? 'bg-red-400' :
                              'bg-surface-400'
                            }`} />
                            <span className="text-sm text-surface-600">
                              {point.avgSentiment.toFixed(2)} ({point.transcriptCount} transcript{point.transcriptCount !== 1 ? 's' : ''})
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-surface-500">
                Run analysis to see timeline patterns
              </div>
            )}
          </div>
        )}

        {activeView === 'patterns' && (
          <div className="p-6">
            <h3 className="text-lg font-medium text-surface-900 mb-4">🔗 Cross-Transcript Patterns</h3>
            
            {detailedAnalysis?.crossTranscriptPatterns ? (
              <div className="space-y-4">
                {detailedAnalysis.crossTranscriptPatterns.map((pattern, index: number) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-surface-900">{pattern.description}</h4>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          pattern.type === 'theme_consistency' ? 'bg-primary-100 text-primary-800' :
                          pattern.type === 'concept_emergence' ? 'bg-green-100 text-green-800' :
                          pattern.type === 'sentiment_shift' ? 'bg-orange-100 text-orange-800' :
                          'bg-surface-100 text-surface-800'
                        }`}>
                          {pattern.type.replace('_', ' ')}
                        </span>
                        <div className="text-sm text-surface-500">
                          Strength: {(pattern.strength * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>

                    {/* Evidence */}
                    <div className="mb-3">
                      <div className="text-sm text-surface-600 mb-2">
                        Evidence from {pattern.evidence.length} transcript(s):
                      </div>
                      <div className="space-y-1">
                        {pattern.evidence.slice(0, 3).map((evidence, i: number) => (
                          <div key={i} className="text-sm text-surface-700">
                            • {evidence.transcript_title} ({formatDate(evidence.date)})
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Insights */}
                    {pattern.insights.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-surface-700 mb-1">Insights:</div>
                        {pattern.insights.map((insight: string, i: number) => (
                          <div key={i} className="text-sm text-surface-600 italic">
                            • {insight}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {detailedAnalysis.crossTranscriptPatterns.length === 0 && (
                  <div className="text-center py-8 text-surface-500">
                    No significant cross-transcript patterns detected
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-surface-500">
                Run analysis to identify cross-transcript patterns
              </div>
            )}
          </div>
        )}

        {/* No Analysis State */}
        {!project.last_analysis_at && !detailedAnalysis && (
          <div className="p-12 text-center">
            <div className="text-surface-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-surface-900 mb-2">No Analysis Yet</h3>
            <p className="text-surface-500 mb-4">Run analysis to see comprehensive insights across all project transcripts</p>
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="btn-primary px-6 py-2"
            >
              {isAnalyzing ? 'Analyzing...' : 'Start Analysis'}
            </button>
          </div>
        )}
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <ProjectAnalysisExport
          project={project}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
};