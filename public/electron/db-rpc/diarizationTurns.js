// Per-domain RPC for diarization_turns — the raw pyannote speaker turns.
//
// WHY THIS EXISTS
// Turns were computed during import and then discarded: fileProcessor counted the
// distinct speakers from transcriptResult.speakerTurns and dropped the turns. That
// left no record of where one speaker stopped and another started at true
// resolution.
//
// transcript_segments cannot substitute. Its sentence timings are interpolated —
// electron.js distributes each Whisper chunk's duration across its sentences by
// word count — so they are an estimate of where speech happened, whereas a turn is
// the diarizer's actual boundary. Per-speaker audio clipping needs the real thing:
// cutting on estimated sentence boundaries clips mid-word and drifts audibly.
//
// All values are bound; the only interpolated SQL is a placeholder count.

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`invalid transcript id: ${JSON.stringify(id)}`);
  }
}

function assertTurn(turn, index) {
  const at = `turn[${index}]`;
  if (!turn || typeof turn !== 'object') {
    throw new Error(`${at} must be an object`);
  }
  if (typeof turn.speaker !== 'string' || turn.speaker.length === 0) {
    throw new Error(`${at}.speaker must be a non-empty string`);
  }
  const start = Number(turn.start);
  const end = Number(turn.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`${at} has non-numeric start/end`);
  }
  // A turn that ends before it starts (or is zero-length) would produce a
  // negative ffmpeg trim range and fail the whole export.
  if (end <= start) {
    throw new Error(`${at} ends (${end}) at or before it starts (${start})`);
  }
  return { speaker: turn.speaker, start, end };
}

function makeDiarizationTurns(getDb) {
  return {
    /**
     * Replace all turns for a transcript with `turns`, in one transaction.
     *
     * Replace-not-merge matches how re-diarisation works: a fresh run produces a
     * complete new set, and stale turns from a previous run would be wrong for
     * every new boundary.
     */
    save(transcriptId, turns) {
      assertId(transcriptId);
      if (!Array.isArray(turns)) {
        throw new Error('save requires an array of turns');
      }

      const normalised = turns.map(assertTurn);

      const db = getDb();
      const insert = db.prepare(
        `INSERT INTO diarization_turns (transcript_id, turn_index, speaker, start_time, end_time)
         VALUES (?, ?, ?, ?, ?)`
      );

      const writeAll = db.transaction((rows) => {
        db.prepare('DELETE FROM diarization_turns WHERE transcript_id = ?').run(transcriptId);
        for (let i = 0; i < rows.length; i++) {
          insert.run(transcriptId, i, rows[i].speaker, rows[i].start, rows[i].end);
        }
      });
      writeAll(normalised);

      return { saved: normalised.length };
    },

    /** All turns for a transcript, in recording order. */
    listByTranscript(transcriptId) {
      assertId(transcriptId);
      return getDb()
        .prepare(
          `SELECT turn_index, speaker, start_time, end_time
           FROM diarization_turns WHERE transcript_id = ? ORDER BY turn_index`
        )
        .all(transcriptId);
    },

    /**
     * Turns grouped by speaker, each group in recording order.
     *
     * This is what the audio clipper consumes: for each speaker, the ordered
     * ranges to cut. Uses JS grouping rather than SQL aggregation so the ordering
     * within each speaker is explicit.
     */
    listBySpeaker(transcriptId) {
      const turns = this.listByTranscript(transcriptId);
      const bySpeaker = new Map();
      for (const turn of turns) {
        const bucket = bySpeaker.get(turn.speaker);
        if (bucket) bucket.push({ start: turn.start_time, end: turn.end_time });
        else bySpeaker.set(turn.speaker, [{ start: turn.start_time, end: turn.end_time }]);
      }
      return Object.fromEntries(bySpeaker);
    },

    deleteByTranscript(transcriptId) {
      assertId(transcriptId);
      const info = getDb()
        .prepare('DELETE FROM diarization_turns WHERE transcript_id = ?')
        .run(transcriptId);
      return { changes: info.changes };
    },

    count(transcriptId) {
      assertId(transcriptId);
      const row = getDb()
        .prepare('SELECT COUNT(*) AS c FROM diarization_turns WHERE transcript_id = ?')
        .get(transcriptId);
      return row?.c ?? 0;
    },
  };
}

function register(ipcMain, getDb) {
  const api = makeDiarizationTurns(getDb);
  ipcMain.handle('diarization-turns:save', (_e, transcriptId, turns) =>
    api.save(transcriptId, turns)
  );
  ipcMain.handle('diarization-turns:list-by-transcript', (_e, transcriptId) =>
    api.listByTranscript(transcriptId)
  );
  ipcMain.handle('diarization-turns:list-by-speaker', (_e, transcriptId) =>
    api.listBySpeaker(transcriptId)
  );
  ipcMain.handle('diarization-turns:delete-by-transcript', (_e, transcriptId) =>
    api.deleteByTranscript(transcriptId)
  );
  ipcMain.handle('diarization-turns:count', (_e, transcriptId) => api.count(transcriptId));
}

module.exports = { register, makeDiarizationTurns };
