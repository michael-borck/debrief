import React, { useState, useEffect, useContext } from 'react';
import { logger } from '../utils/logger';
import { Search, Filter, Calendar, Clock, Palette, CheckSquare, Square, X } from 'lucide-react';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { Transcript } from '../types';
import { formatDate, formatDuration } from '../utils/helpers';
import { Modal } from './Modal';

interface AddExistingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (transcriptIds: string[]) => void;
  excludeTranscriptIds: string[]; // Transcripts already in the project
}

export const AddExistingModal: React.FC<AddExistingModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  excludeTranscriptIds
}) => {
  const { transcripts, searchTranscripts } = useContext(TranscriptContext);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Filter state
  const [filters, setFilters] = useState({
    dateRange: { start: '', end: '' },
    duration: { min: '', max: '' },
    sentiment: '',
    hasKeywords: [] as string[]
  });

  useEffect(() => {
    if (isOpen) {
      performSearch();
    }
  }, [searchQuery, filters, transcripts, isOpen]);

  useEffect(() => {
    if (isOpen) {
      // Reset state when modal opens
      setSearchQuery('');
      setSelectedItems(new Set());
      setFilters({
        dateRange: { start: '', end: '' },
        duration: { min: '', max: '' },
        sentiment: '',
        hasKeywords: []
      });
    }
  }, [isOpen]);

  const performSearch = async () => {
    setLoading(true);
    try {
      let searchResults: Transcript[] = [];

      // Search transcripts
      if (searchQuery) {
        searchResults = await searchTranscripts(searchQuery);
      } else {
        // If no search query, show all completed transcripts
        searchResults = transcripts.filter(t => t.status === 'completed');
      }

      // Exclude transcripts already in project
      searchResults = searchResults.filter(t => !excludeTranscriptIds.includes(t.id));

      // Apply filters
      searchResults = applyFilters(searchResults);

      // Sort by date (newest first)
      searchResults.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setResults(searchResults);
    } catch (error) {
      logger.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (results: Transcript[]): Transcript[] => {
    return results.filter(transcript => {
      // Date range filter
      if (filters.dateRange.start) {
        const itemDate = new Date(transcript.created_at);
        const startDate = new Date(filters.dateRange.start);
        if (itemDate < startDate) return false;
      }
      if (filters.dateRange.end) {
        const itemDate = new Date(transcript.created_at);
        const endDate = new Date(filters.dateRange.end);
        if (itemDate > endDate) return false;
      }

      // Duration filter
      if (filters.duration.min && transcript.duration < parseInt(filters.duration.min)) {
        return false;
      }
      if (filters.duration.max && transcript.duration > parseInt(filters.duration.max)) {
        return false;
      }

      // Sentiment filter
      if (filters.sentiment && transcript.sentiment_overall !== filters.sentiment) {
        return false;
      }

      // Keywords filter
      if (filters.hasKeywords.length > 0) {
        const hasKeyword = filters.hasKeywords.some(keyword =>
          transcript.key_topics?.some(topic => 
            topic.toLowerCase().includes(keyword.toLowerCase())
          )
        );
        if (!hasKeyword) return false;
      }

      return true;
    });
  };

  const toggleItemSelection = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    setSelectedItems(new Set(results.map(r => r.id)));
  };

  const clearSelection = () => {
    setSelectedItems(new Set());
  };

  const handleAdd = () => {
    onAdd(Array.from(selectedItems));
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Add Existing Transcripts"
      contentClassName="bg-white rounded-lg shadow-elevated w-full max-w-4xl max-h-[90vh] flex flex-col"
    >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-surface-900">Add Existing Transcripts</h2>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-600"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Search Bar */}
          <div className="mb-6">
            <div className="flex items-center space-x-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-surface-400" size={20} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search transcripts..."
                  className="input pl-10 py-3"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center space-x-2 px-4 py-3 border rounded-lg transition-colors ${
                  showFilters 
                    ? 'border-primary-400 bg-primary-100 text-primary-700' 
                    : 'border-surface-200 hover:bg-surface-50'
                }`}
              >
                <Filter size={20} />
                <span>Filters</span>
              </button>
            </div>

            {/* Filters Panel */}
            {showFilters && (
              <div className="mt-6 pt-6 border-t border-surface-200">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Date Range Filter */}
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-2">
                      <Calendar size={16} className="inline mr-1" />
                      Date Range
                    </label>
                    <div className="space-y-2">
                      <input
                        type="date"
                        value={filters.dateRange.start}
                        onChange={(e) => setFilters(prev => ({
                          ...prev,
                          dateRange: { ...prev.dateRange, start: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
                      />
                      <input
                        type="date"
                        value={filters.dateRange.end}
                        onChange={(e) => setFilters(prev => ({
                          ...prev,
                          dateRange: { ...prev.dateRange, end: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
                      />
                    </div>
                  </div>

                  {/* Duration Filter */}
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-2">
                      <Clock size={16} className="inline mr-1" />
                      Duration (seconds)
                    </label>
                    <div className="space-y-2">
                      <input
                        type="number"
                        placeholder="Min duration"
                        value={filters.duration.min}
                        onChange={(e) => setFilters(prev => ({
                          ...prev,
                          duration: { ...prev.duration, min: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
                      />
                      <input
                        type="number"
                        placeholder="Max duration"
                        value={filters.duration.max}
                        onChange={(e) => setFilters(prev => ({
                          ...prev,
                          duration: { ...prev.duration, max: e.target.value }
                        }))}
                        className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
                      />
                    </div>
                  </div>

                  {/* Sentiment Filter */}
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-2">
                      <Palette size={16} className="inline mr-1" />
                      Sentiment
                    </label>
                    <select
                      value={filters.sentiment}
                      onChange={(e) => setFilters(prev => ({ ...prev, sentiment: e.target.value }))}
                      className="w-full px-3 py-2 border border-surface-200 rounded text-sm"
                    >
                      <option value="">All sentiments</option>
                      <option value="positive">Positive</option>
                      <option value="neutral">Neutral</option>
                      <option value="negative">Negative</option>
                    </select>
                  </div>
                </div>

                {/* Clear Filters */}
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => setFilters({
                      dateRange: { start: '', end: '' },
                      duration: { min: '', max: '' },
                      sentiment: '',
                      hasKeywords: []
                    })}
                    className="text-sm text-surface-600 hover:text-surface-800"
                  >
                    Clear all filters
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Selection Summary */}
          {selectedItems.size > 0 && (
            <div className="bg-primary-100 border border-primary-200 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-primary-900">
                  {selectedItems.size} transcript{selectedItems.size !== 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={clearSelection}
                    className="text-sm text-primary-800 hover:text-primary-900"
                  >
                    Clear selection
                  </button>
                  {results.length > 0 && (
                    <button
                      onClick={selectAll}
                      className="text-sm text-primary-800 hover:text-primary-900"
                    >
                      Select all
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Results */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-surface-900">
                {loading ? 'Searching...' : `${results.length} available transcripts`}
              </h3>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <p className="ml-3 text-surface-600">Searching...</p>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-12">
                <Search className="mx-auto h-12 w-12 text-surface-400" />
                <h3 className="mt-4 text-lg font-medium text-surface-900">No transcripts found</h3>
                <p className="mt-2 text-surface-600">
                  {excludeTranscriptIds.length > 0 
                    ? "All available transcripts are already in this project, or try adjusting your search terms"
                    : "Try adjusting your search terms or filters"
                  }
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {results.map((transcript) => (
                  <div key={transcript.id} className="border border-surface-200 rounded-lg p-4 hover:bg-surface-50">
                    <div className="flex items-start space-x-4">
                      <button
                        onClick={() => toggleItemSelection(transcript.id)}
                        className="mt-1 text-surface-400 hover:text-surface-600"
                      >
                        {selectedItems.has(transcript.id) ? 
                          <CheckSquare size={20} className="text-primary-800" /> : 
                          <Square size={20} />
                        }
                      </button>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-lg font-medium text-surface-900 mb-1">
                          {transcript.title}
                        </h4>

                        {transcript.summary && (
                          <p className="text-surface-600 text-sm mb-2 line-clamp-2">
                            {transcript.summary}
                          </p>
                        )}

                        <div className="flex items-center space-x-4 text-sm text-surface-500">
                          <span>📅 {formatDate(transcript.created_at)}</span>
                          <span>⏱️ {formatDuration(transcript.duration)}</span>
                          {transcript.sentiment_overall && (
                            <span className={`px-2 py-1 rounded text-xs ${
                              transcript.sentiment_overall === 'positive' ? 'bg-green-100 text-green-800' :
                              transcript.sentiment_overall === 'negative' ? 'bg-red-100 text-red-800' :
                              'bg-surface-100 text-surface-800'
                            }`}>
                              {transcript.sentiment_overall}
                            </span>
                          )}
                          {transcript.starred && <span>⭐</span>}
                        </div>

                        {transcript.key_topics && transcript.key_topics.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {transcript.key_topics.slice(0, 3).map((topic, idx) => (
                              <span key={idx} className="text-xs bg-surface-100 text-surface-700 px-2 py-1 rounded">
                                {topic}
                              </span>
                            ))}
                            {transcript.key_topics.length > 3 && (
                              <span className="text-xs text-surface-500">+{transcript.key_topics.length - 3} more</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-surface-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-surface-600 hover:text-surface-800"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={selectedItems.size === 0}
            className="btn-primary px-6 py-2"
          >
            Add {selectedItems.size} Transcript{selectedItems.size !== 1 ? 's' : ''}
          </button>
        </div>
    </Modal>
  );
};