import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { Transcript } from '../types';
import { hydrateTranscriptRow } from '../utils/hydration';


interface TranscriptContextType {
  transcripts: Transcript[];
  recentTranscripts: Transcript[];
  loadTranscripts: () => Promise<void>;
  getTranscript: (id: string) => Promise<Transcript | null>;
  getTranscriptById: (id: string) => Promise<Transcript | null>;
  updateTranscript: (id: string, updates: Partial<Transcript>) => Promise<boolean>;
  deleteTranscript: (id: string) => Promise<void>;
  searchTranscripts: (query: string) => Promise<Transcript[]>;
}

export const TranscriptContext = createContext<TranscriptContextType>({
  transcripts: [],
  recentTranscripts: [],
  loadTranscripts: async () => {},
  getTranscript: async () => null,
  getTranscriptById: async () => null,
  updateTranscript: async () => false,
  deleteTranscript: async () => {},
  searchTranscripts: async () => []
});

export const useTranscripts = () => {
  const context = React.useContext(TranscriptContext);
  if (!context) {
    throw new Error('useTranscripts must be used within a TranscriptProvider');
  }
  return context;
};

interface TranscriptProviderProps {
  children: ReactNode;
}

export const TranscriptProvider: React.FC<TranscriptProviderProps> = ({ children }) => {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [recentTranscripts, setRecentTranscripts] = useState<Transcript[]>([]);

  const loadTranscripts = async () => {
    try {
      const allTranscripts = await window.electronAPI.db.transcripts.list();

      const parsed = allTranscripts.map(hydrateTranscriptRow);

      setTranscripts(parsed);
      setRecentTranscripts(parsed.slice(0, 10));
    } catch (error) {
      console.error('Error loading transcripts:', error);
    }
  };

  const getTranscript = async (id: string): Promise<Transcript | null> => {
    try {
      const transcript = await window.electronAPI.db.transcripts.get(id);

      if (transcript) {
        return hydrateTranscriptRow(transcript);
      }

      return null;
    } catch (error) {
      console.error('Error getting transcript:', error);
      return null;
    }
  };

  const getTranscriptById = getTranscript;

  const updateTranscript = async (id: string, updates: Partial<Transcript>): Promise<boolean> => {
    try {
      // The RPC validates each key against a column allow-list and serializes
      // JSON columns itself, so the renderer no longer builds any SQL.
      await window.electronAPI.db.transcripts.update(id, updates);

      await loadTranscripts();
      return true;
    } catch (error) {
      console.error('Error updating transcript:', error);
      return false;
    }
  };

  const deleteTranscript = async (id: string) => {
    try {
      // Delete transcript from database
      await window.electronAPI.db.transcripts.remove(id);

      // Also delete chunks from vector store
      try {
        await window.electronAPI.vectorStore.deleteTranscriptChunks(id);
        console.log(`Deleted vector chunks for transcript: ${id}`);
      } catch (vectorError) {
        console.error('Error deleting vector chunks:', vectorError);
        // Don't fail the deletion if vector cleanup fails
      }
      
      await loadTranscripts();
    } catch (error) {
      console.error('Error deleting transcript:', error);
    }
  };

  const searchTranscripts = async (query: string): Promise<Transcript[]> => {
    try {
      const results = await window.electronAPI.db.transcripts.searchByText(query);

      return results.map(hydrateTranscriptRow);
    } catch (error) {
      console.error('Error searching transcripts:', error);
      return [];
    }
  };

  useEffect(() => {
    loadTranscripts();
  }, []);

  return (
    <TranscriptContext.Provider
      value={{
        transcripts,
        recentTranscripts,
        loadTranscripts,
        getTranscript,
        getTranscriptById,
        updateTranscript,
        deleteTranscript,
        searchTranscripts
      }}
    >
      {children}
    </TranscriptContext.Provider>
  );
};