/**
 * Transcript export builders.
 *
 * Generates DOCX (via the `docx` library) and PDF (via `jspdf`) buffers
 * from a transcript and its analysis. Markdown/TXT/JSON live in the
 * ExportModal directly since they're trivial string operations.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import { jsPDF } from 'jspdf';
import { Transcript } from '../types';

export interface ExportPayload {
  transcript: Transcript;
  transcriptContent: string; // already-processed text (after timestamp handling, version selection)
  versionLabel: string; // e.g. "Original", "Corrected", "Speaker tagged"
  includeMetadata: boolean;
  includeAnalysis: boolean;
}

const formatDuration = (seconds?: number): string => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// ============================================
// DOCX builder
// ============================================

export async function buildDocx(payload: ExportPayload): Promise<Blob> {
  const { transcript, transcriptContent, versionLabel, includeMetadata, includeAnalysis } = payload;

  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      text: transcript.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    })
  );

  // Metadata
  if (includeMetadata) {
    children.push(
      new Paragraph({
        text: 'Transcript Information',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 120 },
      })
    );

    const meta: Array<[string, string]> = [
      ['File', transcript.filename],
      ['Created', new Date(transcript.created_at).toLocaleString()],
      ['Duration', formatDuration(transcript.duration)],
      ['Version', versionLabel],
    ];
    if (transcript.speaker_count && transcript.speaker_count > 1) {
      meta.push(['Speakers', String(transcript.speaker_count)]);
    }
    for (const [label, value] of meta) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${label}: `, bold: true }),
            new TextRun({ text: value }),
          ],
          spacing: { after: 60 },
        })
      );
    }
  }

  // Analysis
  if (includeAnalysis && transcript.summary) {
    children.push(
      new Paragraph({
        text: 'Summary',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
      })
    );
    children.push(
      new Paragraph({
        text: transcript.summary,
        spacing: { after: 120 },
      })
    );
  }

  if (includeAnalysis && transcript.key_topics && transcript.key_topics.length > 0) {
    children.push(
      new Paragraph({
        text: 'Key Topics',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
      })
    );
    for (const topic of transcript.key_topics) {
      children.push(
        new Paragraph({
          text: topic,
          bullet: { level: 0 },
          spacing: { after: 60 },
        })
      );
    }
  }

  if (includeAnalysis && transcript.action_items && transcript.action_items.length > 0) {
    children.push(
      new Paragraph({
        text: 'Action Items',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
      })
    );
    for (const item of transcript.action_items) {
      children.push(
        new Paragraph({
          text: item,
          bullet: { level: 0 },
          spacing: { after: 60 },
        })
      );
    }
  }

  if (includeAnalysis && (transcript.sentiment_overall || transcript.emotions)) {
    children.push(
      new Paragraph({
        text: 'Analysis',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
      })
    );

    if (transcript.sentiment_overall) {
      const scoreText = transcript.sentiment_score !== undefined
        ? ` (${transcript.sentiment_score > 0 ? '+' : ''}${transcript.sentiment_score.toFixed(2)})`
        : '';
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Sentiment: ', bold: true }),
            new TextRun({ text: `${transcript.sentiment_overall}${scoreText}` }),
          ],
          spacing: { after: 120 },
        })
      );
    }

    if (transcript.emotions && Object.keys(transcript.emotions).length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: 'Emotions:', bold: true })],
          spacing: { after: 60 },
        })
      );
      const sorted = Object.entries(transcript.emotions)
        .filter(([_, v]) => v > 0.1)
        .sort(([, a], [, b]) => b - a);
      for (const [emotion, value] of sorted) {
        children.push(
          new Paragraph({
            text: `${emotion.charAt(0).toUpperCase() + emotion.slice(1)}: ${Math.round(value * 100)}%`,
            bullet: { level: 0 },
            spacing: { after: 40 },
          })
        );
      }
    }
  }

  // Transcript body
  children.push(
    new Paragraph({
      text: 'Transcript',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 120 },
    })
  );

  // Split content into paragraphs by double-newline or single-newline
  const transcriptParas = transcriptContent
    .split(/\n\s*\n|\n/)
    .map(p => p.trim())
    .filter(Boolean);

  for (const para of transcriptParas) {
    children.push(
      new Paragraph({
        text: para,
        spacing: { after: 120 },
      })
    );
  }

  const doc = new Document({
    creator: 'Debrief',
    title: transcript.title,
    description: 'Debrief transcript export',
    sections: [{ properties: {}, children }],
  });

  return await Packer.toBlob(doc);
}

// ============================================
// PDF builder
// ============================================

export function buildPdf(payload: ExportPayload): Blob {
  const { transcript, transcriptContent, versionLabel, includeMetadata, includeAnalysis } = payload;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 56;
  const marginTop = 56;
  const marginBottom = 56;
  const contentWidth = pageWidth - marginX * 2;

  let y = marginTop;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
  };

  const writeHeading = (text: string, size: number, weight: 'bold' | 'normal' = 'bold') => {
    ensureSpace(size + 18);
    doc.setFont('helvetica', weight);
    doc.setFontSize(size);
    doc.setTextColor(45, 52, 54); // surface-800
    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, marginX, y);
    y += lines.length * (size + 4) + 6;
  };

  const writeBody = (text: string, size = 11) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensureSpace(size + 6);
      doc.text(line, marginX, y);
      y += size + 4;
    }
    y += 4;
  };

  const writeBullet = (text: string, size = 11) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(60, 60, 60);
    const bulletIndent = 14;
    const lines = doc.splitTextToSize(text, contentWidth - bulletIndent);
    let first = true;
    for (const line of lines) {
      ensureSpace(size + 6);
      if (first) {
        doc.text('•', marginX, y);
        first = false;
      }
      doc.text(line, marginX + bulletIndent, y);
      y += size + 4;
    }
    y += 2;
  };

  const writeKv = (label: string, value: string) => {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);
    const labelText = `${label}: `;
    const labelWidth = doc.getTextWidth(labelText);
    doc.text(labelText, marginX, y);
    doc.setFont('helvetica', 'normal');
    const valueLines = doc.splitTextToSize(value, contentWidth - labelWidth);
    doc.text(valueLines[0] || '', marginX + labelWidth, y);
    y += 14;
    if (valueLines.length > 1) {
      for (let i = 1; i < valueLines.length; i++) {
        ensureSpace(14);
        doc.text(valueLines[i], marginX + labelWidth, y);
        y += 14;
      }
    }
  };

  // Title
  writeHeading(transcript.title, 22);
  y += 4;

  // Metadata
  if (includeMetadata) {
    writeHeading('Transcript Information', 14);
    writeKv('File', transcript.filename);
    writeKv('Created', new Date(transcript.created_at).toLocaleString());
    writeKv('Duration', formatDuration(transcript.duration));
    writeKv('Version', versionLabel);
    if (transcript.speaker_count && transcript.speaker_count > 1) {
      writeKv('Speakers', String(transcript.speaker_count));
    }
    y += 10;
  }

  // Analysis
  if (includeAnalysis && transcript.summary) {
    writeHeading('Summary', 14);
    writeBody(transcript.summary);
  }

  if (includeAnalysis && transcript.key_topics && transcript.key_topics.length > 0) {
    writeHeading('Key Topics', 14);
    for (const topic of transcript.key_topics) writeBullet(topic);
  }

  if (includeAnalysis && transcript.action_items && transcript.action_items.length > 0) {
    writeHeading('Action Items', 14);
    for (const item of transcript.action_items) writeBullet(item);
  }

  if (includeAnalysis && (transcript.sentiment_overall || transcript.emotions)) {
    writeHeading('Analysis', 14);
    if (transcript.sentiment_overall) {
      const scoreText = transcript.sentiment_score !== undefined
        ? ` (${transcript.sentiment_score > 0 ? '+' : ''}${transcript.sentiment_score.toFixed(2)})`
        : '';
      writeKv('Sentiment', `${transcript.sentiment_overall}${scoreText}`);
    }
    if (transcript.emotions && Object.keys(transcript.emotions).length > 0) {
      const sorted = Object.entries(transcript.emotions)
        .filter(([_, v]) => v > 0.1)
        .sort(([, a], [, b]) => b - a);
      for (const [emotion, value] of sorted) {
        writeKv(emotion.charAt(0).toUpperCase() + emotion.slice(1), `${Math.round(value * 100)}%`);
      }
    }
  }

  // Transcript
  writeHeading('Transcript', 14);
  const paras = transcriptContent
    .split(/\n\s*\n|\n/)
    .map(p => p.trim())
    .filter(Boolean);
  for (const para of paras) {
    writeBody(para);
  }

  return doc.output('blob');
}
