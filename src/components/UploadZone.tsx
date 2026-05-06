import React, { useState, useRef, useContext } from 'react';
import { Upload, FileAudio } from 'lucide-react';
import { ServiceContext } from '../contexts/ServiceContext';
import { TranscriptContext } from '../contexts/TranscriptContext';
import { generateId } from '../utils/helpers';
import { fileProcessor } from '../services/fileProcessor';

export const UploadZone: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToProcessingQueue, updateProcessingItem } = useContext(ServiceContext);
  const { loadTranscripts } = useContext(TranscriptContext);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      handleFiles(files);
    }
  };

  const handleFiles = async (files: File[]) => {
    const acceptedTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'video/mp4', 'video/avi', 'video/quicktime', 'audio/m4a', 'audio/webm', 'audio/ogg'];

    for (const file of files) {
      if (!acceptedTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|mp4|avi|mov|m4a|webm|ogg)$/i)) {
        console.error(`File type not supported: ${file.name}`);
        continue;
      }

      const transcriptId = generateId();
      const timestamp = new Date().toISOString();

      try {
        await window.electronAPI.database.run(
          `INSERT INTO transcripts (id, title, filename, file_size, created_at, updated_at, status, starred)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [transcriptId, file.name, file.name, file.size, timestamp, timestamp, 'processing', 0]
        );

        addToProcessingQueue({
          id: generateId(),
          transcript_id: transcriptId,
          file_path: file.name,
          status: 'queued',
          progress: 0,
          created_at: timestamp
        });
      } catch (error) {
        console.error('Error creating transcript:', error);
      }
    }
  };

  const checkForDuplicates = async (filePath: string, fileName: string): Promise<boolean> => {
    try {
      const existing = await window.electronAPI.database.all(
        `SELECT id, title, file_path, created_at FROM transcripts
         WHERE filename = ? OR file_path = ? OR title = ?`,
        [fileName, filePath, fileName]
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

  const handleFilePaths = async (filePaths: string[]) => {
    for (const filePath of filePaths) {
      const fileName = filePath.split('/').pop() || filePath;

      const shouldSkip = await checkForDuplicates(filePath, fileName);
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

        await startProcessing(processingItemId, transcriptId, filePath, controller.signal);

      } catch (error) {
        console.error('Error creating transcript:', error);
        alert(`Error processing file ${fileName}: ${(error as Error).message}`);
      }
    }
  };

  const startProcessing = async (
    processingItemId: string,
    transcriptId: string,
    filePath: string,
    signal: AbortSignal
  ) => {
    try {
      updateProcessingItem(processingItemId, { status: 'transcribing', stage: 'analyzing_media' });

      await fileProcessor.processFile(filePath, transcriptId, {
        signal,
        onProgress: (stage, percent) => {
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
          await loadTranscripts();
        },
        onCancelled: async () => {
          updateProcessingItem(processingItemId, {
            status: 'cancelled',
            error_message: 'Cancelled by user',
          });
          await loadTranscripts();
        },
        onComplete: async () => {
          console.log('Processing completed for:', transcriptId);
          updateProcessingItem(processingItemId, {
            status: 'completed',
            progress: 100
          });
          await loadTranscripts();
        }
      });
    } catch (error) {
      console.error('Error starting processing:', error);
      updateProcessingItem(processingItemId, {
        status: 'error',
        error_message: (error as Error).message
      });
      await loadTranscripts();
    }
  };

  const handleBrowseClick = async () => {
    const filePaths = await window.electronAPI.dialog.openFile();
    if (filePaths.length > 0) {
      console.log('Selected files:', filePaths);
      await handleFilePaths(filePaths);
    }
  };

  return (
    <div className="card-interactive p-5">
      <h2 className="text-base font-display text-surface-900 mb-4 flex items-center gap-2">
        <FileAudio size={18} className="text-primary-500" />
        Quick Upload
      </h2>

      <div
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300
          ${isDragging
            ? 'border-primary-400 bg-primary-100 scale-[1.01]'
            : 'border-surface-200 hover:border-surface-300'
          }
        `}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="space-y-3">
          <Upload size={28} className={`mx-auto ${isDragging ? 'text-primary-500' : 'text-surface-300'} transition-colors`} />
          <div className="text-surface-600">
            <p className="text-sm font-medium mb-1">Drag & drop files here</p>
            <p className="text-xs text-surface-400">or click to browse</p>
          </div>

          <button
            onClick={handleBrowseClick}
            className="btn-primary"
          >
            Browse Files
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".mp3,.wav,.mp4,.avi,.mov,.m4a,.webm,.ogg"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      <p className="text-xs text-surface-400 mt-3">
        Supports: MP3, WAV, MP4, AVI, MOV, M4A
      </p>
    </div>
  );
};
