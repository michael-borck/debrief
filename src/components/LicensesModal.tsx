import React from 'react';
import { Modal } from './Modal';

interface LicensesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LicensesModal: React.FC<LicensesModalProps> = ({ isOpen, onClose }) => {
  const licenses = [
    {
      name: 'Debrief',
      version: '1.0.0',
      license: 'MIT',
      description: 'AI-Powered Transcription & Analysis Application',
      licenseText: `MIT License

Copyright (c) 2024 Debrief Project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
    },
    {
      name: 'Electron',
      version: window.electronAPI?.versions?.electron || 'N/A',
      license: 'MIT',
      description: 'Build cross-platform desktop apps with JavaScript, HTML, and CSS',
      url: 'https://github.com/electron/electron',
      licenseUrl: 'https://github.com/electron/electron/blob/main/LICENSE'
    },
    {
      name: 'FFmpeg',
      version: '6.0+',
      license: 'LGPL v2.1+ / GPL v2+',
      description: 'A complete, cross-platform solution to record, convert and stream audio and video',
      url: 'https://ffmpeg.org/',
      licenseUrl: 'https://ffmpeg.org/legal.html',
      note: 'Used for audio extraction and processing. Distributed under LGPL v2.1.'
    },
    {
      name: 'LanceDB',
      version: '0.4+',
      license: 'Apache 2.0',
      description: 'Vector database for building AI applications',
      url: 'https://github.com/lancedb/lancedb',
      licenseUrl: 'https://github.com/lancedb/lancedb/blob/main/LICENSE'
    },
    {
      name: 'React',
      version: '18.x',
      license: 'MIT',
      description: 'A JavaScript library for building user interfaces',
      url: 'https://github.com/facebook/react',
      licenseUrl: 'https://github.com/facebook/react/blob/main/LICENSE'
    },
    {
      name: 'TypeScript',
      version: '5.x',
      license: 'Apache 2.0',
      description: 'TypeScript is a superset of JavaScript that compiles to clean JavaScript output',
      url: 'https://github.com/microsoft/TypeScript',
      licenseUrl: 'https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt'
    },
    {
      name: 'Tailwind CSS',
      version: '3.x',
      license: 'MIT',
      description: 'A utility-first CSS framework for rapid UI development',
      url: 'https://github.com/tailwindlabs/tailwindcss',
      licenseUrl: 'https://github.com/tailwindlabs/tailwindcss/blob/master/LICENSE'
    },
    {
      name: 'better-sqlite3',
      version: '9.x',
      license: 'MIT',
      description: 'The fastest and simplest library for SQLite3 in Node.js',
      url: 'https://github.com/WiseLibs/better-sqlite3',
      licenseUrl: 'https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE'
    },
    {
      name: 'Lucide React',
      version: '0.x',
      license: 'ISC',
      description: 'Beautiful & consistent icon toolkit made by the community',
      url: 'https://github.com/lucide-icons/lucide',
      licenseUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE'
    }
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Open Source Licenses"
      contentClassName="bg-white rounded-lg shadow-elevated max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
    >
        {/* Header */}
        <div className="border-b border-surface-200 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-surface-900">Open Source Licenses</h2>
            <button
              onClick={onClose}
              className="text-surface-400 hover:text-surface-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-surface-600 mt-2">
            Debrief is built with open source software. Here are the licenses for the components we use:
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {licenses.map((license, index) => (
              <div key={index} className="border border-surface-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-medium text-surface-900">{license.name}</h3>
                    <p className="text-sm text-surface-600">{license.description}</p>
                    <div className="flex items-center space-x-4 mt-1">
                      <span className="text-xs bg-surface-100 text-surface-700 px-2 py-1 rounded">
                        v{license.version}
                      </span>
                      <span className="text-xs bg-primary-100 text-primary-800 px-2 py-1 rounded">
                        {license.license}
                      </span>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    {license.url && (
                      <button
                        onClick={() => window.open(license.url, '_blank')}
                        className="text-xs text-primary-800 hover:text-primary-900 underline"
                      >
                        Project
                      </button>
                    )}
                    {license.licenseUrl && (
                      <button
                        onClick={() => window.open(license.licenseUrl, '_blank')}
                        className="text-xs text-primary-800 hover:text-primary-900 underline"
                      >
                        License
                      </button>
                    )}
                  </div>
                </div>
                
                {license.note && (
                  <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                    <strong>Note:</strong> {license.note}
                  </div>
                )}

                {license.licenseText && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-surface-700 hover:text-surface-900">
                      View License Text
                    </summary>
                    <pre className="mt-2 text-xs text-surface-600 bg-surface-50 p-3 rounded border max-h-64 overflow-y-auto whitespace-pre-wrap">
                      {license.licenseText}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>

          {/* Footer Notice */}
          <div className="mt-8 p-4 bg-surface-50 rounded-lg">
            <h4 className="font-medium text-surface-900 mb-2">License Compliance</h4>
            <div className="text-sm text-surface-600 space-y-2">
              <p>
                • <strong>FFmpeg:</strong> Distributed under LGPL v2.1. No modifications made to FFmpeg source code.
                FFmpeg binaries are dynamically linked and distributed separately.
              </p>
              <p>
                • <strong>Other Dependencies:</strong> All other components are used in accordance with their 
                respective licenses and are properly attributed.
              </p>
              <p>
                • <strong>Source Code:</strong> Debrief source code is available under MIT license on GitHub.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-surface-200 p-4 bg-surface-50">
          <div className="flex justify-between items-center">
            <p className="text-sm text-surface-600">
              For questions about licensing, please contact the project maintainers.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-surface-600 text-white rounded-lg hover:bg-surface-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
    </Modal>
  );
};