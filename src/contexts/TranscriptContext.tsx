import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { Transcript } from '../types';

// Safe per-field JSON parse: a single corrupt blob column used to throw out
// of the surrounding .map(), which the outer try/catch swallowed — the user
// saw an empty library with no error. Now a bad field falls back to a
// default and logs a warning so the rest of the row still hydrates.
function parseJsonOr<T>(raw: unknown, fallback: T, field: string, rowId?: string): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(
      `transcript[${rowId ?? '?'}].${field}: malformed JSON, using default`,
      err instanceof Error ? err.message : err
    );
    return fallback;
  }
}

function hydrateTranscriptRow(t: any): Transcript {
  const id = t?.id;
  return {
    ...t,
    action_items: parseJsonOr(t.action_items, [], 'action_items', id),
    key_topics: parseJsonOr(t.key_topics, [], 'key_topics', id),
    tags: parseJsonOr(t.tags, [], 'tags', id),
    validation_changes: parseJsonOr(t.validation_changes, [], 'validation_changes', id),
    processed_text: t.processed_text || t.full_text || '',
    speakers: parseJsonOr(t.speakers, [], 'speakers', id),
    emotions: parseJsonOr(t.emotions, {}, 'emotions', id),
    notable_quotes: parseJsonOr(t.notable_quotes, [], 'notable_quotes', id),
    research_themes: parseJsonOr(t.research_themes, [], 'research_themes', id),
    qa_pairs: parseJsonOr(t.qa_pairs, [], 'qa_pairs', id),
    concept_frequency: parseJsonOr(t.concept_frequency, {}, 'concept_frequency', id),
    starred: !!t.starred,
  };
}

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
      
      const parsed = allTranscripts.map(hydrateTranscriptRow);

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