/**
 * In-app documentation registry.
 *
 * Every doc page is a markdown file under `/docs/` that's imported here
 * at build time via webpack's asset/source rule. The structure below
 * controls the sidebar order, display titles, and slugs used in URLs.
 *
 * Adding a new page:
 *   1. Create the markdown file under the appropriate folder
 *   2. Add an entry to the right category below
 *   3. The new page is reachable at /docs/{categorySlug}/{pageSlug}
 *
 * No external network calls. No build-time codegen. Just imports.
 */

import { Rocket, BookOpen, Sparkles, GraduationCap, AlertCircle, Library } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ============================================
// Imports — every markdown file in the docs folder
// ============================================

// Getting Started
import gsQuickStart from '../../docs/getting-started/quick-start.md';
import gsInstallation from '../../docs/getting-started/installation.md';
import gsFirstUse from '../../docs/getting-started/first-use.md';

// User Guide
import ugInterface from '../../docs/user-guide/interface-overview.md';
import ugUploading from '../../docs/user-guide/uploading-files.md';
import ugManaging from '../../docs/user-guide/managing-transcripts.md';
import ugProjects from '../../docs/user-guide/projects.md';
import ugSettings from '../../docs/user-guide/settings.md';

// Features
import featTranscription from '../../docs/features/transcription.md';
import featAnalysis from '../../docs/features/analysis.md';
import featAiChat from '../../docs/features/ai-chat.md';
import featSearch from '../../docs/features/search.md';
import featExport from '../../docs/features/export.md';

// Tutorials
import tutBasic from '../../docs/tutorials/basic-workflow.md';
import tutProject from '../../docs/tutorials/project-setup.md';
import tutAdvanced from '../../docs/tutorials/advanced-features.md';

// Troubleshooting
import tsCommon from '../../docs/troubleshooting/common-issues.md';
import tsFaq from '../../docs/troubleshooting/faq.md';

// Reference
import refKeyboard from '../../docs/reference/keyboard-shortcuts.md';
import refFormats from '../../docs/reference/file-formats.md';
import refRequirements from '../../docs/reference/system-requirements.md';

// ============================================
// Types
// ============================================

export interface DocPage {
  /** URL slug for this page (no leading/trailing slashes) */
  slug: string;
  /** Display title in the sidebar and breadcrumbs */
  title: string;
  /** Short one-line summary used in card grids and search results */
  summary?: string;
  /** Raw markdown content imported at build time */
  content: string;
}

export interface DocCategory {
  /** URL slug for the category */
  slug: string;
  /** Display title */
  title: string;
  /** Icon shown in the sidebar header */
  icon: LucideIcon;
  /** Pages in display order */
  pages: DocPage[];
}

// ============================================
// Structure
// ============================================

