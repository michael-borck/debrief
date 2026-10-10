// @vitest-environment node
//
// Tests for per-speaker audio extraction.
//
// The ffmpeg invocation is injected, so these exercise the real decision logic —
// turn preparation, filter-graph construction, batching, and path handling — with
// no binary and no media files.
//
// THE SECURITY POSTURE under test: the module resolves the input file from our own
// database and the output location from a main-process dialog. The renderer only
// ever supplies a transcript id and a speaker name, never a path.

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
// CJS require so the spy lands on the same exports object speaker-audio.js sees
// (an ESM namespace object cannot be reconfigured).
const fs = require('node:fs');
import {
  prepareTurns,
  buildFilterGraph,
  batch,
  MAX_TURNS_PER_PASS,
  makeSpeakerAudio,
} from '../public/electron/speaker-audio.js';

/** The module guards on fs.existsSync; the stubbed path never exists here. */
let existsSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
});

afterAll(() => {
  existsSpy.mockRestore();
});

describe('prepareTurns', () => {
  it('applies padding and clamps to the file duration', () => {
    const turns = prepareTurns(
      [{ start: 0, end: 10 }, { start: 95, end: 100 }],
      100, // file is exactly 100s
      0.15
    );
    expect(turns).toEqual([
      { start: 0, end: 10.15 }, // start clamped at 0
      { start: 94.85, end: 100 }, // end clamped at duration
    ]);
  });

  it('works when the duration is unknown', () => {
    const turns = prepareTurns([{ start: 5, end: 10 }], null, 0.15);
    expect(turns).toEqual([{ start: 4.85, end: 10.15 }]);
  });

  it('drops turns that become degenerate after clamping', () => {
    // A turn that ends at (or before) 0 in a 0-length file, or is zero-length
    // after padding, would produce an invalid atrim range.
    // (0,0) clamps end to the 0s duration -> degenerate.
    expect(prepareTurns([{ start: 0, end: 0 }], 0, 0.15)).toEqual([]);
    // (10,10) with padding widens to a usable 0.3s — padding rescues it.
    expect(prepareTurns([{ start: 10, end: 10 }], null, 0.15)).toEqual([
      { start: 9.85, end: 10.15 },
    ]);
  });

  it('drops non-finite turns rather than passing NaN into the filter graph', () => {
    expect(
      prepareTurns(
        [
          { start: NaN, end: 5 },
          { start: 0, end: Infinity },
        ],
        null,
        0.15
      )
    ).toEqual([]);
  });
});

describe('buildFilterGraph', () => {
  it('builds one atrim per turn joined by concat', () => {
    const { filterComplex, outputLabel } = buildFilterGraph([
      { start: 1, end: 2 },
      { start: 5, end: 6 },
    ]);
    expect(filterComplex).toBe(
      '[0:a]atrim=start=1.000:end=2.000,asetpts=PTS-STARTPTS[a0];' +
        '[0:a]atrim=start=5.000:end=6.000,asetpts=PTS-STARTPTS[a1];' +
        '[a0][a1]concat=n=2:v=0:a=1[out]'
    );
    expect(outputLabel).toBe('[out]');
  });

  it('handles a single turn', () => {
    const { filterComplex } = buildFilterGraph([{ start: 3, end: 4 }]);
    expect(filterComplex).toContain('concat=n=1');
  });

  it('throws on an empty turn list', () => {
    expect(() => buildFilterGraph([])).toThrow(/no usable turns/);
  });

  it('throws when a pass exceeds the ffmpeg-safe cap', () => {
    // The whole graph is one argv element and Windows caps the entire command
    // line at 32k characters, so the cap is a portability guard, not a nicety.
    const tooMany = Array.from({ length: MAX_TURNS_PER_PASS + 1 }, (_, i) => ({
      start: i,
      end: i + 1,
    }));
    expect(() => buildFilterGraph(tooMany)).toThrow(/pass too large/);
  });
});

