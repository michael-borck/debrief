import React, { useState, useEffect, useContext } from 'react';
import { Search, Filter, Calendar, Clock, Palette, FolderOpen, CheckSquare, Square, FileText } from 'lucide-react';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { useProjects } from '../contexts/ProjectContext';
import { Transcript, Project } from '../types';
import { formatDate, formatDuration } from '../utils/helpers';
import { useNavigate } from 'react-router-dom';

type SearchResult = {
  type: 'transcript' | 'project';
  id: string;
  title: string;
  description?: string;
  created_at: string;
  data: Transcript | Project;
};

export const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const { transcripts, searchTranscripts } = useContext(TranscriptContext);
  const { projects, createProject, addTranscriptToProject } = useProjects();

  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState({
    dateRange: { start: '', end: '' },
    duration: { min: '', max: '' },
    sentiment: '',
    projectIds: [] as string[],
    speakers: [] as string[],
    hasKeywords: [] as string[]
  });

  useEffect(() => {
    performSearch();
  }, [searchQuery, filters, transcripts, projects]);

  const performSearch = async () => {
    setLoading(true);
    try {
      let searchResults: SearchResult[] = [];

      if (searchQuery) {
        const foundTranscripts = await searchTranscripts(searchQuery);
        searchResults.push(...foundTranscripts.map(t => ({
          type: 'transcript' as const, id: t.id, title: t.title,
          description: t.summary, created_at: t.created_at, data: t
        })));
      } else {
        searchResults.push(...transcripts.map(t => ({
          type: 'transcript' as const, id: t.id, title: t.title,
          description: t.summary, created_at: t.created_at, data: t
        })));
      }

      const projectResults = projects.filter(p => {
        if (searchQuery) {
          return p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                 (p.description?.toLowerCase().includes(searchQuery.toLowerCase()));
        }
        return true;
      });

      searchResults.push(...projectResults.map(p => ({
        type: 'project' as const, id: p.id, title: p.name,
        description: p.description, created_at: p.created_at, data: p
      })));

      searchResults = applyFilters(searchResults);

      searchResults.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'project' ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setResults(searchResults);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (results: SearchResult[]): SearchResult[] => {
    return results.filter(result => {
      if (filters.dateRange.start) {
        if (new Date(result.created_at) < new Date(filters.dateRange.start)) return false;
      }
      if (filters.dateRange.end) {
        if (new Date(result.created_at) > new Date(filters.dateRange.end)) return false;
      }
      if (result.type === 'transcript') {
        const transcript = result.data as Transcript;
        if (filters.duration.min && transcript.duration < parseInt(filters.duration.min, 10)) return false;
        if (filters.duration.max && transcript.duration > parseInt(filters.duration.max, 10)) return false;
        if (filters.sentiment && transcript.sentiment_overall !== filters.sentiment) return false;
        if (filters.hasKeywords.length > 0) {
          const hasKeyword = filters.hasKeywords.some(keyword =>
            transcript.key_topics?.some(topic =>
              topic.toLowerCase().includes(keyword.toLowerCase())
            )
          );
          if (!hasKeyword) return false;
        }
      }
      return true;
    });
  };

  const toggleItemSelection = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedItems(newSelected);
  };

  const selectAll = () => setSelectedItems(new Set(results.map(r => r.id)));
  const clearSelection = () => setSelectedItems(new Set());

  const addSelectedToProject = async (projectId: string) => {
    const transcriptIds = Array.from(selectedItems).filter(id => {
      const result = results.find(r => r.id === id);
      return result?.type === 'transcript';
    });
    if (transcriptIds.length === 0) return;
    try {
      for (const transcriptId of transcriptIds) {
        await addTranscriptToProject(projectId, transcriptId);
      }
      setSelectedItems(new Set());
      alert(`Successfully added ${transcriptIds.length} transcript${transcriptIds.length !== 1 ? 's' : ''} to project`);
    } catch (error) {
      console.error('Error adding transcripts to project:', error);
      alert('Failed to add transcripts to project. Please try again.');
    }
  };

  const createProjectFromSelected = async () => {
    const transcriptIds = Array.from(selectedItems).filter(id => {
      const result = results.find(r => r.id === id);
      return result?.type === 'transcript';
    });
    if (transcriptIds.length === 0) return;
    const projectName = prompt(`Create a new project with ${transcriptIds.length} transcript${transcriptIds.length !== 1 ? 's' : ''}.\n\nEnter project name:`);
    if (!projectName) return;
    try {
      const newProject = await createProject(projectName.trim());
      for (const transcriptId of transcriptIds) {
        await addTranscriptToProject(newProject.id, transcriptId);
      }
      setSelectedItems(new Set());
      navigate(`/project/${newProject.id}`);
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Failed to create project. Please try again.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-fade-in">
        <div>
          <h1 className="page-title">Search & Filter</h1>
          <p className="text-sm text-surface-500 mt-1">Find transcripts and projects across your entire library</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="card-interactive p-5 mb-5 animate-slide-up" style={{ animationDelay: '0.05s', opacity: 0 }}>
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-surface-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search transcripts and projects..."
              className="input pl-10 py-2.5"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg transition-colors text-sm ${
              showFilters
                ? 'border-primary-400 bg-primary-100 text-primary-700'
                : 'border-surface-200 hover:bg-surface-50 text-surface-600'
            }`}
          >
            <Filter size={16} />
            <span>Filters</span>
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mt-5 pt-5 border-t border-surface-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div>
                <label className="label mb-2">
                  <Calendar size={12} className="inline mr-1" /> Date Range
                </label>
                <div className="space-y-2">
                  <input type="date" value={filters.dateRange.start}
                    onChange={(e) => setFilters(prev => ({ ...prev, dateRange: { ...prev.dateRange, start: e.target.value } }))}
                    className="input" />
                  <input type="date" value={filters.dateRange.end}
                    onChange={(e) => setFilters(prev => ({ ...prev, dateRange: { ...prev.dateRange, end: e.target.value } }))}
                    className="input" />
                </div>
              </div>
              <div>
                <label className="label mb-2">
                  <Clock size={12} className="inline mr-1" /> Duration (seconds)
                </label>
                <div className="space-y-2">
                  <input type="number" placeholder="Min" value={filters.duration.min}
                    onChange={(e) => setFilters(prev => ({ ...prev, duration: { ...prev.duration, min: e.target.value } }))}
                    className="input" />
                  <input type="number" placeholder="Max" value={filters.duration.max}
                    onChange={(e) => setFilters(prev => ({ ...prev, duration: { ...prev.duration, max: e.target.value } }))}
                    className="input" />
                </div>
              </div>
              <div>
                <label className="label mb-2">
                  <Palette size={12} className="inline mr-1" /> Sentiment
                </label>
                <select value={filters.sentiment}
                  onChange={(e) => setFilters(prev => ({ ...prev, sentiment: e.target.value }))}
                  className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm bg-white">
                  <option value="">All sentiments</option>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setFilters({ dateRange: { start: '', end: '' }, duration: { min: '', max: '' }, sentiment: '', projectIds: [], speakers: [], hasKeywords: [] })}
                className="text-xs text-surface-500 hover:text-surface-700 transition-colors">
                Clear all filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className="bulk-action-bar mb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-primary-800">
                {selectedItems.size} item{selectedItems.size !== 1 ? 's' : ''} selected
              </span>
              <button onClick={clearSelection} className="text-xs text-primary-800 hover:text-primary-900">
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select className="px-3 py-1.5 border border-primary-200 rounded-lg text-xs bg-white"
                onChange={(e) => { if (e.target.value) { addSelectedToProject(e.target.value); e.target.value = ''; } }}>
                <option value="">Add to project...</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <button onClick={createProjectFromSelected}
                className="btn-primary text-xs py-1.5 px-3">
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="card-interactive overflow-hidden animate-slide-up" style={{ animationDelay: '0.1s', opacity: 0 }}>
        <div className="p-5 border-b border-surface-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="section-title">
                {loading ? 'Searching...' : `${results.length} results`}
              </h2>
              {!loading && results.length > 0 && (
                <p className="text-xs text-surface-500 mt-0.5">
                  {results.filter(r => r.type === 'project').length} projects, {results.filter(r => r.type === 'transcript').length} transcripts
                </p>
              )}
            </div>
            {results.length > 0 && (
              <button onClick={selectAll} className="text-xs text-primary-800 hover:text-primary-900 transition-colors">
                Select all
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-surface-100">
          {loading ? (
            <div className="p-10 text-center">
              <div className="spinner"></div>
              <p className="mt-3 text-sm text-surface-400">Searching...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="p-12 text-center">
              <Search className="mx-auto h-10 w-10 text-surface-200" />
              <h3 className="mt-4 text-base font-display text-surface-700">No results found</h3>
              <p className="mt-1 text-xs text-surface-400">Try adjusting your search terms or filters</p>
            </div>
          ) : (
            results.map((result) => (
              <div key={result.id} className="p-5 hover:bg-surface-50 transition-colors">
                <div className="flex items-start gap-3">
                  <button onClick={() => toggleItemSelection(result.id)} className="mt-0.5 text-surface-300 hover:text-surface-500 transition-colors">
                    {selectedItems.has(result.id) ?
                      <CheckSquare size={18} className="text-primary-800" /> :
                      <Square size={18} />
                    }
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {result.type === 'project' ? (
                        <FolderOpen size={15} className="text-primary-500" />
                      ) : (
                        <FileText size={15} className="text-surface-400" />
                      )}
                      <span className={`badge text-[10px] ${
                        result.type === 'project' ? 'badge-info' : 'badge-neutral'
                      }`}>
                        {result.type}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-surface-800 mb-1">{result.title}</h3>
                    {result.description && (
                      <p className="text-surface-500 text-xs mb-1.5 line-clamp-2">{result.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-surface-400">
                      <span className="flex items-center gap-1"><Calendar size={11} />{formatDate(result.created_at)}</span>
                      {result.type === 'transcript' && (
                        <>
                          <span className="flex items-center gap-1"><Clock size={11} />{formatDuration((result.data as Transcript).duration)}</span>
                          {(result.data as Transcript).sentiment_overall && (
                            <span className={`badge text-[10px] py-0 ${
                              (result.data as Transcript).sentiment_overall === 'positive' ? 'badge-success' :
                              (result.data as Transcript).sentiment_overall === 'negative' ? 'badge-error' : 'badge-neutral'
                            }`}>
                              {(result.data as Transcript).sentiment_overall}
                            </span>
                          )}
                        </>
                      )}
                      {result.type === 'project' && (
                        <span>{(result.data as Project).transcript_count || 0} transcripts</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => navigate(result.type === 'project' ? `/project/${result.id}` : `/transcript/${result.id}`)}
                    className="btn-outline-sm">
                    View
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
