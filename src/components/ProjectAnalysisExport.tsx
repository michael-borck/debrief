import React, { useState } from 'react';
import { logger } from '../utils/logger';
import {
  generateCSVExport,
  generateHTMLExport,
  generateMarkdownExport,
} from '../utils/export-generators';
import type { ProjectExportData } from '../utils/export-generators';
import { Project } from '../types';
import type { TranscriptRow } from '../types/db';

interface ProjectAnalysisExportProps {
  project: Project;
  onClose: () => void;
}

export const ProjectAnalysisExport: React.FC<ProjectAnalysisExportProps> = ({ 
  project, 
  onClose 
}) => {
  const [exportFormat, setExportFormat] = useState<'json' | 'csv' | 'markdown' | 'pdf'>('json');
  const [exportSections, setExportSections] = useState({
    overview: true,
    themes: true,
    concepts: true,
    speakers: true,
    timeline: true,
    patterns: true,
    transcripts: false
  });
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      // Get detailed analysis data
      const analysisResult = await window.electronAPI.db.projectAnalysis.getLatestResults(project.id);

      const detailedAnalysis = analysisResult?.results ? JSON.parse(analysisResult.results) : null;
      
      // Get project transcripts if requested
      let transcripts: TranscriptRow[] = [];
      if (exportSections.transcripts) {
        transcripts = await window.electronAPI.db.projectTranscripts.listTranscriptsForProject(
          project.id,
          { includeDeleted: true, orderBy: 'created_asc' }
        );
      }
      
      // Build export data
      const exportData: ProjectExportData = {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          created_at: project.created_at,
          last_analysis_at: project.last_analysis_at,
          transcript_count: project.transcript_count,
          total_duration: project.total_duration,
          date_range: project.date_range
        },
        analysis: {
          ...(exportSections.overview && {
            summary: project.summary,
            themes: project.themes,
            key_insights: project.key_insights
          }),
          ...(exportSections.themes && detailedAnalysis?.themeEvolution && {
            themeEvolution: detailedAnalysis.themeEvolution
          }),
          ...(exportSections.concepts && detailedAnalysis?.conceptFrequency && {
            conceptFrequency: detailedAnalysis.conceptFrequency
          }),
          ...(exportSections.speakers && detailedAnalysis?.speakerAnalysis && {
            speakerAnalysis: detailedAnalysis.speakerAnalysis
          }),
          ...(exportSections.timeline && detailedAnalysis?.timelineAnalysis && {
            timelineAnalysis: detailedAnalysis.timelineAnalysis
          }),
          ...(exportSections.patterns && detailedAnalysis?.crossTranscriptPatterns && {
            crossTranscriptPatterns: detailedAnalysis.crossTranscriptPatterns
          })
        },
        ...(exportSections.transcripts && { transcripts }),
        exported_at: new Date().toISOString(),
        export_format: exportFormat,
        export_sections: exportSections
      };
      
      // Generate export based on format
      let content: string;
      let filename: string;
      let mimeType: string;
      
      switch (exportFormat) {
        case 'json':
          content = JSON.stringify(exportData, null, 2);
          filename = `${project.name}_analysis.json`;
          mimeType = 'application/json';
          break;
          
        case 'csv':
          content = generateCSVExport(exportData);
          filename = `${project.name}_analysis.csv`;
          mimeType = 'text/csv';
          break;
          
        case 'markdown':
          content = generateMarkdownExport(exportData);
          filename = `${project.name}_analysis.md`;
          mimeType = 'text/markdown';
          break;
          
        case 'pdf':
          // For PDF, we'll generate HTML and let the browser handle PDF generation
          content = generateHTMLExport(exportData, { exportFormat, exportSections });
          filename = `${project.name}_analysis.html`;
          mimeType = 'text/html';
          break;
          
        default:
          throw new Error('Unsupported export format');
      }
      
      // Download the file
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      logger.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content max-w-md">
        <h2 className="text-xl font-display mb-4">Export Project Analysis</h2>
        
        {/* Export Format */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-surface-700 mb-2">
            Export Format
          </label>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'json' | 'csv' | 'markdown' | 'pdf')}
            className="input"
          >
            <option value="json">JSON (Complete Data)</option>
            <option value="csv">CSV (Tabular Data)</option>
            <option value="markdown">Markdown (Readable Report)</option>
            <option value="pdf">HTML (For PDF Print)</option>
          </select>
        </div>
        
        {/* Export Sections */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-surface-700 mb-2">
            Include Sections
          </label>
          <div className="space-y-2">
            {Object.entries(exportSections).map(([section, checked]) => (
              <label key={section} className="flex items-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setExportSections(prev => ({
                    ...prev,
                    [section]: e.target.checked
                  }))}
                  className="rounded border-surface-200 text-primary-800 focus:ring-primary-400"
                />
                <span className="ml-2 text-sm text-surface-700 capitalize">
                  {section.replace(/([A-Z])/g, ' $1').toLowerCase()}
                </span>
              </label>
            ))}
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="btn-secondary border-0"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || !Object.values(exportSections).some(Boolean)}
            className="btn-primary"
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};