import struct

from app.device.endpointer import Endpointer


def _silent_frame(n_samples: int = 960) -> bytes:
    return struct.pack(f"<{n_samples}h", *([0] * n_samples))


def _loud_frame(n_samples: int = 960, amplitude: int = 8000) -> bytes:
    return struct.pack(f"<{n_samples}h", *([amplitude, -amplitude] * (n_samples // 2)))


def test_speech_start_on_first_loud_frame():
    ep = Endpointer(silence_ms=800, sample_rate=16000, frame_ms=60)

    assert ep.feed(_silent_frame()) is None
    event = ep.feed(_loud_frame())
    assert event == "speech_start"


def test_speech_end_after_silence_threshold():
    ep = Endpointer(silence_ms=180, sample_rate=16000, frame_ms=60)

    ep.feed(_loud_frame())
    assert ep.feed(_silent_frame()) is None
    assert ep.feed(_silent_frame()) is None
    event = ep.feed(_silent_frame())
    assert event == "speech_end"


def test_no_event_during_continuous_speech():
    ep = Endpointer(silence_ms=800, sample_rate=16000, frame_ms=60)

    ep.feed(_loud_frame())
    for _ in range(5):
        assert ep.feed(_loud_frame()) is None


def test_brief_silence_does_not_end_speech():
    ep = Endpointer(silence_ms=800, sample_rate=16000, frame_ms=60)

    ep.feed(_loud_frame())
    assert ep.feed(_silent_frame()) is None
    assert ep.feed(_silent_frame()) is None
    event = ep.feed(_loud_frame())
    assert event is None
