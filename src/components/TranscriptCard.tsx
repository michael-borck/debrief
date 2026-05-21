import React, { useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Calendar, Clock, HardDrive, Eye, MessageCircle, Download, Archive, Trash2, Star, Loader } from 'lucide-react';
import { Transcript, Project } from '../types';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { useProjects } from '../contexts/ProjectContext';
import { formatDate, formatDuration, formatFileSize } from '../utils/helpers';
import { EnhancedDeleteModal, DeleteAction } from './EnhancedDeleteModal';
import { TranscriptChatModal } from './TranscriptChatModal';
import { ExportModal } from './ExportModal';

interface TranscriptCardProps {
  transcript: Transcript;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const TranscriptCard: React.FC<TranscriptCardProps> = ({
  transcript,
  selectable = false,
  selected = false,
  onToggleSelect,
}) => {
  const navigate = useNavigate();
  const { updateTranscript, deleteTranscript } = useContext(TranscriptContext);
  const { projects, removeTranscriptFromProject } = useProjects();
  const [transcriptProjects, setTranscriptProjects] = useState<Project[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    const loadTranscriptProjects = async () => {
      try {
        const projectRelations = await window.electronAPI.database.all(
          `SELECT project_id FROM project_transcripts WHERE transcript_id = ?`,
          [transcript.id]
        );

        const relatedProjects = projects.filter(project =>
          projectRelations.some(relation => relation.project_id === project.id)
        );

        setTranscriptProjects(relatedProjects);
      } catch (error) {
        console.error('Error loading transcript projects:', error);
      }
    };

    if (transcript.id && projects.length > 0) {
      loadTranscriptProjects();
    }
  }, [transcript.id, projects]);

  const handleToggleStar = async () => {
    await updateTranscript(transcript.id, { starred: !transcript.starred });
  };

  const handleView = () => {
    navigate(`/transcript/${transcript.id}`);
  };

  const handleChat = () => {
    setShowChatModal(true);
  };

  const handleArchive = async () => {
    try {
      await window.electronAPI.db.transcripts.archive(transcript.id);
      window.location.reload();
    } catch (error) {
      console.error('Error archiving transcript:', error);
      alert('Failed to archive transcript. Please try again.');
    }
  };

  const handleExport = () => {
    setShowExportModal(true);
  };

  const handleDelete = () => {
    setShowDeleteModal(true);
  };

  const handleEnhancedDelete = async (action: DeleteAction, projectIds?: string[]) => {
    try {
      switch (action) {
        case 'remove-from-selected':
          if (projectIds) {
            for (const projectId of projectIds) {
              await removeTranscriptFromProject(projectId, transcript.id);
            }
          }
          break;
        case 'remove-from-all':
          for (const project of transcriptProjects) {
            await removeTranscriptFromProject(project.id, transcript.id);
          }
          break;
        case 'move-to-trash':
          await moveTranscriptToTrash(transcript.id);
          break;
        case 'delete-permanently':
          await deleteTranscript(transcript.id);
          break;
      }
      setShowDeleteModal(false);
    } catch (error) {
      console.error('Error performing delete action:', error);
      alert('Failed to perform the action. Please try again.');
    }
  };

  const moveTranscriptToTrash = async (transcriptId: string) => {
    try {
      await window.electronAPI.db.transcripts.softDelete(transcriptId);
      window.location.reload();
    } catch (error) {
      console.error('Error moving transcript to trash:', error);
      throw error;
    }
  };

  const getStatusBadge = () => {
    switch (transcript.status) {
      case 'processing':
        return <span className="badge badge-info"><Loader size={11} className="animate-spin" />Processing</span>;
      case 'error':
        return <span className="badge badge-error">Error</span>;
      case 'completed':
        return <span className="badge badge-success">Completed</span>;
      default:
        return <span className="badge badge-neutral">{transcript.status}</span>;
    }
  };