describe('batch', () => {
  it('splits turns into ffmpeg-sized passes', () => {
    const turns = Array.from({ length: MAX_TURNS_PER_PASS * 2 + 1 }, (_, i) => ({
      start: i,
      end: i + 1,
    }));
    const passes = batch(turns);
    expect(passes).toHaveLength(3);
    expect(passes[0]).toHaveLength(MAX_TURNS_PER_PASS);
    expect(passes[2]).toHaveLength(1);
  });

  it('keeps a small set in one pass', () => {
    expect(batch([{ start: 0, end: 1 }])).toHaveLength(1);
  });
});

/** Minimal two-table stub: transcripts row + diarization_turns rows. */
function makeDb(transcript, turns) {
  return {
    prepare: (sql) => ({
      get: (...args) => {
        if (sql.includes('FROM transcripts')) {
          return transcript && args[0] === transcript.id ? transcript : undefined;
        }
        return undefined;
      },
      all: (...args) => {
        if (sql.includes('FROM diarization_turns')) {
          return args[0] === (transcript?.id ?? '__nope__')
            ? turns.map((t, i) => ({
                speaker: t.speaker ?? t[0],
                start_time: t.start ?? t[1],
                end_time: t.end ?? t[2],
                turn_index: i,
              }))
            : [];
        }
        return [];
      },
    }),
  };
}

const transcript = {
  id: 't1',
  title: 'Team Retro.mp3',
  file_path: '/media/team-retro.m4a',
};

