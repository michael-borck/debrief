"""Unit tests for word_alignment. Run: python3 -m unittest test_word_alignment

Stdlib only — these exercise the pure assignment logic that decides which
speaker owns each word, without needing the bundled Whisper/pyannote models.
"""
import unittest
from types import SimpleNamespace

from word_alignment import (
    assign_word_speakers,
    build_segments,
    dominant_speaker,
    speaker_for_span,
)

TURNS = [
    {"start": 0.0, "end": 5.0, "speaker": "SPEAKER_00"},
    {"start": 5.0, "end": 9.0, "speaker": "SPEAKER_01"},
    {"start": 12.0, "end": 15.0, "speaker": "SPEAKER_00"},
]


def word(text, start, end, prob=0.9):
    return {"word": text, "start": start, "end": end, "probability": prob}


class SpeakerForSpanTests(unittest.TestCase):
    def test_picks_max_overlap(self):
        self.assertEqual(speaker_for_span(4.0, 6.0, TURNS), "SPEAKER_00")
        self.assertEqual(speaker_for_span(4.9, 7.0, TURNS), "SPEAKER_01")

    def test_word_inside_one_turn(self):
        self.assertEqual(speaker_for_span(6.0, 6.5, TURNS), "SPEAKER_01")

    def test_silence_gap_is_none(self):
        self.assertIsNone(speaker_for_span(10.0, 11.0, TURNS))

    def test_no_turns_is_none(self):
        self.assertIsNone(speaker_for_span(0.0, 1.0, []))

    def test_span_before_first_turn_still_checks_spanning_turn(self):
        turns = [{"start": 2.0, "end": 8.0, "speaker": "A"}]
        self.assertEqual(speaker_for_span(7.0, 7.5, turns), "A")
        self.assertIsNone(speaker_for_span(0.0, 1.0, turns))


class AssignWordSpeakersTests(unittest.TestCase):
    def test_speaker_change_mid_segment_is_preserved_per_word(self):
        # The core fix: a segment straddling a boundary keeps both voices.
        words = [word("hello", 4.5, 4.9), word("there", 5.2, 5.6)]
        assigned = assign_word_speakers(words, TURNS)
        self.assertEqual(
            [w["speaker"] for w in assigned], ["SPEAKER_00", "SPEAKER_01"]
        )
        # Originals are untouched.
        self.assertNotIn("speaker", words[0])

    def test_dominant_speaker_uses_word_time(self):
        words = assign_word_speakers(
            [word("a", 0.0, 2.0), word("b", 5.0, 5.5)], TURNS
        )
        self.assertEqual(dominant_speaker(words), "SPEAKER_00")

    def test_dominant_speaker_none_without_speakers(self):
        self.assertIsNone(dominant_speaker([word("a", 10.0, 11.0)]))


class BuildSegmentsTests(unittest.TestCase):
    def test_shapes_words_and_assigns_speakers(self):
        seg = SimpleNamespace(
            start=4.0,
            end=6.0,
            text=" hello there ",
            avg_logprob=-0.25,
            words=[
                SimpleNamespace(word=" hello", start=4.5, end=4.9, probability=0.98),
                SimpleNamespace(word=" there", start=5.2, end=5.6, probability=0.87),
            ],
        )
        [out] = build_segments([seg], TURNS)
        self.assertEqual(out["text"], "hello there")
        self.assertEqual(out["avg_logprob"], -0.25)
        self.assertEqual(out["speaker"], "SPEAKER_00")  # longer word wins tie of counts
        self.assertEqual(
            [(w["word"], w["speaker"]) for w in out["words"]],
            [(" hello", "SPEAKER_00"), (" there", "SPEAKER_01")],
        )

    def test_segment_without_words_falls_back_to_overlap(self):
        seg = SimpleNamespace(
            start=6.0, end=8.0, text="no words", avg_logprob=None, words=None
        )
        [out] = build_segments([seg], TURNS)
        self.assertEqual(out["speaker"], "SPEAKER_01")
        self.assertEqual(out["words"], [])
        self.assertIsNone(out["avg_logprob"])

    def test_no_diarization_gives_null_speakers(self):
        seg = SimpleNamespace(
            start=0.0,
            end=1.0,
            text="hi",
            avg_logprob=-0.1,
            words=[SimpleNamespace(word="hi", start=0.0, end=0.5, probability=1.0)],
        )
        [out] = build_segments([seg], [])
        self.assertIsNone(out["speaker"])
        self.assertIsNone(out["words"][0]["speaker"])


if __name__ == "__main__":
    unittest.main()
