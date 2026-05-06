import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { HomePage } from './pages/HomePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { LibraryPage } from './pages/LibraryPage';
import { TranscriptDetailPage } from './pages/TranscriptDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { SearchPage } from './pages/SearchPage';
import { TrashPage } from './pages/TrashPage';
import { ArchivePage } from './pages/ArchivePage';
import { ChatHistoryPage } from './pages/ChatHistoryPage';
import { UploadPage } from './pages/UploadPage';
import DocsPage from './pages/DocsPage';
import ShortcutsModal from './components/ShortcutsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ServiceProvider } from './contexts/ServiceContext';
import { TranscriptProvider } from './contexts/TranscriptContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { ToastProvider } from './contexts/ToastContext';
import { ModalStackProvider } from './components/Modal';

const App: React.FC = () => {
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+? or Cmd+? to open shortcuts modal. Escape is handled by the
      // <Modal> wrapper itself.
      if ((event.ctrlKey || event.metaKey) && event.key === '?') {
        event.preventDefault();
        setShowShortcuts(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <ErrorBoundary>
      <ToastProvider>
      <ServiceProvider>
        <TranscriptProvider>
          <ProjectProvider>
            <ModalStackProvider>
            <Router>
              <AppShell>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/upload" element={<UploadPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/project/:id" element={<ProjectDetailPage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/transcript/:id" element={<TranscriptDetailPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/trash" element={<TrashPage />} />
                  <Route path="/archive" element={<ArchivePage />} />
                  <Route path="/chat-history" element={<ChatHistoryPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/docs" element={<DocsPage />} />
                  <Route path="/docs/:category/:page" element={<DocsPage />} />
                  <Route path="/shortcuts" element={<DocsPage />} />
                </Routes>
              </AppShell>
              <ShortcutsModal
                isOpen={showShortcuts}
                onClose={() => setShowShortcuts(false)}
              />
            </Router>
            </ModalStackProvider>
          </ProjectProvider>
        </TranscriptProvider>
      </ServiceProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;