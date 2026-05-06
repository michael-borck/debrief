import React, { createContext, useState, useEffect, useRef, ReactNode } from 'react';
import { ServiceStatus, ProcessingItem } from '../types';

interface ServiceContextType {
  serviceStatus: ServiceStatus;
  processingQueue: ProcessingItem[];
  testConnections: () => Promise<void>;
  addToProcessingQueue: (item: ProcessingItem, controller?: AbortController) => void;
  updateProcessingItem: (id: string, updates: Partial<ProcessingItem>) => void;
  removeFromProcessingQueue: (id: string) => void;
  cancelProcessingItem: (id: string) => void;
}

const defaultServiceStatus: ServiceStatus = {
  speechToText: 'disconnected',
  aiAnalysis: 'disconnected',
  lastChecked: new Date()
};

export const ServiceContext = createContext<ServiceContextType>({
  serviceStatus: defaultServiceStatus,
  processingQueue: [],
  testConnections: async () => {},
  addToProcessingQueue: () => {},
  updateProcessingItem: () => {},
  removeFromProcessingQueue: () => {},
  cancelProcessingItem: () => {}
});

interface ServiceProviderProps {
  children: ReactNode;
}

export const ServiceProvider: React.FC<ServiceProviderProps> = ({ children }) => {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>(defaultServiceStatus);
  const [processingQueue, setProcessingQueue] = useState<ProcessingItem[]>([]);
  // AbortControllers live in a ref so they don't trigger re-renders. Keyed
  // by ProcessingItem.id; cleared when the item is removed or finishes.
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const testConnections = async () => {
    try {
      // Speech-to-text now runs locally via @huggingface/transformers — no
      // server to test. Treat it as always available; the model will be
      // downloaded lazily on first transcription.
      const aiUrl = await window.electronAPI.database.get(
        'SELECT value FROM settings WHERE key = ?',
        ['aiAnalysisUrl']
      );

      const aiResult = await window.electronAPI.services.testConnection(
        aiUrl?.value || 'http://localhost:11434'
      );

      setServiceStatus({
        speechToText: 'connected',
        aiAnalysis: aiResult.success ? 'connected' : 'error',
        lastChecked: new Date()
      });
    } catch (error) {
      console.error('Error testing connections:', error);
      setServiceStatus({
        speechToText: 'connected',
        aiAnalysis: 'error',
        lastChecked: new Date()
      });
    }
  };

  const addToProcessingQueue = (item: ProcessingItem, controller?: AbortController) => {
    if (controller) controllersRef.current.set(item.id, controller);
    setProcessingQueue(prev => [...prev, item]);
  };

  const updateProcessingItem = (id: string, updates: Partial<ProcessingItem>) => {
    setProcessingQueue(prev =>
      prev.map(item => item.id === id ? { ...item, ...updates } : item)
    );
    // Once an item reaches a terminal state, drop its controller — it's no
    // longer cancellable, and we don't want to leak the listener.
    if (
      updates.status === 'completed' ||
      updates.status === 'error' ||
      updates.status === 'cancelled'
    ) {
      controllersRef.current.delete(id);
    }
  };

  const removeFromProcessingQueue = (id: string) => {
    controllersRef.current.delete(id);
    setProcessingQueue(prev => prev.filter(item => item.id !== id));
  };

  const cancelProcessingItem = (id: string) => {
    const controller = controllersRef.current.get(id);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    // Reflect intent in the UI immediately. The actual 'cancelled' state
    // is set by fileProcessor's onCancelled callback, but in the gap
    // between abort() and that firing the user should see "Cancelling…".
    setProcessingQueue(prev =>
      prev.map(item =>
        item.id === id && item.status !== 'completed' && item.status !== 'error'
          ? { ...item, status: 'cancelled', error_message: 'Cancelling…' }
          : item
      )
    );
  };

  // Test connections on mount and periodically
  useEffect(() => {
    testConnections();
    const interval = setInterval(testConnections, 30000); // Test every 30 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <ServiceContext.Provider
      value={{
        serviceStatus,
        processingQueue,
        testConnections,
        addToProcessingQueue,
        updateProcessingItem,
        removeFromProcessingQueue,
        cancelProcessingItem
      }}
    >
      {children}
    </ServiceContext.Provider>
  );
};