describe('makeSpeakerAudio.exportSpeaker', () => {
  function makeService(overrides = {}) {
    const calls = [];
    return {
      calls,
      service: makeSpeakerAudio({
        getDb: () => overrides.db ?? makeDb(transcript, overrides.turns ?? []),
        ffmpegPath: '/ffmpeg',
        runFfmpeg: async (args) => {
          calls.push(args);
          overrides.onRun?.(args);
        },
        getMediaDuration: async () => overrides.duration ?? null,
        showSaveDialog: async () => overrides.savePath ?? '/out/clip.wav',
        tmpDir: overrides.tmpDir,
        ...overrides.deps,
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('export is cancelled cleanly when the user dismisses the dialog', async () => {
    const { service } = makeService({
      turns: [{ speaker: 'A', start: 0, end: 5 }],
      deps: { showSaveDialog: async () => null },
    });
    const result = await service.exportSpeaker({ transcriptId: 't1', speaker: 'A' });
    expect(result).toEqual({ cancelled: true });
  });

  it('refuses an unknown speaker with a helpful message', async () => {
    const { service } = makeService({
      turns: [{ speaker: 'Alice', start: 0, end: 5 }],
    });
    await expect(
      service.exportSpeaker({ transcriptId: 't1', speaker: 'Bob' })
    ).rejects.toThrow(/No diarization turns stored for "Bob".*Re-run diarisation/s);
  });

  it('refuses when the original audio is missing from disk', async () => {
    existsSpy.mockReturnValue(false);
    try {
      const { service } = makeService({ turns: [{ speaker: 'A', start: 0, end: 5 }] });
      await expect(
        service.exportSpeaker({ transcriptId: 't1', speaker: 'A' })
      ).rejects.toThrow(/could not be found on disk/);
    } finally {
      existsSpy.mockReturnValue(true);
    }
  });

  it('makes exactly one ffmpeg pass when turns fit in a single batch', async () => {
    const { service, calls } = makeService({
      turns: [
        { speaker: 'Alice', start: 1, end: 4 },
        { speaker: 'Alice', start: 8, end: 12 },
      ],
    });

    const result = await service.exportSpeaker({ transcriptId: 't1', speaker: 'Alice' });

    expect(result).toMatchObject({ cancelled: false, turns: 2, speaker: 'Alice' });
    expect(calls).toHaveLength(1);
    const args = calls[0];
    expect(args).toContain('-filter_complex');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('atrim=start=0.850:end=4.150');
    expect(graph).toContain('concat=n=2');
    expect(args[args.indexOf('-map') + 1]).toBe('[out]');
    expect(args[args.length - 1]).toBe('/out/clip.wav');
  });

  it('pads turn boundaries for the export', async () => {
    const { service, calls } = makeService({
      turns: [{ speaker: 'Alice', start: 10, end: 20 }],
      duration: 100,
    });

    await service.exportSpeaker({ transcriptId: 't1', speaker: 'Alice' });

    const graph = calls[0][calls[0].indexOf('-filter_complex') + 1];
    expect(graph).toContain('atrim=start=9.850:end=20.150');
  });

  it('splits into batch passes plus a concat pass when over the cap', async () => {
    const turns = Array.from({ length: MAX_TURNS_PER_PASS + 5 }, (_, i) => ({
      speaker: 'Alice',
      start: i * 2,
      end: i * 2 + 1,
    }));
    const { service, calls } = makeService({ turns });

    const result = await service.exportSpeaker({ transcriptId: 't1', speaker: 'Alice' });

    expect(result.turns).toBe(MAX_TURNS_PER_PASS + 5);
    // MAX_TURNS_PER_PASS+5 turns -> 2 extraction passes + 1 concat pass.
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(
      expect.arrayContaining(['-f', 'concat', '-safe', '0', '-c', 'copy'])
    );
  });

  it('never lets a renderer-supplied path near ffmpeg', async () => {
    // The API surface takes transcriptId + speaker only. The output path comes
    // from the injected dialog, the input from the DB row.
    const { service, calls } = makeService({
      turns: [{ speaker: 'Alice', start: 0, end: 5 }],
      savePath: '/chosen/by/dialog.wav',
    });

    await service.exportSpeaker({ transcriptId: 't1', speaker: 'Alice' });

    const input = calls[0][calls[0].indexOf('-i') + 1];
    expect(input).toBe('/media/team-retro.m4a'); // from the DB, not the caller
    expect(calls[0].at(-1)).toBe('/chosen/by/dialog.wav'); // from the dialog
  });

  it('cleans up its temp directory even when ffmpeg fails', async () => {
    const fs = require('node:fs');
    const rmSync = vi.spyOn(fs, 'rmSync');
    const { service } = makeService({
      turns: [{ speaker: 'Alice', start: 0, end: 5 }],
      deps: {
        runFfmpeg: async () => {
          throw new Error('ffmpeg exploded');
        },
      },
    });

    await expect(
      service.exportSpeaker({ transcriptId: 't1', speaker: 'Alice' })
    ).rejects.toThrow('ffmpeg exploded');
    expect(rmSync).toHaveBeenCalledWith(
      expect.stringContaining('debrief-clip-'),
      expect.objectContaining({ recursive: true, force: true })
    );
    rmSync.mockRestore();
  });

  it('rejects a blank speaker name before any database or dialog work', async () => {
    const prepare = vi.fn();
    const { service } = makeService({
      db: { prepare },
      turns: [],
    });

    await expect(
      service.exportSpeaker({ transcriptId: 't1', speaker: '   ' })
    ).rejects.toThrow(/invalid speaker/);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('makeSpeakerAudio.speakers', () => {
  it('summarises per speaker with turn counts and total seconds', () => {
    const db = makeDb(
      transcript,
      [
        { speaker: 'Alice', start: 0, end: 10 },
        { speaker: 'Bob', start: 10, end: 12 },
        { speaker: 'Alice', start: 12, end: 20 },
      ]
    );
    const service = makeSpeakerAudio({
      getDb: () => db,
      ffmpegPath: '/ffmpeg',
      runFfmpeg: async () => {},
      getMediaDuration: async () => null,
      showSaveDialog: async () => null,
    });

    const speakers = service.speakers('t1');
    const alice = speakers.find((s) => s.speaker === 'Alice');
    const bob = speakers.find((s) => s.speaker === 'Bob');
    expect(alice).toEqual({ speaker: 'Alice', turns: 2, seconds: 18 });
    expect(bob).toEqual({ speaker: 'Bob', turns: 1, seconds: 2 });
  });

  it('returns nothing for a transcript without turns', () => {
    const service = makeSpeakerAudio({
      getDb: () => makeDb(transcript, []),
      ffmpegPath: '/ffmpeg',
      runFfmpeg: async () => {},
      getMediaDuration: async () => null,
      showSaveDialog: async () => null,
    });
    expect(service.speakers('t1')).toEqual([]);
  });
});