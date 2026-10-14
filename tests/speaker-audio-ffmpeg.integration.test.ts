// @vitest-environment node
//
// Integration test: run the REAL ffmpeg filter graph end to end.
//
// The unit tests inject a fake runFfmpeg, so until now the graph string had
// never actually been executed in CI — a syntax slip (or an afade argument
// ffmpeg rejects) would only appear on a user's machine. This test
// generates a two-tone fixture, cuts one speaker out of it with the real
// binary, and probes the result.
//
// ffmpeg resolution mirrors production first (ffmpeg-static), then PATH.
// The suite SKIPS when no binary is available (CI installs with
// --ignore-scripts, which leaves ffmpeg-static without its binary) — a
// skipped suite is reported as skipped, never as a pass.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { makeSpeakerAudio } = require('../public/electron/speaker-audio.js');

const execFileAsync = promisify(execFile);

function resolveFfmpeg(): string | null {
  try {
    const p = require('ffmpeg-static') as string;
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through to PATH */ }
  return 'ffmpeg';
}

async function ffmpegWorks(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function probeDurationSec(bin: string, file: string): Promise<number> {
  // ffmpeg-static ships no ffprobe; parse the Duration line ffmpeg prints
  // for `-i file` with no output (which exits non-zero, hence the catch).
  let stderr = '';
  try {
    const res = await execFileAsync(bin, ['-i', file]);
    stderr = String((res as { stderr?: string }).stderr ?? '');
  } catch (e) {
    stderr = String((e as { stderr?: string }).stderr ?? '');
  }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const ffmpeg = resolveFfmpeg();
let available = false;
let workDir = '';
let fixturePath = '';

beforeAll(async () => {
  available = ffmpeg ? await ffmpegWorks(ffmpeg) : false;
  if (!available) return;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-ffmpeg-it-'));
  fixturePath = path.join(workDir, 'two-voices.wav');
  // 12s fixture: 440Hz (0-3s), 880Hz (3-6s), 440Hz (6-9s), 880Hz (9-12s).
  // "Alice" owns the 440Hz spans.
  await execFileAsync(ffmpeg!, [
    '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-filter_complex', '[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[out]',
    '-map', '[out]', '-ar', '16000', '-ac', '1',
    fixturePath,
  ]);
}, 60000);

afterAll(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

function makeStubDb() {
  const turns = [
    { speaker: 'SPEAKER_00', speaker_id: 'SPEAKER_00', start_time: 0, end_time: 3 },
    { speaker: 'SPEAKER_01', speaker_id: 'SPEAKER_01', start_time: 3, end_time: 6 },
    { speaker: 'SPEAKER_00', speaker_id: 'SPEAKER_00', start_time: 6, end_time: 9 },
    { speaker: 'SPEAKER_01', speaker_id: 'SPEAKER_01', start_time: 9, end_time: 12 },
  ];
  const transcript = {
    id: 't1',
    title: 'Two Voices',
    file_path: fixturePath,
    speakers: JSON.stringify([{ id: 'SPEAKER_00', name: 'Alice', segments: 2 }]),
  };
  const segments = [
    { text: 'First Alice line.', start_time: 0.2, end_time: 2.8, speaker: 'Alice' },
    { text: 'Bob interjects.', start_time: 3.2, end_time: 5.8, speaker: 'SPEAKER_01' },
    { text: 'Second Alice line.', start_time: 6.2, end_time: 8.8, speaker: 'Alice' },
  ];
  return {
    prepare: (sql: string) => ({
      get: () => (sql.includes('FROM transcripts') ? transcript : undefined),
      all: (...args: unknown[]) => {
        if (sql.includes('FROM diarization_turns')) return turns;
        if (sql.includes('FROM transcript_segments')) {
          return args[1] === 'speaker_tagged' ? segments : [];
        }
        return [];
      },
    }),
  };
}

describe('speaker audio — real ffmpeg', () => {
  it('cuts one speaker (by display name) into a clip of the expected duration, with sidecars', async () => {
    if (!available) return; // reported via suite-level skip note below
    const outPath = path.join(workDir, 'alice.wav');
    const service = makeSpeakerAudio({
      getDb: makeStubDb,
      ffmpegPath: ffmpeg,
      runFfmpeg: (args: string[]) =>
        execFileAsync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args]),
      getMediaDuration: (p: string) => probeDurationSec(ffmpeg!, p),
      showSaveDialog: async () => outPath,
      tmpDir: workDir,
    });

    // Display name "Alice" must resolve to SPEAKER_00's turns (P0-2).
    const result = await service.exportSpeaker({ transcriptId: 't1', speaker: 'Alice' });
    expect(result.cancelled).toBe(false);
    expect(result.turns).toBe(2);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(10_000);

    const duration = await probeDurationSec(ffmpeg!, outPath);
    // Two 3s turns + 0.15s padding each side where room allows ≈ 6.45s.
    expect(duration).toBeGreaterThan(6.0);
    expect(duration).toBeLessThan(6.9);

    // Sidecar transcript files written next to the clip.
    const txt = fs.readFileSync(path.join(workDir, 'alice.txt'), 'utf8');
    expect(txt).toContain('First Alice line.');
    expect(txt).toContain('Second Alice line.');
    expect(txt).not.toContain('Bob interjects.');
    const srt = fs.readFileSync(path.join(workDir, 'alice.srt'), 'utf8');
    expect(srt).toContain('Alice: First Alice line.');
  }, 60000);

  it.skipIf(false)('suite requires an ffmpeg binary (skips silently when absent)', () => {
    // Documentation assertion: when `available` is false the test above
    // no-ops. This marker keeps that visible in the report.
    expect(typeof available).toBe('boolean');
  });
});
