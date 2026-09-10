import audioop
from typing import Literal

EndpointEvent = Literal["speech_start", "speech_end"]


class Endpointer:
    """VAD sisi server berbasis energi RMS per frame.

    Device tidak pernah mengirim sinyal akhir-ucapan di mode auto/realtime
    (spec §4.3) - bridge yang wajib mendeteksinya sendiri dari stream PCM
    yang sudah di-decode dari Opus.
    """

    _ENERGY_THRESHOLD = 500  # ambang RMS 16-bit PCM; titik awal, perlu tuning dengan device sungguhan

    def __init__(self, silence_ms: int = 800, sample_rate: int = 16000, frame_ms: int = 60):
        self._silence_frames_needed = max(1, silence_ms // frame_ms)
        self._in_speech = False
        self._consecutive_silence_frames = 0

    def feed(self, pcm_frame: bytes) -> EndpointEvent | None:
        energy = audioop.rms(pcm_frame, 2)
        is_loud = energy >= self._ENERGY_THRESHOLD

        if not self._in_speech:
            if is_loud:
                self._in_speech = True
                self._consecutive_silence_frames = 0
                return "speech_start"
            return None

        if is_loud:
            self._consecutive_silence_frames = 0
            return None

        self._consecutive_silence_frames += 1
        if self._consecutive_silence_frames >= self._silence_frames_needed:
            self._in_speech = False
            self._consecutive_silence_frames = 0
            return "speech_end"
        return None
