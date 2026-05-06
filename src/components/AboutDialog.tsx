import React from 'react';
import { URLS } from '../constants/urls';
import { Modal } from './Modal';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onShowLicenses?: () => void;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose, onShowLicenses }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="About DeepTalk"
      contentClassName="bg-white rounded-lg shadow-elevated max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
    >
        {/* Header */}
        <div className="border-b border-surface-200 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-surface-900">About DeepTalk</h2>
            <button
              onClick={onClose}
              className="text-surface-400 hover:text-surface-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* App Info */}
          <div className="text-center">
            <div className="text-6xl mb-4">🎤</div>
            <h3 className="text-3xl font-display text-surface-900">DeepTalk</h3>
            <p className="text-xl text-surface-600 mt-2">Version 1.0.0</p>
            <p className="text-surface-500 mt-1">AI-Powered Conversation Analysis & Insight Discovery</p>
          </div>

          {/* System Info */}
          <div className="bg-surface-50 rounded-lg p-4">
            <h4 className="font-semibold text-surface-900 mb-3">System Information</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-surface-600">Platform:</span>
                <span className="text-surface-900 font-medium">
                  {window.electronAPI?.platform === 'darwin' ? 'macOS' : 
                   window.electronAPI?.platform === 'win32' ? 'Windows' : 'Linux'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-600">Electron:</span>
                <span className="text-surface-900 font-medium">
                  {window.electronAPI?.versions?.electron || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-600">Node.js:</span>
                <span className="text-surface-900 font-medium">
                  {window.electronAPI?.versions?.node || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-600">Chrome:</span>
                <span className="text-surface-900 font-medium">
                  {window.electronAPI?.versions?.chrome || 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="bg-primary-100 rounded-lg p-4">
            <h4 className="font-semibold text-surface-900 mb-3">Key Features</h4>
            <ul className="space-y-1 text-sm text-surface-700">
              <li>• Process audio, video, podcasts, and conversations</li>
              <li>• AI-powered analysis with theme discovery and pattern recognition</li>
              <li>• Cross-transcript intelligence and consensus analysis</li>
              <li>• Interactive chat with semantic search using local RAG</li>
              <li>• Project-based workflow for research and content analysis</li>
              <li>• Complete privacy with local processing and storage</li>
            </ul>
          </div>

          {/* Links */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => console.log('Documentation coming soon')}
              disabled
              className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg bg-surface-100 text-surface-400 cursor-not-allowed"
              title="Documentation will be available when the app is feature-complete"
            >
              <span>📚</span>
              <span>Documentation</span>
            </button>
            <button
              onClick={onShowLicenses}
              className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors"
            >
              <span>📜</span>
              <span>Licenses</span>
            </button>
            <button
              onClick={() => window.open(URLS.REPO, '_blank')}
              className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors"
            >
              <span>GitHub</span>
            </button>
            <button
              onClick={() => window.open(URLS.ISSUES, '_blank')}
              className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg hover:bg-surface-50 transition-colors"
            >
              <span>Report Issue</span>
            </button>
          </div>

          {/* Check for Updates */}
          <button
            onClick={() => console.log('Check for updates')}
            className="btn-primary w-full px-4 py-3 flex items-center justify-center space-x-2"
          >
            <span>🔄</span>
            <span>Check for Updates</span>
          </button>

          {/* Footer */}
          <div className="text-center pt-4 border-t border-surface-200">
            <p className="text-surface-600 text-sm">
              © 2024 DeepTalk Project
            </p>
            <p className="text-surface-500 text-xs mt-1">
              Built with ❤️ for Conversation Analysis & Research
            </p>
            <div className="mt-3 text-xs text-surface-500">
              <button className="hover:text-primary-900 transition-colors">Privacy Policy</button>
              <span className="mx-2">•</span>
              <button className="hover:text-primary-900 transition-colors">Terms of Service</button>
              <span className="mx-2">•</span>
              <button className="hover:text-primary-900 transition-colors">Acknowledgments</button>
            </div>
          </div>
        </div>
    </Modal>
  );
};