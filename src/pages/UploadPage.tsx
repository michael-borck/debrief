import React, { useState, useContext } from 'react';
import { Upload, FolderPlus, FileAudio, Play, X } from 'lucide-react';
import { ProcessingQueue } from '../components/ProcessingQueue';
import { ServiceContext } from '../contexts/ServiceContext';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { useProjects } from '../contexts/ProjectContext';
import { useToast } from '../contexts/ToastContext';
import { generateId } from '../utils/helpers';
import { fileProcessor } from '../services/fileProcessor';
import { runSerial } from '../services/processingScheduler';
import { useSidecarStatus } from '../hooks/useSidecarStatus';

export const UploadPage: React.FC = () => {
  // Poll faster while a user is staring at this page so the button enables
  // promptly the moment sidecar setup finishes.
  const sidecarStatus = useSidecarStatus(1500);
  const sidecarReady = sidecarStatus?.state === 'ready';
  const { processingQueue, addToProcessingQueue, updateProcessingItem } = useContext(ServiceContext);
  const { loadTranscripts } = useContext(TranscriptContext);
  const { projects, createProject, addTranscriptToProject } = useProjects();
  const { showToast } = useToast();
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleBrowseClick = async () => {
    const filePaths = await window.electronAPI.dialog.openFile();
    if (filePaths.length > 0) {
      console.log('Selected files:', filePaths);
      setSelectedFiles(filePaths);
    }
  };

  // Drag-and-drop handlers. In Electron, dropped File objects expose a
  // non-standard `path` property that gives the absolute filesystem path,
  // which is what the rest of the upload pipeline expects.
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Electron 32+ removed the non-standard File.path property. Use the
    // webUtils.getPathForFile bridge exposed via preload to recover the
    // absolute path of each dropped file.
    const files = Array.from(e.dataTransfer.files);
    const paths = files
      .map((f) => {
        try {
          return window.electronAPI.fs.getPathForFile(f);
        } catch (err) {
          console.error('Failed to resolve dropped file path:', err);
          return '';
        }
      })
      .filter((p): p is string => !!p && p.length > 0);

    if (paths.length === 0) {
      alert('Could not read the dropped file paths. Try using the browse button instead.');
      return;
    }

    // Merge with existing selection so you can drop multiple batches
    setSelectedFiles((prev) => {
      const unique = new Set([...prev, ...paths]);
      return Array.from(unique);
    });
  };

  const checkForDuplicates = async (fileName: string): Promise<boolean> => {
    try {
      const existing = await window.electronAPI.database.all(
        `SELECT id, title, created_at FROM transcripts
         WHERE filename = ? OR title = ?`,
        [fileName, fileName]
      );

      if (existing.length > 0) {
        const existingFile = existing[0];
        const existingDate = new Date(existingFile.created_at).toLocaleDateString();

        const shouldContinue = window.confirm(
          `A file with this name already exists:\n\n` +
          `"${existingFile.title}"\n` +
          `Uploaded: ${existingDate}\n\n` +
          `Do you want to upload this file anyway?`
        );

        return !shouldContinue;
      }

      return false;
    } catch (error) {
      console.error('Error checking for duplicates:', error);
      return false;
    }
  };

  const startProcessing = async (
    processingItemId: string,
    transcriptId: string,
    filePath: string,
    signal: AbortSignal
  ) => {
    const fileName = filePath.split('/').pop() || filePath;
    try {
      // Wait our turn. While we wait, the queue UI shows status='queued'.
      // If the user cancels (signal.aborted) before our turn, skip entirely
      // and delete the stub transcript record so the library stays clean.
      await runSerial(async () => {
        if (signal.aborted) {
          updateProcessingItem(processingItemId, { status: 'cancelled' });
          try {
            await window.electronAPI.database.run(
              'DELETE FROM transcripts WHERE id = ?',
              [transcriptId]
            );
          } catch (e) {
            console.warn('Failed to delete cancelled transcript record:', e);
          }
          await loadTranscripts();
          return;
        }

      updateProcessingItem(processingItemId, { status: 'transcribing', stage: 'analyzing_media' });

      await fileProcessor.processFile(filePath, transcriptId, {
        signal,
        onProgress: (stage, percent) => {
          // Map stage to coarse status for back-compat with the existing UI.
          // ProcessingQueue can render the finer-grained `stage` directly.
          const coarseStatus =
            stage === 'analyzing_media' ||
            stage === 'extracting' ||
            stage === 'loading_model' ||
            stage === 'transcribing' ||
            stage === 'diarising'
              ? 'transcribing'
              : 'analyzing';
          updateProcessingItem(processingItemId, {
            progress: percent,
            status: coarseStatus,
            stage,
          });
        },
        onError: async (error: Error) => {
          console.error('Processing error:', error);
          updateProcessingItem(processingItemId, {
            status: 'error',
            error_message: error.message
          });
          showToast({
            kind: 'error',
            title: 'Processing failed',
            body: `${fileName}: ${error.message}`,
            duration: 0,
          });
          await loadTranscripts();
        },
        onCancelled: async () => {
          updateProcessingItem(processingItemId, {
            status: 'cancelled',
            error_message: 'Cancelled by user',
          });
          showToast({
            kind: 'info',
            title: 'Cancelled',
            body: fileName,
            duration: 4000,
          });
          await loadTranscripts();
        },
        onComplete: async () => {
          console.log('Processing completed for:', transcriptId);
          updateProcessingItem(processingItemId, {
            status: 'completed',
            progress: 100
          });

          if (selectedProject) {
            try {
              await addTranscriptToProject(selectedProject, transcriptId);
              console.log(`Added transcript ${transcriptId} to project ${selectedProject}`);
            } catch (error) {
              console.error('Error adding transcript to project:', error);
            }
          }

          showToast({
            kind: 'success',
            title: 'Transcript ready',
            body: fileName,
            duration: 6000,
          });

          await loadTranscripts();
        }
      });
      }); // closes runSerial
    } catch (error) {
      console.error('Error starting processing:', error);
      updateProcessingItem(processingItemId, {
        status: 'error',
        error_message: (error as Error).message
      });
      showToast({
        kind: 'error',
        title: 'Processing failed',
        body: `${fileName}: ${(error as Error).message}`,
        duration: 0,
      });
      await loadTranscripts();
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    for (const filePath of selectedFiles) {
      const fileName = filePath.split('/').pop() || filePath;

      if (!fileName.match(/\.(mp3|wav|mp4|avi|mov|m4a|webm|ogg)$/i)) {
        alert(`File type not supported: ${fileName}`);
        continue;
      }

      const shouldSkip = await checkForDuplicates(fileName);
      if (shouldSkip) {
        console.log(`Skipping duplicate file: ${fileName}`);
        continue;
      }

      const transcriptId = generateId();
      const timestamp = new Date().toISOString();

      try {
        const fileStats = await window.electronAPI.fs.getFileStats(filePath);

        console.log(`Creating transcript record for: ${fileName}`);

        await window.electronAPI.database.run(
          `INSERT INTO transcripts (id, title, filename, file_path, file_size, created_at, updated_at, status, starred)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [transcriptId, fileName, fileName, filePath, fileStats.size, timestamp, timestamp, 'processing', 0]
        );

        const processingItemId = generateId();
        const controller = new AbortController();
        addToProcessingQueue({
          id: processingItemId,
          transcript_id: transcriptId,
          file_path: filePath,
          status: 'queued',
          stage: 'queued',
          progress: 0,
          created_at: timestamp
        }, controller);

        // Fire-and-forget — startProcessing handles its own errors via
        // onError/onCancelled callbacks. NOT awaiting lets the for-loop
        // enqueue every file rapidly so they all appear as 'queued' in the
        // Processing Queue immediately; the runSerial mutex inside
        // startProcessing keeps the actual sidecar work strictly one-at-
        // a-time across this batch AND any other concurrent uploads.
        startProcessing(processingItemId, transcriptId, filePath, controller.signal);

      } catch (error) {
        console.error('Error creating transcript:', error);
        alert(`Error processing file ${fileName}: ${(error as Error).message}`);
      }
    }

    setSelectedFiles([]);
    setSelectedProject('');
    setShowNewProject(false);
    setNewProjectName('');
    setNewProjectDescription('');
  };

  const handleCreateNewProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      setIsCreatingProject(true);
      const newProject = await createProject(newProjectName.trim(), newProjectDescription.trim() || undefined);

      setSelectedProject(newProject.id);

      setShowNewProject(false);
      setNewProjectName('');
      setNewProjectDescription('');
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project. Please try again.');
    } finally {
      setIsCreatingProject(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Page Header */}
      <div className="mb-8 animate-fade-in">
        <h1 className="page-title">Upload & Process</h1>
        <p className="mt-1 text-sm text-surface-500">
          Upload audio or video files to transcribe and analyze with AI.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Upload Section */}
        <div className="lg:col-span-2 space-y-6">
          {/* File Upload Section */}
          <div className="card-interactive p-6 animate-slide-up" style={{ animationDelay: '0.05s', opacity: 0 }}>
            <h2 className="section-title mb-4">Select Files</h2>
            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-all duration-300 cursor-pointer ${
                isDragging
                  ? 'border-accent-400 bg-accent-50 scale-[1.01]'
                  : 'border-surface-200 hover:border-surface-300'
              }`}
              onClick={handleBrowseClick}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload
                className={`mx-auto h-12 w-12 transition-colors ${isDragging ? 'text-accent-500' : 'text-surface-300'}`}
                strokeWidth={1.5}
              />
              <div className="mt-4">
                <p className="text-base font-medium text-primary-800">
                  {isDragging ? 'Drop to add files' : 'Drag files here, or click to browse'}
                </p>
                <p className="mt-1.5 text-xs text-surface-400">
                  Supports MP3, WAV, MP4, MOV, M4A, WebM, OGG and other common formats
                </p>
              </div>
            </div>

            {selectedFiles.length > 0 && (
              <div className="mt-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-medium text-surface-500 uppercase tracking-wider">
                    Selected Files ({selectedFiles.length})
                  </h3>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedFiles([]); }}
                    className="text-xs text-surface-500 hover:text-surface-700 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                <div className="panel p-3">
                  <ul className="space-y-2">
                    {selectedFiles.map((filePath, index) => {
                      const fileName = filePath.split('/').pop() || filePath;
                      return (
                        <li key={`${filePath}-${index}`} className="flex items-center gap-2.5 text-sm">
                          <FileAudio size={15} className="text-primary-400 flex-shrink-0" />
                          <span className="text-surface-800 font-medium truncate flex-1 min-w-0" title={fileName}>{fileName}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
                            }}
                            className="text-surface-400 hover:text-error transition-colors flex-shrink-0 p-1"
                            title="Remove from selection"
                            aria-label={`Remove ${fileName} from selection`}
                          >
                            <X size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Project Assignment */}
          <div className="card-interactive p-6 animate-slide-up" style={{ animationDelay: '0.1s', opacity: 0 }}>
            <h2 className="section-title mb-4">Project Assignment</h2>
            <div className="space-y-4">
              <div>
                <label className="label mb-2">
                  Assign to Project (Optional)
                </label>
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  className="input"
                >
                  <option value="">None (add to library only)</option>
                  {projects
                    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.transcript_count || 0} transcripts)
                      </option>
                    ))}
                </select>
              </div>

              <button
                onClick={() => setShowNewProject(true)}
                className="flex items-center gap-2 link-accent text-sm"
              >
                <FolderPlus size={15} />
                <span>Create New Project</span>
              </button>
            </div>

            {/* New Project Form */}
            {showNewProject && (
              <div className="mt-5 border border-surface-200 rounded-xl p-4 space-y-4 bg-surface-50">
                <h3 className="section-title">Create New Project</h3>
                <div>
                  <label className="label">
                    Project Name *
                  </label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="input"
                    placeholder="Enter project name"
                  />
                </div>
                <div>
                  <label className="label">
                    Description
                  </label>
                  <textarea
                    value={newProjectDescription}
                    onChange={(e) => setNewProjectDescription(e.target.value)}
                    rows={3}
                    className="input-textarea"
                    placeholder="Optional project description"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleCreateNewProject}
                    disabled={!newProjectName.trim() || isCreatingProject}
                    className="btn-primary"
                  >
                    {isCreatingProject ? 'Creating...' : 'Create Project'}
                  </button>
                  <button
                    onClick={() => setShowNewProject(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Right column: sticky CTA + Processing Queue */}
        <div className="lg:col-span-1 animate-slide-up" style={{ animationDelay: '0.2s', opacity: 0 }}>
          <div className="sticky top-8 space-y-6">
            {/* Upload Action — always visible while selecting files */}
            <div className="card-interactive p-5">
              <h3 className="section-title">Ready to Process</h3>
              <p className="text-xs text-surface-500 mt-1 mb-4">
                {selectedFiles.length === 0
                  ? 'Select files to begin'
                  : `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} ready`}
              </p>
              <button
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || !sidecarReady}
                title={!sidecarReady
                  ? `Speech analysis engine not ready (state: ${sidecarStatus?.state ?? 'unknown'}). Watch the pill in the bottom-right corner.`
                  : undefined}
                className="w-full px-4 py-2.5 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-card hover:shadow-md flex items-center justify-center gap-2"
              >
                <Play size={15} />
                Upload &amp; Process
              </button>
              {!sidecarReady && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-3 text-center font-medium">
                  Speech analysis engine not ready yet
                  {sidecarStatus?.state === 'setting_up' && ' — first-launch setup is still running'}
                  {sidecarStatus?.state === 'starting' && ' — sidecar is starting up'}
                  {sidecarStatus?.state === 'failed' && ' — click the status pill (bottom-right) to retry'}
                  {sidecarStatus?.state === 'stopped' && ' — sidecar is stopped'}
                </p>
              )}
              {selectedProject && (
                <p className="text-[11px] text-surface-500 mt-3 text-center">
                  Will be added to the selected project
                </p>
              )}
            </div>

            <ProcessingQueue items={processingQueue} />
          </div>
        </div>
      </div>
    </div>
  );
};
