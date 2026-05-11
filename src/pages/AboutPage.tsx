import React, { useState, useEffect } from 'react';

export const AboutPage: React.FC = () => {
  const [stats, setStats] = useState({
    totalTranscripts: 0,
    databaseSize: '0 MB',
    platform: '',
    dataLocation: ''
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Get transcript count
      const countResult = await window.electronAPI.database.get(
        'SELECT COUNT(*) as count FROM transcripts'
      );
      
      // Get database location
      const dataPath = await window.electronAPI.fs.getAppPath('userData');
      
      setStats({
        totalTranscripts: countResult.count || 0,
        databaseSize: '156 MB', // TODO: Calculate actual size
        platform: process.platform === 'darwin' ? 'macOS' : 
                  process.platform === 'win32' ? 'Windows' : 'Linux',
        dataLocation: dataPath
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const handleOpenUserGuide = () => {
    // TODO: Implement
    console.log('Open user guide');
  };

  const handleReportBug = () => {
    // TODO: Implement
    console.log('Report bug');
  };

  const handleFeatureRequest = () => {
    // TODO: Implement
    console.log('Feature request');
  };

  const handleContactSupport = () => {
    // TODO: Implement
    console.log('Contact support');
  };

  const handleCheckUpdates = () => {
    // TODO: Implement
    console.log('Check for updates');
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="text-4xl mb-4">🎤</div>
        <h1 className="text-3xl font-display text-surface-900">Debrief</h1>
        <p className="text-lg text-surface-600 mt-2">Version 1.0.0</p>
        <p className="text-surface-500 mt-1">AI-Powered Transcription & Analysis</p>
      </div>

      {/* System Information */}
      <div className="bg-white rounded-lg shadow-card border border-surface-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-surface-900 mb-4">System Information</h2>
        
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-surface-600">Platform:</span>
            <span className="text-surface-900">{stats.platform}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-surface-600">Database:</span>
            <span className="text-surface-900">SQLite 3.42.0</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-surface-600">Data Location:</span>
            <span className="text-surface-900 text-sm truncate max-w-xs" title={stats.dataLocation}>
              {stats.dataLocation}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-surface-600">Total Transcripts:</span>
            <span className="text-surface-900">{stats.totalTranscripts}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-surface-600">Database Size:</span>
            <span className="text-surface-900">{stats.databaseSize}</span>
          </div>
        </div>
      </div>

      {/* Support & Help */}
      <div className="bg-white rounded-lg shadow-card border border-surface-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-surface-900 mb-4">Support & Help</h2>
        
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleOpenUserGuide}
            className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <span>📚</span>
            <span>User Guide</span>
          </button>
          
          <button
            onClick={handleReportBug}
            className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <span>🐛</span>
            <span>Report Bug</span>
          </button>
          
          <button
            onClick={handleFeatureRequest}
            className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <span>💡</span>
            <span>Feature Request</span>
          </button>
          
          <button
            onClick={handleContactSupport}
            className="flex items-center justify-center space-x-2 px-4 py-3 border border-surface-200 rounded-lg hover:bg-surface-50"
          >
            <span>📧</span>
            <span>Contact Support</span>
          </button>
        </div>
        
        <button
          onClick={handleCheckUpdates}
          className="w-full mt-4 btn-primary px-4 py-3"
        >
          🔄 Check for Updates
        </button>
      </div>

      {/* Legal */}
      <div className="bg-white rounded-lg shadow-card border border-surface-200 p-6">
        <h2 className="text-lg font-semibold text-surface-900 mb-4">Legal</h2>
        
        <div className="text-center space-y-2">
          <div className="flex justify-center space-x-4 text-sm">
            <button className="text-primary-800 hover:text-primary-900">
              Privacy Policy
            </button>
            <span className="text-surface-400">•</span>
            <button className="text-primary-800 hover:text-primary-900">
              Terms of Service
            </button>
            <span className="text-surface-400">•</span>
            <button className="text-primary-800 hover:text-primary-900">
              Licenses
            </button>
          </div>
          
          <p className="text-surface-600 mt-4">
            © 2024 Your Institution
          </p>
          
          <p className="text-surface-500 text-sm">
            Built with ❤️ for Academic Research
          </p>
        </div>
      </div>
    </div>
  );
};