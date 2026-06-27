import React, { useState, useEffect } from 'react';
import { Trash, RefreshCw, AlertTriangle, Calendar, FolderOpen, FileText, Clock } from 'lucide-react';
import { Transcript, Project } from '../types';
import { formatDate, formatDuration } from '../utils/helpers';
import { hydrateTranscriptRow, hydrateProjectRow } from '../utils/hydration';

type TrashItem = {
  type: 'transcript' | 'project';
  id: string;
  title: string;
  deleted_at: string;
  daysRemaining: number;
  data: Transcript | Project;
};

export const TrashPage: React.FC = () => {
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  useEffect(() => { loadTrashItems(); }, []);

  const loadTrashItems = async () => {
    try {
      setLoading(true);
      const deletedTranscripts = await window.electronAPI.db.transcripts.listTrashed();
      const deletedProjects = await window.electronAPI.db.projects.listTrashed();
      const now = new Date();
      const items: TrashItem[] = [];
      deletedTranscripts.forEach((transcript) => {
        if (!transcript.deleted_at) return;
        const daysElapsed = Math.floor((now.getTime() - new Date(transcript.deleted_at).getTime()) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, 30 - daysElapsed);
        if (daysRemaining > 0) {
          items.push({ type: 'transcript', id: transcript.id, title: transcript.title,
            deleted_at: transcript.deleted_at, daysRemaining,
            data: hydrateTranscriptRow(transcript) });
        }
      });
      deletedProjects.forEach((project) => {
        if (!project.deleted_at) return;
        const daysElapsed = Math.floor((now.getTime() - new Date(project.deleted_at).getTime()) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, 30 - daysElapsed);
        if (daysRemaining > 0) {
          items.push({ type: 'project', id: project.id, title: project.name,
            deleted_at: project.deleted_at, daysRemaining,
            data: hydrateProjectRow(project) });
        }
      });
      items.sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());
      setTrashItems(items);
    } catch (error) { console.error('Error loading trash items:', error); }
    finally { setLoading(false); }
  };

  const restoreItem = async (item: TrashItem) => {
    try {
      if (item.type === 'transcript') {
        await window.electronAPI.db.transcripts.restore(item.id);
      } else {
        await window.electronAPI.db.projects.restore(item.id);
        // Cascade-restore the project's still-trashed transcripts.
        const related =
          await window.electronAPI.db.projectTranscripts.listTrashedTranscriptIdsForProject(item.id);
        for (const t of related) {
          await window.electronAPI.db.transcripts.restore(t.id);
        }
        if (related.length > 0) alert(`Restored project and ${related.length} related transcript${related.length !== 1 ? 's' : ''}`);
      }
      await loadTrashItems();
      alert(`${item.type === 'transcript' ? 'Transcript' : 'Project'} restored successfully`);
    } catch (error) { console.error('Error restoring item:', error); alert('Failed to restore item.'); }
  };

  const restoreSelected = async () => {
    if (selectedItems.size === 0) return;
    for (const itemId of selectedItems) {
      const item = trashItems.find(i => i.id === itemId);
      if (item) await restoreItem(item);
    }
    setSelectedItems(new Set());
  };

  const emptyTrash = async () => {
    if (trashItems.length === 0) return;
    if (!window.confirm(`Permanently delete all ${trashItems.length} items?\n\nThis cannot be undone.`)) return;
    try {
      for (const item of trashItems) {
        if (item.type === 'transcript') {
          await window.electronAPI.db.transcripts.remove(item.id);
        } else {
          await window.electronAPI.db.projects.remove(item.id);
        }
      }
      await loadTrashItems();
    } catch (error) { console.error('Error emptying trash:', error); alert('Failed to empty trash.'); }
  };

  const toggleItemSelection = (itemId: string) => {
    const n = new Set(selectedItems);
    if (n.has(itemId)) n.delete(itemId); else n.add(itemId);
    setSelectedItems(n);
  };
  const selectAll = () => setSelectedItems(new Set(trashItems.map(i => i.id)));
  const clearSelection = () => setSelectedItems(new Set());

  const getDaysColor = (days: number) => {
    if (days <= 3) return 'badge-error';
    if (days <= 7) return 'badge-warning';
    return 'badge-success';
  };

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8 animate-fade-in">
        <div>
          <h1 className="page-title">Trash</h1>
          <p className="text-sm text-surface-500 mt-1">Recover deleted items within 30 days</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadTrashItems}
            className="flex items-center gap-2 px-3 py-2 text-xs text-surface-500 hover:text-surface-700 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors">
            <RefreshCw size={14} /> Refresh
          </button>
          {trashItems.length > 0 && (
            <button onClick={emptyTrash}
              className="btn-danger text-xs flex items-center gap-2">
              <Trash size={14} /> Empty Trash
            </button>
          )}
        </div>
      </div>

      {selectedItems.size > 0 && (
        <div className="bulk-action-bar mb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-primary-800">{selectedItems.size} selected</span>
              <button onClick={clearSelection} className="text-xs text-primary-800 hover:text-primary-900">Clear</button>
            </div>
            <button onClick={restoreSelected} className="btn-primary text-xs py-1.5">
              Restore Selected
            </button>
          </div>
        </div>
      )}

      <div className="card-interactive overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <div className="spinner"></div>
            <p className="mt-3 text-sm text-surface-400">Loading trash...</p>
          </div>
        ) : trashItems.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-100 flex items-center justify-center">
              <Trash size={28} className="text-surface-300" />
            </div>
            <h2 className="text-lg font-display text-surface-800 mb-2">Trash is empty</h2>
            <p className="text-xs text-surface-400">Deleted items appear here and can be restored within 30 days</p>
          </div>
        ) : (
          <div>
            <div className="p-5 border-b border-surface-100">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="section-title">{trashItems.length} deleted item{trashItems.length !== 1 ? 's' : ''}</h2>
                  <p className="text-xs text-surface-400 mt-0.5">Items are automatically deleted after 30 days</p>
                </div>
                <button onClick={selectAll} className="text-xs text-primary-800 hover:text-primary-900">Select all</button>
              </div>
            </div>
            <div className="divide-y divide-surface-100">
              {trashItems.map((item) => (
                <div key={`${item.type}-${item.id}`} className="p-5 hover:bg-surface-50 transition-colors">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selectedItems.has(item.id)} onChange={() => toggleItemSelection(item.id)}
                      className="mt-1 input-checkbox" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        {item.type === 'project' ? <FolderOpen size={15} className="text-primary-500" /> : <FileText size={15} className="text-surface-400" />}
                        <span className={`badge text-[10px] ${item.type === 'project' ? 'badge-info' : 'badge-neutral'}`}>{item.type}</span>
                        <span className={`badge text-[10px] ${getDaysColor(item.daysRemaining)}`}>
                          {item.daysRemaining}d remaining
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-surface-800 mb-1">{item.title}</h3>
                      <div className="flex items-center gap-3 text-xs text-surface-400">
                        <span className="flex items-center gap-1"><Calendar size={11} />Deleted: {formatDate(item.deleted_at)}</span>
                        {item.type === 'transcript' && <span className="flex items-center gap-1"><Clock size={11} />{formatDuration((item.data as Transcript).duration)}</span>}
                      </div>
                      {item.daysRemaining <= 7 && (
                        <div className="mt-1.5 flex items-center gap-1 text-warning">
                          <AlertTriangle size={12} />
                          <span className="text-[10px]">Permanently deleted in {item.daysRemaining} day{item.daysRemaining !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>
                    <button onClick={() => restoreItem(item)}
                      className="btn-outline-sm">
                      Restore
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
