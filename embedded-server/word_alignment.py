"""Word-level speaker assignment for Debrief's /analyse-v2 endpoint.

WHY THIS EXISTS
Upstream speech-analyser transcribes with ``word_timestamps=False`` and its
``Segment`` dataclass cannot carry words, so Debrief's sentence timings were
interpolated estimates distributed within each Whisper chunk. The accepted
long-term fix is an upstream PR (see SPEAKER_INSIGHTS_PLAN.md item 6); until
that lands, Debrief's own sidecar server computes word timings directly from
faster-whisper and uses the helpers here to attach a speaker to every word.

Assigning speakers per WORD rather than per segment also fixes the classic
misattribution where one Whisper segment straddles a speaker change: the
segment used to get whichever speaker overlapped most, and the other
speaker's half was credited to the wrong person. Sentence construction in
the Electron main process can now split at the exact word where the voice
changes.

Pure functions, stdlib only, so they are unit-testable without the bundled
models: ``python3 -m unittest test_word_alignment``.
"""
from __future__ import annotations

from bisect import bisect_right
from typing import Iterable, Optional, Sequence


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def speaker_for_span(
    start: float,
    end: float,
    turns: Sequence[dict],
    turn_starts: Optional[Sequence[float]] = None,
) -> Optional[str]:
    """Speaker whose diarization turn overlaps [start, end] the most.

    `turns` are dicts with start/end/speaker, sorted by start. Ties keep the
    earlier turn (stable, matches upstream _assign_speakers semantics).
    Returns None when nothing overlaps — silence, or diarization off.
    """
    if not turns:
        return None
    if turn_starts is None:
        turn_starts = [t["start"] for t in turns]
    # Candidate window: turns starting at/before `end`, plus the one started
    # just before `start` (it may span the whole word).
    hi = bisect_right(turn_starts, end)
    lo = max(0, bisect_right(turn_starts, start) - 1)
    best_speaker: Optional[str] = None
    best_overlap = 0.0
    for turn in turns[lo:hi]:
        seconds = _overlap(start, end, turn["start"], turn["end"])
        if seconds > best_overlap:
            best_overlap = seconds
            best_speaker = turn["speaker"]
    return best_speaker


def assign_word_speakers(words: Iterable[dict], turns: Sequence[dict]) -> list[dict]:
    """Return copies of `words` with a `speaker` key added (None if unknown)."""
    turn_starts = [t["start"] for t in turns]
    assigned = []
    for word in words:
        speaker = speaker_for_span(
            float(word["start"]), float(word["end"]), turns, turn_starts
        )
        assigned.append({**word, "speaker": speaker})
    return assigned


def dominant_speaker(words: Iterable[dict]) -> Optional[str]:
    """Speaker accounting for the most word-time in `words`, else None."""
    totals: dict[str, float] = {}
    for word in words:
        speaker = word.get("speaker")
        if not speaker:
            continue
        totals[speaker] = totals.get(speaker, 0.0) + max(
            0.0, float(word["end"]) - float(word["start"])
        )
    if not totals:
        return None
    return max(totals.items(), key=lambda kv: kv[1])[0]


def build_segments(raw_segments: Iterable[object], turns: Sequence[dict]) -> list[dict]:
    """Shape faster-whisper segments (with .words) for the /analyse-v2 reply.

    Each raw segment needs start/end/text/avg_logprob attributes and an
    optional words iterable of objects with start/end/word/probability.
    Word dicts gain per-word speakers; the segment speaker is the dominant
    word speaker, falling back to whole-segment overlap when there are no
    words (alignment can omit words for very short/noisy segments).
    """
    turn_starts = [t["start"] for t in turns]
    segments = []
    for seg in raw_segments:
        raw_words = []
        for w in getattr(seg, "words", None) or []:
            raw_words.append(
                {
                    "word": w.word,
                    "start": round(float(w.start), 3),
                    "end": round(float(w.end), 3),
                    "probability": round(float(w.probability), 4)
                    if w.probability is not None
                    else None,
                }
            )
        words = [
            {
                **w,
                "speaker": speaker_for_span(w["start"], w["end"], turns, turn_starts),
            }
            for w in raw_words
        ]
        speaker = dominant_speaker(words) or speaker_for_span(
            float(seg.start), float(seg.end), turns, turn_starts
        )
        segments.append(
            {
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": seg.text.strip(),
                "speaker": speaker,
                "avg_logprob": float(seg.avg_logprob)
                if seg.avg_logprob is not None
                else None,
                "words": words,
            }
        )
    return segments
