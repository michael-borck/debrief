import React, { useState, useCallback, useMemo } from 'react';
import { logger } from '../utils/logger';
import { Transcript } from '../types';

interface SearchResult {
  transcript: Transcript;
  matches: {
    field: string;
    content: string;
    context: string;
    startIndex: number;
    endIndex: number;
  }[];
  totalMatches: number;
  relevanceScore: number;
}

interface ProjectCrossTranscriptSearchProps {
  transcripts: Transcript[];
  className?: string;
}

export const ProjectCrossTranscriptSearch: React.FC<ProjectCrossTranscriptSearchProps> = ({
  transcripts,
  className = ""
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<'all' | 'text' | 'themes' | 'quotes' | 'insights'>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState<'all' | 'positive' | 'negative' | 'neutral'>('all');

  // Extract all unique speakers from transcripts
  const allSpeakers = useMemo(() => {
    const speakers = new Set<string>();
    transcripts.forEach(transcript => {
      if (transcript.speakers && Array.isArray(transcript.speakers)) {
        transcript.speakers.forEach(speaker => {
          const speakerName = typeof speaker === 'string' ? speaker : speaker.name || speaker.id;
          if (speakerName) speakers.add(speakerName);
        });
      }
    });
    return Array.from(speakers).sort();
  }, [transcripts]);

  // Returns React children rather than an HTML string, so the surrounding
  // JSX escapes the text automatically. The previous version interpolated
  // raw transcript content into HTML and fed it to dangerouslySetInnerHTML
  // — a transcript titled `<img src=x onerror=...>` would execute on every
  // search.
  //
  // String.split with a capturing-group regex puts matched chunks at odd
  // indices and unmatched chunks at even indices, so we don't need to
  // re-test each part against a stateful regex.
  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query.trim() || !text) return text;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      i % 2 === 1
        ? <mark key={i} className="bg-yellow-200 px-1 rounded">{part}</mark>
        : <React.Fragment key={i}>{part}</React.Fragment>
    );
  };

  const getContextWindow = (text: string, matchIndex: number, matchLength: number, windowSize: number = 100): string => {
    const start = Math.max(0, matchIndex - windowSize);
    const end = Math.min(text.length, matchIndex + matchLength + windowSize);
    
    let context = text.substring(start, end);
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context;
  };

  const calculateRelevanceScore = (matches: any[], transcript: Transcript): number => {
    let score = 0;
    
    // Base score from number of matches
    score += matches.length * 10;
    
    // Boost for matches in important fields
    matches.forEach(match => {
      switch (match.field) {
        case 'title':
          score += 50;
          break;
        case 'summary':
          score += 30;
          break;
        case 'key_insights':
          score += 25;
          break;
        case 'notable_quotes':
          score += 20;
          break;
        case 'research_themes':
          score += 20;
          break;
        case 'key_topics':
          score += 15;
          break;
        case 'full_text':
          score += 5;
          break;
        default:
          score += 5;
      }
    });
    
    // Boost for recent transcripts
    const daysSinceCreated = (Date.now() - new Date(transcript.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 30) score += 10;
    else if (daysSinceCreated < 90) score += 5;
    
    // Boost for starred transcripts
    if (transcript.starred) score += 15;
    
    // Normalize score
    return Math.min(100, score);
  };

  const searchInField = (content: any, field: string, query: string): any[] => {
    if (!content || !query.trim()) return [];
    
    const matches: any[] = [];
    const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1);
    
    const searchInText = (text: string, fieldName: string) => {
      if (!text) return;
      
      const lowerText = text.toLowerCase();
      searchTerms.forEach(term => {
        let index = lowerText.indexOf(term);
        while (index !== -1) {
          matches.push({
            field: fieldName,
            content: text,
            context: getContextWindow(text, index, term.length),
            startIndex: index,
            endIndex: index + term.length
          });
          index = lowerText.indexOf(term, index + 1);
        }
      });
    };
    
    if (typeof content === 'string') {
      searchInText(content, field);
    } else if (Array.isArray(content)) {
      content.forEach((item, index) => {
        if (typeof item === 'string') {
          searchInText(item, `${field}[${index}]`);
        } else if (typeof item === 'object' && item) {
          // Handle objects in arrays (like research themes, quotes)
          Object.entries(item).forEach(([key, value]) => {
            if (typeof value === 'string') {
              searchInText(value, `${field}[${index}].${key}`);
            }
          });
        }
      });
    } else if (typeof content === 'object' && content) {
      Object.entries(content).forEach(([key, value]) => {
        if (typeof value === 'string') {
          searchInText(value, `${field}.${key}`);
        }
      });
    }
    
    return matches;
  };

  const performSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    
    setIsSearching(true);
    
    try {
      const searchResults: SearchResult[] = [];
      
      // Filter transcripts by date range and sentiment
      let filteredTranscripts = transcripts.filter(transcript => {
        // Date filter
        if (dateRange.start && new Date(transcript.created_at) < new Date(dateRange.start)) {
          return false;
        }
        if (dateRange.end && new Date(transcript.created_at) > new Date(dateRange.end)) {
          return false;
        }
        
        // Sentiment filter
        if (sentimentFilter !== 'all' && transcript.sentiment_overall) {
          if (sentimentFilter !== transcript.sentiment_overall) {
            return false;
          }
        }
        
        // Speaker filter
        if (speakerFilter && transcript.speakers) {
          const hasMatchingSpeaker = transcript.speakers.some(speaker => {
            const speakerName = typeof speaker === 'string' ? speaker : speaker.name || speaker.id;
            return speakerName?.toLowerCase().includes(speakerFilter.toLowerCase());
          });
          if (!hasMatchingSpeaker) return false;
        }
        
        return true;
      });
      
      for (const transcript of filteredTranscripts) {
        const allMatches: any[] = [];
        
        // Define searchable fields based on filter
        const fieldsToSearch: { [key: string]: any } = {};
        
        if (searchFilter === 'all' || searchFilter === 'text') {
          fieldsToSearch.title = transcript.title;
          fieldsToSearch.full_text = transcript.full_text;
          fieldsToSearch.validated_text = transcript.validated_text;
          fieldsToSearch.processed_text = transcript.processed_text;
          fieldsToSearch.summary = transcript.summary;
        }
        
        if (searchFilter === 'all' || searchFilter === 'themes') {
          fieldsToSearch.key_topics = transcript.key_topics;
          fieldsToSearch.research_themes = transcript.research_themes;
        }
        
        if (searchFilter === 'all' || searchFilter === 'quotes') {
          fieldsToSearch.notable_quotes = transcript.notable_quotes;
        }
        
        if (searchFilter === 'all' || searchFilter === 'insights') {
          fieldsToSearch.action_items = transcript.action_items;
          fieldsToSearch.qa_pairs = transcript.qa_pairs;
        }
        
        // Search in each field
        Object.entries(fieldsToSearch).forEach(([field, content]) => {
          const matches = searchInField(content, field, searchQuery);
          allMatches.push(...matches);
        });
        
        if (allMatches.length > 0) {
          const relevanceScore = calculateRelevanceScore(allMatches, transcript);
          
          searchResults.push({
            transcript,
            matches: allMatches,
            totalMatches: allMatches.length,
            relevanceScore
          });
        }
      }
      
      // Sort by relevance score
      searchResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      setResults(searchResults);
    } catch (error) {
      logger.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchFilter, transcripts, dateRange, speakerFilter, sentimentFilter]);

  const clearFilters = () => {
    setDateRange({ start: '', end: '' });
    setSpeakerFilter('');
    setSentimentFilter('all');
    setSearchFilter('all');
  };

  // Debounced search
  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch();
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [performSearch]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getFieldDisplayName = (field: string): string => {
    const fieldMap: { [key: string]: string } = {
      'title': 'Title',
      'full_text': 'Transcript Text',
      'validated_text': 'Corrected Text',
      'processed_text': 'Speaker-Tagged Text',
      'summary': 'Summary',
      'key_topics': 'Key Topics',
      'research_themes': 'Research Themes',
      'notable_quotes': 'Notable Quotes',
      'action_items': 'Action Items',
      'key_insights': 'Key Insights',
      'qa_pairs': 'Q&A Pairs'
    };
    
    // Handle nested fields
    const baseField = field.split('[')[0].split('.')[0];
    return fieldMap[baseField] || field;
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Search Input */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search across all transcripts..."
              className="w-full px-4 py-2 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <select
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value as any)}
            className="px-3 py-2 border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option value="all">All Fields</option>
            <option value="text">Text Content</option>
            <option value="themes">Themes & Topics</option>
            <option value="quotes">Quotes</option>
            <option value="insights">Insights & Actions</option>
          </select>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="px-4 py-2 text-surface-600 hover:text-surface-800 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            {showAdvanced ? 'Simple' : 'Advanced'}
          </button>
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-surface-50 rounded-lg">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Date From</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Date To</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Speaker</label>
              <select
                value={speakerFilter}
                onChange={(e) => setSpeakerFilter(e.target.value)}
                className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
              >
                <option value="">All Speakers</option>
                {allSpeakers.map(speaker => (
                  <option key={speaker} value={speaker}>{speaker}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Sentiment</label>
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
              >
                <option value="all">All</option>
                <option value="positive">Positive</option>
                <option value="negative">Negative</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-sm text-surface-600 hover:text-surface-800 border border-surface-200 rounded hover:bg-surface-50"
              >
                Clear Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search Results */}
      <div className="space-y-4">
        {/* Results Header */}
        {searchQuery.trim() && (
          <div className="flex items-center justify-between text-sm text-surface-600">
            <div>
              {isSearching ? (
                'Searching...'
              ) : (
                `${results.length} transcript(s) found with "${searchQuery}"`
              )}
            </div>
            {results.length > 0 && (
              <div>
                {results.reduce((sum, result) => sum + result.totalMatches, 0)} total matches
              </div>
            )}
          </div>
        )}

        {/* Results List */}
        {results.map((result) => (
          <div key={result.transcript.id} className="bg-white rounded-lg border p-4">
            {/* Transcript Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1">
                <h3 className="font-semibold text-surface-900">
                  {highlightText(result.transcript.title, searchQuery)}
                </h3>
                <div className="text-sm text-surface-500">
                  {formatDate(result.transcript.created_at)} • 
                  {result.totalMatches} match{result.totalMatches !== 1 ? 'es' : ''} • 
                  Relevance: {result.relevanceScore}%
                  {result.transcript.starred && ' • ⭐'}
                </div>
              </div>
              <button
                onClick={() => window.open(`/transcript/${result.transcript.id}`, '_blank')}
                className="px-3 py-1 text-sm bg-primary-100 text-primary-700 rounded hover:bg-primary-200 transition-colors"
              >
                Open
              </button>
            </div>

            {/* Match Previews */}
            <div className="space-y-2">
              {result.matches.slice(0, 5).map((match, matchIndex) => (
                <div key={matchIndex} className="border-l-4 border-primary-200 pl-3">
                  <div className="text-xs text-surface-500 mb-1">
                    {getFieldDisplayName(match.field)}
                  </div>
                  <div className="text-sm text-surface-700">
                    {highlightText(match.context, searchQuery)}
                  </div>
                </div>
              ))}
              
              {result.matches.length > 5 && (
                <div className="text-sm text-surface-500 italic">
                  + {result.matches.length - 5} more matches
                </div>
              )}
            </div>
          </div>
        ))}

        {/* No Results */}
        {searchQuery.trim() && !isSearching && results.length === 0 && (
          <div className="bg-white rounded-lg border p-8 text-center">
            <div className="text-surface-400 mb-2">
              <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="text-surface-600">No transcripts found matching "{searchQuery}"</div>
            {(dateRange.start || dateRange.end || speakerFilter || sentimentFilter !== 'all') && (
              <div className="text-sm text-surface-500 mt-2">
                Try adjusting your filters or search in all fields
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!searchQuery.trim() && (
          <div className="bg-white rounded-lg border p-8 text-center">
            <div className="text-surface-400 mb-2">
              <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="text-surface-600">Search across all transcripts in this project</div>
            <div className="text-sm text-surface-500 mt-1">
              Find themes, quotes, insights, and patterns across multiple conversations
            </div>
          </div>
        )}
      </div>
    </div>
  );
};