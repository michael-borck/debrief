import React, { useState } from 'react';
import { Project } from '../types';

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
      let transcripts = [];
      if (exportSections.transcripts) {
        transcripts = await window.electronAPI.db.projectTranscripts.listTranscriptsForProject(
          project.id,
          { includeDeleted: true, orderBy: 'created_asc' }
        );
      }
      
      // Build export data
      const exportData = {
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
          content = generateHTMLExport(exportData);
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
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const generateCSVExport = (data: any): string => {
    const lines = [];
    
    // Project overview
    lines.push('Project Analysis Export');
    lines.push(`Project Name,${data.project.name}`);
    lines.push(`Description,${data.project.description || ''}`);
    lines.push(`Created Date,${new Date(data.project.created_at).toLocaleDateString()}`);
    lines.push(`Transcript Count,${data.project.transcript_count || 0}`);
    lines.push('');
    
    // Themes
    if (data.analysis.themes) {
      lines.push('Key Themes');
      data.analysis.themes.forEach((theme: string) => {
        lines.push(`"${theme}"`);
      });
      lines.push('');
    }
    
    // Theme Evolution
    if (data.analysis.themeEvolution) {
      lines.push('Theme Evolution');
      lines.push('Theme,Total Occurrences,Trend,Avg Relevance');
      data.analysis.themeEvolution.forEach((theme: any) => {
        lines.push(`"${theme.theme}",${theme.totalOccurrences},${theme.trend},${theme.avgRelevance.toFixed(2)}`);
      });
      lines.push('');
    }
    
    // Concept Frequency
    if (data.analysis.conceptFrequency) {
      lines.push('Concept Frequency');
      lines.push('Concept,Total Count,Transcript Count,Avg Frequency,Trend');
      Object.entries(data.analysis.conceptFrequency).forEach(([concept, conceptData]: [string, any]) => {
        lines.push(`"${concept}",${conceptData.totalCount},${conceptData.transcriptCount},${conceptData.avgFrequency.toFixed(1)},${conceptData.trend}`);
      });
    }
    
    return lines.join('\n');
  };

  const generateMarkdownExport = (data: any): string => {
    const lines = [];
    
    lines.push(`# Project Analysis: ${data.project.name}`);
    lines.push('');
    
    if (data.project.description) {
      lines.push(`**Description:** ${data.project.description}`);
      lines.push('');
    }
    
    lines.push(`**Created:** ${new Date(data.project.created_at).toLocaleDateString()}`);
    lines.push(`**Transcripts:** ${data.project.transcript_count || 0}`);
    lines.push(`**Total Duration:** ${formatDuration(data.project.total_duration || 0)}`);
    
    if (data.project.date_range) {
      lines.push(`**Date Range:** ${new Date(data.project.date_range.start).toLocaleDateString()} - ${new Date(data.project.date_range.end).toLocaleDateString()}`);
    }
    
    lines.push('');
    
    // Summary
    if (data.analysis.summary) {
      lines.push('## Summary');
      lines.push('');
      lines.push(data.analysis.summary);
      lines.push('');
    }
    
    // Key Themes
    if (data.analysis.themes && data.analysis.themes.length > 0) {
      lines.push('## Key Themes');
      lines.push('');
      data.analysis.themes.forEach((theme: string) => {
        lines.push(`- ${theme}`);
      });
      lines.push('');
    }
    
    // Key Insights
    if (data.analysis.key_insights && data.analysis.key_insights.length > 0) {
      lines.push('## Key Insights');
      lines.push('');
      data.analysis.key_insights.forEach((insight: string) => {
        lines.push(`- ${insight}`);
      });
      lines.push('');
    }
    
    // Theme Evolution
    if (data.analysis.themeEvolution) {
      lines.push('## Theme Evolution');
      lines.push('');
      data.analysis.themeEvolution.slice(0, 10).forEach((theme: any) => {
        lines.push(`### ${theme.theme}`);
        lines.push(`- **Trend:** ${theme.trend}`);
        lines.push(`- **Total Occurrences:** ${theme.totalOccurrences}`);
        lines.push(`- **Average Relevance:** ${(theme.avgRelevance * 100).toFixed(1)}%`);
        lines.push(`- **Appears in:** ${theme.occurrences.length} transcript(s)`);
        lines.push('');
      });
    }
    
    // Speaker Analysis
    if (data.analysis.speakerAnalysis) {
      lines.push('## Speaker Analysis');
      lines.push('');
      lines.push(`**Total Speakers:** ${data.analysis.speakerAnalysis.totalSpeakers}`);
      lines.push('');
      
      Object.entries(data.analysis.speakerAnalysis.speakerDistribution).slice(0, 5).forEach(([speaker, speakerData]: [string, any]) => {
        lines.push(`### ${speaker}`);
        lines.push(`- **Transcript Count:** ${speakerData.transcriptCount}`);
        lines.push(`- **Total Segments:** ${speakerData.totalSegments}`);
        if (speakerData.themes.length > 0) {
          lines.push(`- **Key Themes:** ${speakerData.themes.slice(0, 3).join(', ')}`);
        }
        lines.push('');
      });
    }
    
    // Cross-Transcript Patterns
    if (data.analysis.crossTranscriptPatterns && data.analysis.crossTranscriptPatterns.length > 0) {
      lines.push('## Cross-Transcript Patterns');
      lines.push('');
      data.analysis.crossTranscriptPatterns.slice(0, 5).forEach((pattern: any) => {
        lines.push(`### ${pattern.description}`);
        lines.push(`- **Type:** ${pattern.type.replace('_', ' ')}`);
        lines.push(`- **Strength:** ${(pattern.strength * 100).toFixed(0)}%`);
        lines.push(`- **Evidence:** ${pattern.evidence.length} transcript(s)`);
        if (pattern.insights.length > 0) {
          lines.push('- **Insights:**');
          pattern.insights.forEach((insight: string) => {
            lines.push(`  - ${insight}`);
          });
        }
        lines.push('');
      });
    }
    
    lines.push('---');
    lines.push(`*Exported on ${new Date(data.exported_at).toLocaleDateString()} from Debrief*`);
    
    return lines.join('\n');
  };

  const generateHTMLExport = (data: any): string => {
    const markdownContent = generateMarkdownExport(data);
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Project Analysis: ${data.project.name}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }
        h2 { color: #1e40af; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        h3 { color: #374151; }
        ul { padding-left: 20px; }
        li { margin-bottom: 5px; }
        .metadata { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .metadata strong { color: #374151; }
        hr { border: none; border-top: 1px solid #e5e7eb; margin: 30px 0; }
        @media print { body { margin: 0; padding: 15px; } }
    </style>
</head>
<body>
    <div class="metadata">
        <strong>Exported:</strong> ${new Date(data.exported_at).toLocaleString()}<br>
        <strong>Format:</strong> ${exportFormat.toUpperCase()}<br>
        <strong>Sections:</strong> ${Object.entries(exportSections).filter(([_, included]) => included).map(([section]) => section).join(', ')}
    </div>
    ${markdownContent.replace(/\n/g, '<br>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^\- (.+)$/gm, '<li>$1</li>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}
</body>
</html>`;
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
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
            onChange={(e) => setExportFormat(e.target.value as any)}
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