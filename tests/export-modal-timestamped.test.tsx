// Tests for the ExportModal's timestamped export surface.
//
// Item 5 of the speaker-insights plan: per-speaker transcript export with
// timestamps. The formatters are covered in timestamped-export.test.ts; these
// cover the wiring — that the modal offers the formats, filters by speaker, and
// labels timestamp precision rather than shipping interpolated timings unlabelled
// (the plan's acceptance criterion).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportModal } from '../src/components/ExportModal';
import { ModalStackProvider } from '../src/components/Modal';
import type { Transcript } from '../src/types';

vi.mock('../src/services/exportService', () => ({
  buildDocx: vi.fn(async () => new Blob()),
  buildPdf: vi.fn(() => new Blob()),
}));

const baseTranscript = {
  id: 't1',
  title: 'Team Retro',
  filename: 'retro.mp3',
  full_text: 'Alice speaks. Bob replies.',
  processed_text: '',
  validated_text: 'Alice speaks. Bob replies.', // default version is 'corrected'; without this the Export button is disabled
  speakers: [{ id: 'SPEAKER_00', name: 'Alice', segments: 2 }],
  speaker_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as Transcript;

const segments = [
  { id: 1, transcript_id: 't1', sentence_index: 0, text: 'Alice speaks.', start_time: 0.5, end_time: 3.2, speaker: 'Alice', version: 'original', word_count: 2, created_at: '', updated_at: '' },
  { id: 2, transcript_id: 't1', sentence_index: 1, text: 'Bob replies.', start_time: 3.4, end_time: 6.0, speaker: 'Bob', version: 'original', word_count: 2, created_at: '', updated_at: '' },
];

function mockApi({ turns = 2 }: { turns?: number }) {
  return {
    segments: { getByTranscript: vi.fn(async () => segments) },
    db: {
      diarizationTurns: { count: vi.fn(async () => turns) },
    },
  };
}

async function openModal(api: ReturnType<typeof mockApi>) {
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  const utils = render(
    <ModalStackProvider>
      <ExportModal transcript={baseTranscript} isOpen onClose={vi.fn()} />
    </ModalStackProvider>
  );
  // Wait for the segments fetch to settle.
  await vi.waitFor(() => expect(api.segments.getByTranscript).toHaveBeenCalled());
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('ExportModal timestamped formats', () => {
  it('offers subtitle and timestamped text formats', async () => {
    await openModal(mockApi({}));
    const select = screen.getByDisplayValue(/Markdown/i) as HTMLSelectElement;
    const options = [...select.options].map((o) => o.value);
    expect(options).toContain('srt');
    expect(options).toContain('vtt');
    expect(options).toContain('timestamped-txt');
  });

  it('lists a per-speaker filter from the stored segments', async () => {
    await openModal(mockApi({}));
    fireEvent.change(screen.getByDisplayValue(/Markdown/i), { target: { value: 'srt' } });
    const speakerSelect = await screen.findByDisplayValue('All speakers');
    const names = [...(speakerSelect as HTMLSelectElement).options].map((o) => o.text);
    expect(names).toContain('Alice only');
    expect(names).toContain('Bob only');
  });

  it('exports every speaker to SRT with real timestamps', async () => {
    const api = mockApi({});
    await openModal(api);

    fireEvent.change(screen.getByDisplayValue(/Markdown/i), { target: { value: 'srt' } });
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    const text = await blob.text();

    expect(text).toContain('00:00:00,500 --> 00:00:03,200');
    expect(text).toContain('Alice: Alice speaks.');
    expect(text).toContain('Bob: Bob replies.');
  });

  it('exports a single speaker on request', async () => {
    const api = mockApi({});
    await openModal(api);

    fireEvent.change(screen.getByDisplayValue(/Markdown/i), { target: { value: 'timestamped-txt' } });
    fireEvent.change(await screen.findByDisplayValue('All speakers'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    const text = await blob.text();

    expect(text).toContain('Alice speaks.');
    expect(text).not.toContain('Bob replies.');
    expect(text).toContain('Speaker: Alice');
  });

  it('labels interpolated timings as estimates when no turns are stored', async () => {
    // A transcript imported before turn persistence has no turns. The export
    // must not present its guessed sentence times as exact.
    const api = mockApi({ turns: 0 });
    await openModal(api);

    fireEvent.change(screen.getByDisplayValue(/Markdown/i), { target: { value: 'timestamped-txt' } });
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    const text = await blob.text();

    expect(text).toMatch(/estimates/i);
    expect(text).toMatch(/drift/i);
  });

  it('claims diarization precision when turns exist', async () => {
    const api = mockApi({ turns: 3 });
    await openModal(api);

    fireEvent.change(screen.getByDisplayValue(/Markdown/i), { target: { value: 'timestamped-txt' } });
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    const text = await blob.text();

    expect(text).toMatch(/diarization turns/i);
    expect(text).not.toMatch(/estimates/i);
  });

  it('hides the metadata toggles for subtitle formats', async () => {
    await openModal(mockApi({}));
    fireEvent.change(screen.getByDisplayValue(/Markdown/i), { target: { value: 'srt' } });

    // 'Timestamp Handling' and 'Include Additional Data' do not apply to cues.
    expect(screen.queryByText('Timestamp Handling')).toBeNull();
    expect(screen.queryByText(/Include Additional Data/i)).toBeNull();
    // The speaker filter IS shown.
    expect(screen.getByDisplayValue('All speakers')).toBeDefined();
  });

  it('skips segments with no usable timing rather than stamping them at zero', async () => {
    const api = mockApi({});
    api.segments.getByTranscript = vi.fn(async () => [
      ...segments,
      { ...segments[0], id: 9, text: 'legacy line', start_time: null, end_time: null },
    ]);
    await openModal(api);

    fireEvent.change(screen.getByDisplayValue(/Markdown/i), { target: { value: 'srt' } });
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    const text = await blob.text();

    expect(text).not.toContain('legacy line');
    expect(text).not.toContain('00:00:00,000 --> 00:00:00,000');
  });
});