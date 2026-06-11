import React, { useState, useContext, useEffect } from 'react';
import { Filter, CheckSquare, Square, Archive, Trash2 } from 'lucide-react';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { useProjects } from '../contexts/ProjectContext';
import { useToast } from '../contexts/ToastContext';
import { TranscriptCard } from '../components/TranscriptCard';
import { SearchBar } from '../components/SearchBar';
import { Transcript } from '../types';

export const LibraryPage: React.FC = () => {
  const { transcripts, searchTranscripts, loadTranscripts } = useContext(TranscriptContext);
  const { projects, addTranscriptToProject } = useProjects();
  const { showToast } = useToast();
  const [filteredTranscripts, setFilteredTranscripts] = useState<Transcript[]>(transcripts);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [sortBy] = useState<'date' | 'title' | 'duration'>('date');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadTranscripts();
  }, []);

  useEffect(() => {
    filterAndSortTranscripts();
  }, [transcripts, searchQuery, filterTag, sortBy]);

  const filterAndSortTranscripts = async () => {
    let filtered = transcripts;

    if (searchQuery) {
      filtered = await searchTranscripts(searchQuery);
    }

    if (filterTag !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      filtered = filtered.filter(t => {
        const date = new Date(t.created_at);
        switch (filterTag) {
          case 'today':
            return date >= today;
          case 'week':
            return date >= thisWeek;
          case 'month':
            return date >= thisMonth;
          case 'favorites':
            return t.starred;
          default:
            return true;
        }
      });
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'duration':
          return b.duration - a.duration;
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    setFilteredTranscripts(filtered);
  };

  // ---------- Selection helpers ----------

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredTranscripts.map((t) => t.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const allSelected =
    filteredTranscripts.length > 0 &&
    filteredTranscripts.every((t) => selectedIds.has(t.id));

  // ---------- Bulk operations ----------

  const handleBulkAssignToProject = async (projectId: string) => {
    if (!projectId || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let added = 0;
    for (const id of ids) {
      try {
        await addTranscriptToProject(projectId, id);
        added++;
      } catch (err) {
        console.error('Bulk assign failed for', id, err);
      }
    }
    const project = projects.find((p) => p.id === projectId);
    showToast({
      kind: added === ids.length ? 'success' : 'error',
      title: `Assigned ${added} of ${ids.length} transcripts`,
      body: project ? `to "${project.name}"` : undefined,
    });
    clearSelection();
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (!window.confirm(`Archive ${ids.length} transcript${ids.length !== 1 ? 's' : ''}?`)) return;

    let archived = 0;
    for (const id of ids) {
      try {
        await window.electronAPI.db.transcripts.archive(id);
        archived++;
      } catch (err) {
        console.error('Bulk archive failed for', id, err);
      }
    }
    showToast({
      kind: archived === ids.length ? 'success' : 'error',
      title: `Archived ${archived} of ${ids.length} transcripts`,
    });
    clearSelection();
    await loadTranscripts();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (
      !window.confirm(
        `Move ${ids.length} transcript${ids.length !== 1 ? 's' : ''} to trash? You can restore them within 30 days.`
      )
    )
      return;

    let trashed = 0;
    for (const id of ids) {
      try {
        await window.electronAPI.db.transcripts.softDelete(id);
        trashed++;
      } catch (err) {
        console.error('Bulk delete failed for', id, err);
      }
    }
    showToast({
      kind: trashed === ids.length ? 'success' : 'error',
      title: `Moved ${trashed} of ${ids.length} transcripts to trash`,
    });
    clearSelection();
    await loadTranscripts();
  };

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header with search */}
      <div className="flex items-center justify-between mb-6 animate-fade-in">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search transcripts..."
        />

        <div className="flex items-center gap-2">
          <button
            onClick={allSelected ? clearSelection : selectAllVisible}
            disabled={filteredTranscripts.length === 0}
            className="flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-800 px-3 py-2 rounded-lg hover:bg-surface-100 transition-colors disabled:opacity-50"
          >
            {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <button className="text-surface-400 hover:text-surface-700 p-2 rounded-lg hover:bg-surface-100 transition-colors">
            <Filter size={18} />
          </button>
        </div>
      </div>

      {/* Bulk action bar — sticky-ish, slides in when items are selected */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar mb-5 sticky top-2 z-30">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-primary-800">
                {selectedIds.size} selected
              </span>
              <button
                onClick={clearSelection}
                className="text-xs text-primary-600 hover:text-primary-800 transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              {projects.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleBulkAssignToProject(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="text-xs px-3 py-1.5 border border-primary-200 rounded-lg bg-white hover:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  <option value="">+ Add to project...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={handleBulkArchive}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-700 hover:bg-accent-100 border border-accent-200 rounded-lg transition-colors"
              >
                <Archive size={12} />
                Archive
              </button>
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-colors"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-surface-200">
        {[
          { id: 'all', label: 'All' },
          { id: 'today', label: 'Today' },
          { id: 'week', label: 'This Week' },
          { id: 'month', label: 'This Month' },
          { id: 'favorites', label: 'Favorites' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilterTag(tab.id)}
            className={`
              pb-3 px-4 text-sm font-medium transition-colors relative
              ${filterTag === tab.id
                ? 'text-primary-800'
                : 'text-surface-400 hover:text-surface-700'
              }
            `}
          >
            {tab.label}
            {filterTag === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-800 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Transcripts grid */}
      {filteredTranscripts.length === 0 ? (
        <div className="text-center py-16 animate-fade-in">
          <p className="text-surface-400 text-sm">No transcripts found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTranscripts.map((transcript, i) => (
            <div key={transcript.id} className="animate-slide-up" style={{ animationDelay: `${i * 0.03}s`, opacity: 0 }}>
              <TranscriptCard
                transcript={transcript}
                selectable
                selected={selectedIds.has(transcript.id)}
                onToggleSelect={toggleSelected}
              />
            </div>
          ))}
        </div>
      )}

      {/* Footer count — gives you a sense of how many results you're scrolling through */}
      {filteredTranscripts.length > 0 && (
        <div className="mt-8 text-center text-xs text-surface-400">
          {filteredTranscripts.length} transcript{filteredTranscripts.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};
