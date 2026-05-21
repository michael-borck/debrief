import React, { useState, useEffect } from 'react';
import { Archive, FolderOpen, Clock, RefreshCw, Undo2, Calendar, FileText } from 'lucide-react';
import { Transcript, Project } from '../types';
import { formatDate, formatDuration } from '../utils/helpers';

type ArchiveItem = {
  type: 'transcript' | 'project';
  id: string;
  title: string;
  archived_at: string;
  data: Transcript | Project;
};

export const ArchivePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'projects' | 'transcripts'>('projects');
  const [archivedItems, setArchivedItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const tabs = [
    { id: 'projects' as const, label: 'Archived Projects', icon: FolderOpen },
    { id: 'transcripts' as const, label: 'Archived Transcripts', icon: Clock },
  ];

  useEffect(() => { loadArchivedItems(); }, []);

  const loadArchivedItems = async () => {
    try {
      setLoading(true);
      const archivedTranscripts = await window.electronAPI.db.transcripts.listArchived();
      const archivedProjects = await window.electronAPI.db.projects.listArchived();
      const items: ArchiveItem[] = [];
      archivedTranscripts.forEach((transcript: any) => {
        items.push({
          type: 'transcript', id: transcript.id, title: transcript.title,
          archived_at: transcript.archived_at,
          data: { ...transcript, action_items: transcript.action_items ? JSON.parse(transcript.action_items) : [],
            key_topics: transcript.key_topics ? JSON.parse(transcript.key_topics) : [],
            tags: transcript.tags ? JSON.parse(transcript.tags) : [],
            speakers: transcript.speakers ? JSON.parse(transcript.speakers) : [],
            emotions: transcript.emotions ? JSON.parse(transcript.emotions) : {},
            starred: !!transcript.starred }
        });
      });
      archivedProjects.forEach((project: any) => {
        items.push({
          type: 'project', id: project.id, title: project.name,
          archived_at: project.archived_at,
          data: { ...project, themes: project.themes ? JSON.parse(project.themes) : [],
            key_insights: project.key_insights ? JSON.parse(project.key_insights) : [],
            tags: project.tags ? JSON.parse(project.tags) : [] }
        });
      });
      items.sort((a, b) => new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime());
      setArchivedItems(items);
    } catch (error) {
      console.error('Error loading archived items:', error);
    } finally {
      setLoading(false);
    }
  };

  const unarchiveItem = async (item: ArchiveItem) => {
    try {
      if (item.type === 'transcript') {
        await window.electronAPI.db.transcripts.unarchive(item.id);
      } else {
        await window.electronAPI.db.projects.unarchive(item.id);
      }
      await loadArchivedItems();
      alert(`${item.type === 'transcript' ? 'Transcript' : 'Project'} unarchived successfully`);
    } catch (error) {
      console.error('Error unarchiving item:', error);
      alert('Failed to unarchive item. Please try again.');
    }
  };

  const unarchiveSelected = async () => {
    if (selectedItems.size === 0) return;
    try {
      for (const itemId of selectedItems) {
        const item = archivedItems.find(i => i.id === itemId);
        if (item) await unarchiveItem(item);
      }
      setSelectedItems(new Set());
    } catch (error) { console.error('Error unarchiving selected items:', error); }
  };

  const toggleItemSelection = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) newSelected.delete(itemId);
    else newSelected.add(itemId);
    setSelectedItems(newSelected);
  };

  const selectAll = () => {
    const filteredItems = archivedItems.filter(item => item.type === activeTab.slice(0, -1) as 'transcript' | 'project');
    setSelectedItems(new Set(filteredItems.map(item => item.id)));
  };

  const clearSelection = () => setSelectedItems(new Set());
  const filteredItems = archivedItems.filter(item => item.type === activeTab.slice(0, -1) as 'transcript' | 'project');
  const selectedFilteredItems = filteredItems.filter(item => selectedItems.has(item.id));

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8 animate-fade-in">
        <div>
          <h1 className="page-title">Archive</h1>
          <p className="text-sm text-surface-500 mt-1">Long-term storage for completed projects and old transcripts</p>
        </div>
        <button onClick={loadArchivedItems}
          className="flex items-center gap-2 px-3 py-2 text-xs text-surface-500 hover:text-surface-700 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex gap-1 mb-6 border-b border-surface-200">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const count = archivedItems.filter(item => item.type === tab.id.slice(0, -1) as 'transcript' | 'project').length;
          return (
            <button key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedItems(new Set()); }}
              className={`pb-3 px-4 text-sm font-medium transition-colors relative flex items-center gap-2
                ${activeTab === tab.id ? 'text-primary-800' : 'text-surface-400 hover:text-surface-700'}`}>
              <Icon size={14} /> <span>{tab.label}</span>
              <span className={`badge text-[10px] py-0 ${activeTab === tab.id ? 'badge-info' : 'badge-neutral'}`}>{count}</span>
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-800 rounded-full" />}
            </button>
          );
        })}
      </div>

      {selectedFilteredItems.length > 0 && (
        <div className="bulk-action-bar mb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-primary-800">{selectedFilteredItems.length} selected</span>
              <button onClick={clearSelection} className="text-xs text-primary-800 hover:text-primary-900">Clear</button>
            </div>
            <button onClick={unarchiveSelected} className="btn-primary text-xs py-1.5">
              Unarchive Selected
            </button>
          </div>
        </div>
      )}

      <div className="card-interactive overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <div className="spinner"></div>
            <p className="mt-3 text-sm text-surface-400">Loading archived items...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
              <Archive size={28} className="text-surface-300" />
            </div>
            <h2 className="text-lg font-display text-surface-800 mb-2">No archived {activeTab}</h2>
            <p className="text-xs text-surface-400">Archive completed {activeTab} to keep your workspace organized</p>
          </div>
        ) : (
          <div>
            <div className="p-5 border-b border-surface-100">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="section-title">
                    {filteredItems.length} archived {activeTab === 'projects' ? 'project' : 'transcript'}{filteredItems.length !== 1 ? 's' : ''}
                  </h2>
                </div>
                {filteredItems.length > 0 && (
                  <button onClick={selectAll} className="text-xs text-primary-800 hover:text-primary-900">Select all</button>
                )}
              </div>
            </div>
            <div className="divide-y divide-surface-100">
              {filteredItems.map((item) => (
                <div key={`${item.type}-${item.id}`} className="p-5 hover:bg-surface-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selectedItems.has(item.id)} onChange={() => toggleItemSelection(item.id)}
                      className="mt-1 input-checkbox" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        {item.type === 'project' ? <FolderOpen size={15} className="text-primary-500" /> : <FileText size={15} className="text-surface-400" />}
                        <span className={`badge text-[10px] ${item.type === 'project' ? 'badge-info' : 'badge-neutral'}`}>{item.type}</span>
                      </div>
                      <h3 className="text-sm font-medium text-surface-800 mb-1">{item.title}</h3>
                      <div className="flex items-center gap-3 text-xs text-surface-400">
                        <span className="flex items-center gap-1"><Calendar size={11} />Archived: {formatDate(item.archived_at)}</span>
                        {item.type === 'transcript' && <span className="flex items-center gap-1"><Clock size={11} />{formatDuration((item.data as Transcript).duration)}</span>}
                      </div>
                      {item.type === 'transcript' && (item.data as Transcript).summary && (
                        <p className="text-xs text-surface-500 mt-1.5 line-clamp-2">{(item.data as Transcript).summary}</p>
                      )}
                      {item.type === 'project' && (item.data as Project).description && (
                        <p className="text-xs text-surface-500 mt-1.5 line-clamp-2">{(item.data as Project).description}</p>
                      )}
                    </div>
                    <button onClick={() => unarchiveItem(item)}
                      className="btn-outline-sm flex items-center gap-1">
                      <Undo2 size={12} /> Unarchive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
