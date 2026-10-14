// Pure builders for the project-analysis export files.
//
// These were previously inline in ProjectAnalysisExport.tsx, which made the
// escaping impossible to unit-test: the only way to exercise generateHTMLExport
// was to mount the component and intercept the download Blob. They are pure
// string builders with no React or window dependency, so they live here and are
// called from the component.
//
// ESCAPING: anything interpolated into the HTML/CSV output goes through
// src/utils/export-escape. The taint is not just the user — analysis summaries,
// themes, key insights, concept names and pattern descriptions are AI-generated
// from transcript text, so a recording containing an injection payload can steer
// the model into emitting markup. The exported file is opened outside the app,
// where the app's CSP does not apply.

import { escapeHtml, csvCell } from './export-escape';

// Shape of the export payload the generate* functions read. All analysis
// sub-objects are optional (each is rendered behind an `if` guard); only the
// project identity + exported_at are accessed unconditionally.
//
// The optional extras (id, last_analysis_at, transcripts, export_*) are not
// read by these builders — they exist so the JSON export, which stringifies the
// whole object, can carry them.
export interface ProjectExportData {
  exported_at: string;
  project: {
    name: string;
    created_at: string;
    id?: string;
    description?: string;
    last_analysis_at?: string;
    transcript_count?: number;
    total_duration?: number;
    date_range?: { start: string; end: string };
  };
  transcripts?: unknown[];
  export_format?: string;
  export_sections?: Record<string, boolean>;
  analysis: {
    summary?: string;
    themes?: string[];
    key_insights?: string[];
    themeEvolution?: Array<{
      theme: string;
      totalOccurrences: number;
      trend: string;
      avgRelevance: number;
      occurrences: unknown[];
    }>;
    conceptFrequency?: Record<
      string,
      {
        totalCount: number;
        transcriptCount: number;
        avgFrequency: number;
        trend: string;
      }
    >;
    speakerAnalysis?: {
      totalSpeakers: number;
      speakerDistribution: Record<
        string,
        { transcriptCount: number; totalSegments: number; themes: string[] }
      >;
    };
    crossTranscriptPatterns?: Array<{
      description: string;
      type: string;
      strength: number;
      evidence: unknown[];
      insights: string[];
    }>;
  };
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function generateCSVExport(data: ProjectExportData): string {
  const lines: string[] = [];

  // Project overview
  lines.push('Project Analysis Export');
  lines.push(`Project Name,${csvCell(data.project.name)}`);
  lines.push(`Description,${csvCell(data.project.description || '')}`);
  lines.push(`Created Date,${csvCell(new Date(data.project.created_at).toLocaleDateString())}`);
  lines.push(`Transcript Count,${csvCell(data.project.transcript_count || 0)}`);
  lines.push('');

  // Themes
  if (data.analysis.themes) {
    lines.push('Key Themes');
    for (const theme of data.analysis.themes) {
      lines.push(csvCell(theme));
    }
    lines.push('');
  }

  // Theme Evolution
  if (data.analysis.themeEvolution) {
    lines.push('Theme Evolution');
    lines.push('Theme,Total Occurrences,Trend,Avg Relevance');
    for (const theme of data.analysis.themeEvolution) {
      lines.push(
        `${csvCell(theme.theme)},${csvCell(theme.totalOccurrences)},${csvCell(theme.trend)},${csvCell(theme.avgRelevance.toFixed(2))}`
      );
    }
    lines.push('');
  }

  // Concept Frequency
  if (data.analysis.conceptFrequency) {
    lines.push('Concept Frequency');
    lines.push('Concept,Total Count,Transcript Count,Avg Frequency,Trend');
    for (const [concept, conceptData] of Object.entries(data.analysis.conceptFrequency)) {
      lines.push(
        `${csvCell(concept)},${csvCell(conceptData.totalCount)},${csvCell(conceptData.transcriptCount)},${csvCell(conceptData.avgFrequency.toFixed(1))},${csvCell(conceptData.trend)}`
      );
    }
    lines.push('');
  }

  // Summary + key insights (previously only in markdown/HTML, so a CSV
  // export silently dropped the analysis narrative the user asked for).
  if (data.analysis.summary) {
    lines.push(`Summary,${csvCell(data.analysis.summary)}`);
    lines.push('');
  }
  if (data.analysis.key_insights && data.analysis.key_insights.length > 0) {
    lines.push('Key Insights');
    for (const insight of data.analysis.key_insights) {
      lines.push(csvCell(insight));
    }
    lines.push('');
  }

  // Speakers
  if (data.analysis.speakerAnalysis) {
    lines.push('Speakers');
    lines.push(`Total Speakers,${csvCell(data.analysis.speakerAnalysis.totalSpeakers)}`);
    lines.push('Speaker,Transcript Count,Total Segments,Themes');
    for (const [speaker, dist] of Object.entries(
      data.analysis.speakerAnalysis.speakerDistribution
    )) {
      lines.push(
        `${csvCell(speaker)},${csvCell(dist.transcriptCount)},${csvCell(dist.totalSegments)},${csvCell(dist.themes.join('; '))}`
      );
    }
    lines.push('');
  }

  // Cross-transcript patterns
  if (data.analysis.crossTranscriptPatterns && data.analysis.crossTranscriptPatterns.length > 0) {
    lines.push('Cross-Transcript Patterns');
    lines.push('Type,Description,Strength');
    for (const pattern of data.analysis.crossTranscriptPatterns) {
      lines.push(
        `${csvCell(pattern.type)},${csvCell(pattern.description)},${csvCell(pattern.strength)}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function generateMarkdownExport(data: ProjectExportData): string {
  const lines: string[] = [];

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
    lines.push(
      `**Date Range:** ${new Date(data.project.date_range.start).toLocaleDateString()} - ${new Date(data.project.date_range.end).toLocaleDateString()}`
    );
  }

  lines.push('');

  if (data.analysis.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(data.analysis.summary);
    lines.push('');
  }

  if (data.analysis.themes && data.analysis.themes.length > 0) {
    lines.push('## Key Themes');
    lines.push('');
    for (const theme of data.analysis.themes) {
      lines.push(`- ${theme}`);
    }
    lines.push('');
  }

  if (data.analysis.key_insights && data.analysis.key_insights.length > 0) {
    lines.push('## Key Insights');
    lines.push('');
    for (const insight of data.analysis.key_insights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  if (data.analysis.themeEvolution) {
    lines.push('## Theme Evolution');
    lines.push('');
    for (const theme of data.analysis.themeEvolution.slice(0, 10)) {
      lines.push(`### ${theme.theme}`);
      lines.push(`- **Trend:** ${theme.trend}`);
      lines.push(`- **Total Occurrences:** ${theme.totalOccurrences}`);
      lines.push(`- **Average Relevance:** ${(theme.avgRelevance * 100).toFixed(1)}%`);
      lines.push(`- **Appears in:** ${theme.occurrences.length} transcript(s)`);
      lines.push('');
    }
  }

  if (data.analysis.speakerAnalysis) {
    lines.push('## Speaker Analysis');
    lines.push('');
    lines.push(`**Total Speakers:** ${data.analysis.speakerAnalysis.totalSpeakers}`);
    lines.push('');

    for (const [speaker, speakerData] of Object.entries(
      data.analysis.speakerAnalysis.speakerDistribution
    ).slice(0, 5)) {
      lines.push(`### ${speaker}`);
      lines.push(`- **Transcript Count:** ${speakerData.transcriptCount}`);
      lines.push(`- **Total Segments:** ${speakerData.totalSegments}`);
      if (speakerData.themes.length > 0) {
        lines.push(`- **Key Themes:** ${speakerData.themes.slice(0, 3).join(', ')}`);
      }
      lines.push('');
    }
  }

  if (data.analysis.crossTranscriptPatterns && data.analysis.crossTranscriptPatterns.length > 0) {
    lines.push('## Cross-Transcript Patterns');
    lines.push('');
    for (const pattern of data.analysis.crossTranscriptPatterns.slice(0, 5)) {
      lines.push(`### ${pattern.description}`);
      lines.push(`- **Type:** ${pattern.type.replace('_', ' ')}`);
      lines.push(`- **Strength:** ${(pattern.strength * 100).toFixed(0)}%`);
      lines.push(`- **Evidence:** ${pattern.evidence.length} transcript(s)`);
      if (pattern.insights.length > 0) {
        lines.push('- **Insights:**');
        for (const insight of pattern.insights) {
          lines.push(`  - ${insight}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`*Exported on ${new Date(data.exported_at).toLocaleDateString()} from Debrief*`);

  return lines.join('\n');
}

export function generateHTMLExport(
  data: ProjectExportData,
  meta: { exportFormat: string; exportSections: Record<string, boolean> }
): string {
  const markdownContent = generateMarkdownExport(data);

  // Escape the untrusted text FIRST, then layer our own tags on top. That order
  // is the whole fix: our generated tags are inserted after escaping, so they
  // survive as real markup while every piece of model/user text stays inert.
  //
  // Newline -> <br> conversion goes LAST on purpose. Doing it first consumed
  // every newline, so the multiline anchors (^, $) in the heading rules matched
  // only the start and end of the whole document — `(.+)` then matched
  // everything remaining and the entire export was wrapped in a single <h1>.
  const bodyHtml = escapeHtml(markdownContent)
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  const sections = Object.entries(meta.exportSections)
    .filter(([, included]) => included)
    .map(([section]) => section)
    .join(', ');

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Project Analysis: ${escapeHtml(data.project.name)}</title>
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
        <strong>Exported:</strong> ${escapeHtml(new Date(data.exported_at).toLocaleString())}<br>
        <strong>Format:</strong> ${escapeHtml(meta.exportFormat.toUpperCase())}<br>
        <strong>Sections:</strong> ${escapeHtml(sections)}
    </div>
    ${bodyHtml}
</body>
</html>`;
}