export const DOCS: DocCategory[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    icon: Rocket,
    pages: [
      { slug: 'quick-start', title: 'Quick Start', summary: 'Get a transcript in five minutes', content: gsQuickStart },
      { slug: 'installation', title: 'Installation', summary: 'Install DeepDebrief on macOS, Windows, or Linux', content: gsInstallation },
      { slug: 'first-use', title: 'First Use', summary: 'Configure DeepDebrief for the first time', content: gsFirstUse },
    ],
  },
  {
    slug: 'user-guide',
    title: 'User Guide',
    icon: BookOpen,
    pages: [
      { slug: 'interface-overview', title: 'Interface Overview', summary: 'Tour of the DeepDebrief window', content: ugInterface },
      { slug: 'uploading-files', title: 'Uploading Files', summary: 'How to add audio and video', content: ugUploading },
      { slug: 'managing-transcripts', title: 'Managing Transcripts', summary: 'Library, archive, trash, bulk operations', content: ugManaging },
      { slug: 'projects', title: 'Projects', summary: 'Group transcripts for cross-recording analysis', content: ugProjects },
      { slug: 'settings', title: 'Settings', summary: 'Transcription model, AI provider, and more', content: ugSettings },
    ],
  },
  {
    slug: 'features',
    title: 'Features',
    icon: Sparkles,
    pages: [
      { slug: 'transcription', title: 'Transcription & Diarisation', summary: 'How DeepDebrief turns audio into labelled text', content: featTranscription },
      { slug: 'analysis', title: 'Analysis', summary: 'Sentiment, emotions, themes, conversation quality', content: featAnalysis },
      { slug: 'ai-chat', title: 'AI Chat', summary: 'Talk to your transcripts and projects', content: featAiChat },
      { slug: 'search', title: 'Search', summary: 'Find anything across transcripts', content: featSearch },
      { slug: 'export', title: 'Export', summary: 'DOCX, PDF, Markdown, JSON, plain text', content: featExport },
    ],
  },
  {
    slug: 'tutorials',
    title: 'Tutorials',
    icon: GraduationCap,
    pages: [
      { slug: 'basic-workflow', title: 'Basic Workflow', summary: 'Upload, transcribe, analyse, export', content: tutBasic },
      { slug: 'project-setup', title: 'Project Setup', summary: 'Organise a research study with projects', content: tutProject },
      { slug: 'advanced-features', title: 'Advanced Features', summary: 'AI Correction, multi-provider, diarisation tuning', content: tutAdvanced },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    icon: AlertCircle,
    pages: [
      { slug: 'common-issues', title: 'Common Issues', summary: 'Fixes for the things people hit most often', content: tsCommon },
      { slug: 'faq', title: 'FAQ', summary: 'Frequently asked questions', content: tsFaq },
    ],
  },
  {
    slug: 'reference',
    title: 'Reference',
    icon: Library,
    pages: [
      { slug: 'keyboard-shortcuts', title: 'Keyboard Shortcuts', summary: 'All available keyboard shortcuts', content: refKeyboard },
      { slug: 'file-formats', title: 'File Formats', summary: 'Supported audio and video formats', content: refFormats },
      { slug: 'system-requirements', title: 'System Requirements', summary: 'Hardware and OS requirements', content: refRequirements },
    ],
  },
];

// ============================================
// Lookup helpers
// ============================================

export function getCategory(categorySlug: string): DocCategory | undefined {
  return DOCS.find((c) => c.slug === categorySlug);
}

export function getPage(categorySlug: string, pageSlug: string): DocPage | undefined {
  return getCategory(categorySlug)?.pages.find((p) => p.slug === pageSlug);
}

export function getDefaultPage(): { categorySlug: string; pageSlug: string } {
  return { categorySlug: 'getting-started', pageSlug: 'quick-start' };
}

/**
 * Search across all docs for a query string. Matches title (highest weight)
 * and content (lower weight). Returns up to maxResults entries, sorted by
 * relevance.
 */
export function searchDocs(query: string, maxResults = 12): Array<{
  category: DocCategory;
  page: DocPage;
  score: number;
  snippet: string;
}> {
  if (!query.trim()) return [];
  const q = query.toLowerCase();

  const results: Array<{ category: DocCategory; page: DocPage; score: number; snippet: string }> = [];

  for (const category of DOCS) {
    for (const page of category.pages) {
      let score = 0;
      const titleLower = page.title.toLowerCase();
      const contentLower = page.content.toLowerCase();

      if (titleLower.includes(q)) score += 10;
      if (titleLower.startsWith(q)) score += 5;
      if (page.summary?.toLowerCase().includes(q)) score += 3;

      // Content match
      const contentIdx = contentLower.indexOf(q);
      if (contentIdx >= 0) {
        score += 1;
        // Add a snippet around the first match
        const start = Math.max(0, contentIdx - 40);
        const end = Math.min(page.content.length, contentIdx + q.length + 80);
        const snippet = (start > 0 ? '…' : '') + page.content.slice(start, end) + (end < page.content.length ? '…' : '');

        if (score > 0) {
          results.push({ category, page, score, snippet });
        }
        continue;
      }

      if (score > 0) {
        results.push({ category, page, score, snippet: page.summary || '' });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
