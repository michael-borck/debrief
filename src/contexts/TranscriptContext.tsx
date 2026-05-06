import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { Transcript } from '../types';

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
      const allTranscripts = await window.electronAPI.database.all(
        'SELECT * FROM transcripts WHERE is_deleted != 1 OR is_deleted IS NULL ORDER BY created_at DESC'
      );
      
      // Parse JSON fields
      const parsed = allTranscripts.map((t: any) => ({
        ...t,
        action_items: t.action_items ? JSON.parse(t.action_items) : [],
        key_topics: t.key_topics ? JSON.parse(t.key_topics) : [],
        tags: t.tags ? JSON.parse(t.tags) : [],
        validation_changes: t.validation_changes ? JSON.parse(t.validation_changes) : [],
        processed_text: t.processed_text || t.full_text || '',
        speakers: t.speakers ? JSON.parse(t.speakers) : [],
        emotions: t.emotions ? JSON.parse(t.emotions) : {},
        notable_quotes: t.notable_quotes ? JSON.parse(t.notable_quotes) : [],
        research_themes: t.research_themes ? JSON.parse(t.research_themes) : [],
        qa_pairs: t.qa_pairs ? JSON.parse(t.qa_pairs) : [],
        concept_frequency: t.concept_frequency ? JSON.parse(t.concept_frequency) : {},
        starred: !!t.starred
      }));
      
      setTranscripts(parsed);
      setRecentTranscripts(parsed.slice(0, 10));
    } catch (error) {
      console.error('Error loading transcripts:', error);
    }
  };

  const getTranscript = async (id: string): Promise<Transcript | null> => {
    try {
      const transcript = await window.electronAPI.database.get(
        'SELECT * FROM transcripts WHERE id = ?',
        [id]
      );
      
      if (transcript) {
        return {
          ...transcript,
          action_items: transcript.action_items ? JSON.parse(transcript.action_items) : [],
          key_topics: transcript.key_topics ? JSON.parse(transcript.key_topics) : [],
          tags: transcript.tags ? JSON.parse(transcript.tags) : [],
          validation_changes: transcript.validation_changes ? JSON.parse(transcript.validation_changes) : [],
          speakers: transcript.speakers ? JSON.parse(transcript.speakers) : [],
          emotions: transcript.emotions ? JSON.parse(transcript.emotions) : {},
          notable_quotes: transcript.notable_quotes ? JSON.parse(transcript.notable_quotes) : [],
          research_themes: transcript.research_themes ? JSON.parse(transcript.research_themes) : [],
          qa_pairs: transcript.qa_pairs ? JSON.parse(transcript.qa_pairs) : [],
          concept_frequency: transcript.concept_frequency ? JSON.parse(transcript.concept_frequency) : {},
          starred: !!transcript.starred
        };
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
      const sets = [];
      const values = [];
      
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'action_items' || key === 'key_topics' || key === 'tags' || 
            key === 'speakers' || key === 'emotions' || key === 'notable_quotes' ||
            key === 'research_themes' || key === 'qa_pairs' || key === 'concept_frequency') {
          sets.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          sets.push(`${key} = ?`);
          values.push(value);
        }
      }
      
      values.push(id);
      
      await window.electronAPI.database.run(
        `UPDATE transcripts SET ${sets.join(', ')} WHERE id = ?`,
        values
      );
      
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
      await window.electronAPI.database.run(
        'DELETE FROM transcripts WHERE id = ?',
        [id]
      );
      
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
      const results = await window.electronAPI.database.all(
        `SELECT * FROM transcripts 
         WHERE title LIKE ? OR full_text LIKE ? OR summary LIKE ?
         ORDER BY created_at DESC`,
        [`%${query}%`, `%${query}%`, `%${query}%`]
      );
      
      return results.map((t: any) => ({
        ...t,
        action_items: t.action_items ? JSON.parse(t.action_items) : [],
        key_topics: t.key_topics ? JSON.parse(t.key_topics) : [],
        tags: t.tags ? JSON.parse(t.tags) : [],
        validation_changes: t.validation_changes ? JSON.parse(t.validation_changes) : [],
        processed_text: t.processed_text || t.full_text || '',
        speakers: t.speakers ? JSON.parse(t.speakers) : [],
        emotions: t.emotions ? JSON.parse(t.emotions) : {},
        notable_quotes: t.notable_quotes ? JSON.parse(t.notable_quotes) : [],
        research_themes: t.research_themes ? JSON.parse(t.research_themes) : [],
        qa_pairs: t.qa_pairs ? JSON.parse(t.qa_pairs) : [],
        concept_frequency: t.concept_frequency ? JSON.parse(t.concept_frequency) : {},
        starred: !!t.starred
      }));
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