  return (
    <div className={`card-interactive p-5 ${selected ? 'ring-2 ring-accent-400 border-accent-300' : ''}`}>
      {selectable && (
        <div className="flex items-center mb-3 -mt-1">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-surface-500 hover:text-surface-700">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.(transcript.id)}
              className="input-checkbox"
            />
            <span>{selected ? 'Selected' : 'Select'}</span>
          </label>
        </div>
      )}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={16} className="text-primary-500 flex-shrink-0" />
            <h3 className="text-base font-display text-surface-900 truncate">
              {transcript.title}
            </h3>
            <button
              onClick={handleToggleStar}
              className={`flex-shrink-0 transition-colors ${transcript.starred ? 'text-accent-500' : 'text-surface-300 hover:text-accent-400'}`}
            >
              <Star size={15} fill={transcript.starred ? 'currentColor' : 'none'} />
            </button>
            {getStatusBadge()}
          </div>

          <div className="flex items-center gap-4 text-xs text-surface-500 mb-2">
            <span className="flex items-center gap-1"><Calendar size={12} />{formatDate(transcript.created_at)}</span>
            {transcript.duration > 0 && <span className="flex items-center gap-1"><Clock size={12} />{formatDuration(transcript.duration)}</span>}
            <span className="flex items-center gap-1"><HardDrive size={12} />{formatFileSize(transcript.file_size)}</span>
          </div>

          {transcript.summary && (
            <p className="text-sm text-surface-600 mb-2 line-clamp-2">
              {transcript.summary}
            </p>
          )}

          {transcript.key_topics && transcript.key_topics.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-surface-500">Topics:</span>
              <div className="flex flex-wrap gap-1.5">
                {transcript.key_topics.slice(0, 3).map((topic, idx) => (
                  <span key={idx} className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-lg">
                    {topic}
                  </span>
                ))}
                {transcript.key_topics.length > 3 && (
                  <span className="text-xs text-surface-400">+{transcript.key_topics.length - 3} more</span>
                )}
              </div>
            </div>
          )}

          {transcriptProjects.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-surface-500">Projects:</span>
              <div className="flex flex-wrap gap-1.5">
                {transcriptProjects.slice(0, 2).map((project) => (
                  <button
                    key={project.id}
                    onClick={() => navigate(`/project/${project.id}`)}
                    className="text-xs bg-accent-50 text-accent-700 px-2 py-0.5 rounded-lg hover:bg-accent-100 transition-colors"
                  >
                    {project.name}
                  </button>
                ))}
                {transcriptProjects.length > 2 && (
                  <span className="text-xs text-surface-400">+{transcriptProjects.length - 2} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 mt-4 pt-3 border-t border-surface-100">
        <button
          onClick={handleView}
          className="btn-ghost flex items-center gap-1.5"
        >
          <Eye size={13} />
          View
        </button>

        <button
          onClick={handleChat}
          disabled={transcript.is_archived}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            transcript.is_archived
              ? 'text-surface-300 cursor-not-allowed'
              : 'text-primary-800 hover:bg-primary-100'
          }`}
          title={transcript.is_archived ? 'Chat disabled for archived transcripts' : 'Chat with this transcript'}
        >
          <MessageCircle size={13} />
          Chat
        </button>

        <button
          onClick={handleExport}
          className="btn-ghost flex items-center gap-1.5"
        >
          <Download size={13} />
          Export
        </button>

        <button
          onClick={handleArchive}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-50 rounded-lg transition-colors"
        >
          <Archive size={13} />
          Archive
        </button>

        <button
          onClick={handleDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-auto"
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      {/* Enhanced Delete Modal */}
      <EnhancedDeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        item={transcript}
        itemType="transcript"
        onDelete={handleEnhancedDelete}
      />

      {/* Chat Modal */}
      <TranscriptChatModal
        transcript={transcript}
        isOpen={showChatModal}
        onClose={() => setShowChatModal(false)}
      />

      <ExportModal
        transcript={transcript}
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
};
