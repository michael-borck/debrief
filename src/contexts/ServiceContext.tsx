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

  // Map sidecar state to ServiceStatus.speechToText vocabulary.
  const mapSidecar = (state?: string): ServiceStatus['speechToText'] => {
    switch (state) {
      case 'ready': return 'connected';
      case 'setting_up': return 'setting_up';
      case 'starting': return 'starting';
      case 'failed': return 'error';
      case 'stopped':
      default: return 'disconnected';
    }
  };

  const testConnections = async () => {
    try {
      // Speech-to-text runs via the bundled Python sidecar — read its real
      // state rather than hard-coding 'connected'.
      let sidecarState: ServiceStatus['speechToText'] = 'disconnected';
      let sidecarDetail: string | undefined;
      try {
        const s = await window.electronAPI.sidecar.status();
        sidecarState = mapSidecar(s.state);
        if (s.state === 'setting_up' && s.setupSteps.length > 0) {
          sidecarDetail = s.setupSteps[s.setupSteps.length - 1];
        } else if (s.state === 'failed' && s.lastError) {
          sidecarDetail = s.lastError;
        }
      } catch {
        // electronAPI.sidecar unavailable (very early / test env)
      }

      const aiUrl = await window.electronAPI.database.get(
        'SELECT value FROM settings WHERE key = ?',
        ['aiAnalysisUrl']
      );

      const aiResult = await window.electronAPI.services.testConnection(
        aiUrl?.value || 'http://localhost:11434'
      );

      setServiceStatus({
        speechToText: sidecarState,
        speechToTextDetail: sidecarDetail,
        aiAnalysis: aiResult.success ? 'connected' : 'error',
        lastChecked: new Date()
      });
    } catch (error) {
      console.error('Error testing connections:', error);
      setServiceStatus({
        speechToText: 'disconnected',
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

  // Test connections on mount and periodically. AI analysis ping is the slow
  // part (HTTP to user's LLM); we leave that at 30s. Sidecar status is a
  // cheap IPC roundtrip and the user wants to see setup steps tick by, so
  // we refresh just the sidecar state at 2s in a parallel loop.
  useEffect(() => {
    testConnections();
    const aiInterval = setInterval(testConnections, 30000);
    return () => clearInterval(aiInterval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshSidecar = async () => {
      try {
        const s = await window.electronAPI.sidecar.status();
        if (cancelled) return;
        setServiceStatus(prev => ({
          ...prev,
          speechToText: mapSidecar(s.state),
          speechToTextDetail: s.state === 'setting_up' && s.setupSteps.length > 0
            ? s.setupSteps[s.setupSteps.length - 1]
            : s.state === 'failed' && s.lastError ? s.lastError : undefined,
        }));
      } catch {
        // electronAPI unavailable
      }
    };
    refreshSidecar();
    const id = setInterval(refreshSidecar, 2000);
    return () => { cancelled = true; clearInterval(id); };
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