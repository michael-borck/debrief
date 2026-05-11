import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { StatusBar } from './StatusBar';
import { AboutDialog } from './AboutDialog';
import { LicensesModal } from './LicensesModal';
import { ToastContainer } from './ToastContainer';
import { WelcomeModal } from './WelcomeModal';

const WELCOME_SEEN_KEY = 'debrief:welcomeSeenV1';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showLicensesModal, setShowLicensesModal] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => {
    // Show the welcome modal on first launch only. The key is versioned
    // so we can re-show it after a major release if we ever want to.
    try {
      return localStorage.getItem(WELCOME_SEEN_KEY) !== '1';
    } catch {
      return false;
    }
  });

  const handleWelcomeClose = (dontShowAgain: boolean) => {
    // Only persist the "seen" flag when the user explicitly opts in.
    // "Skip for now" closes the modal for this session but leaves it
    // ready to show on next launch, which matches user expectations.
    if (dontShowAgain) {
      try {
        localStorage.setItem(WELCOME_SEEN_KEY, '1');
      } catch { /* ignore quota errors */ }
    }
    setShowWelcome(false);
  };

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', JSON.stringify(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  // Listen for menu actions
  useEffect(() => {
    const handleMenuAction = (action: string) => {
      if (action === 'show-about') {
        setShowAboutDialog(true);
      } else if (action === 'show-licenses') {
        setShowLicensesModal(true);
      } else if (action === 'new-upload') {
        navigate('/upload');
      }
    };

    // Main process can request a route change via the 'navigate' channel
    // (used by the Help → User Guide menu entry, for example)
    const handleNavigate = (page: string) => {
      if (typeof page !== 'string') return;
      if (page === 'docs') navigate('/docs');
      else if (page === 'settings') navigate('/settings');
      else if (page.startsWith('/')) navigate(page);
    };

    if (window.electronAPI?.onMenuAction) {
      window.electronAPI.onMenuAction(handleMenuAction);
    }
    if (window.electronAPI?.onNavigate) {
      window.electronAPI.onNavigate(handleNavigate);
    }

    // Cleanup
    return () => {
      if (window.electronAPI?.removeAllListeners) {
        window.electronAPI.removeAllListeners('menu-action');
        window.electronAPI.removeAllListeners('navigate');
      }
    };
  }, []);

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  return (
    <div className="flex flex-col h-screen bg-surface-50 bg-noise">
      {/* Full-width draggable title strip for macOS — sits above both the
          sidebar and the main content so the top edge of the window is
          draggable and the sidebar logo has clearance from the traffic
          lights (which hiddenInset floats at the top-left). */}
      {isMac && (
        <div className="h-7 w-full bg-surface-900 titlebar-drag flex-shrink-0" />
      )}

      <div className="flex flex-1 min-h-0 min-w-0">
        {/* Sidebar */}
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={setIsSidebarCollapsed}
          onAboutClick={() => setShowAboutDialog(true)}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col relative z-10 min-w-0 min-h-0">
          {/* Main content */}
          <main className="flex-1 overflow-auto min-w-0">
            {children}
          </main>

          {/* Status bar */}
          <StatusBar />
        </div>
      </div>

      {/* About Dialog */}
      <AboutDialog
        isOpen={showAboutDialog}
        onClose={() => setShowAboutDialog(false)}
        onShowLicenses={() => {
          setShowAboutDialog(false);
          setShowLicensesModal(true);
        }}
      />

      {/* Licenses Modal */}
      <LicensesModal
        isOpen={showLicensesModal}
        onClose={() => setShowLicensesModal(false)}
      />

      {/* Global toast notifications */}
      <ToastContainer />

      {/* First-run welcome modal — shows once until dismissed */}
      <WelcomeModal isOpen={showWelcome} onClose={handleWelcomeClose} />
    </div>
  );
};
