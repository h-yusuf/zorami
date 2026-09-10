import ctypes.util
import os
import sys

if sys.platform == "darwin" and ctypes.util.find_library("opus") is None:
    # uv/python-build-standalone tidak mewarisi search path Homebrew macOS
    # (/opt/homebrew/lib atau /usr/local/lib di Intel), jadi ctypes.util.find_library
    # gagal walau `brew install opus` sudah dijalankan. Tambahkan fallback path di sini
    # sekali, sebelum opuslib mencoba memuat library-nya sendiri.
    _fallback_dirs = ":".join(
        p for p in ("/opt/homebrew/lib", "/usr/local/lib") if os.path.isdir(p)
    )
    if _fallback_dirs:
        existing = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
            f"{_fallback_dirs}:{existing}" if existing else _fallback_dirs
        )

import opuslib

_FRAME_SAMPLES = {
    (16000, 60): 960,
    (24000, 60): 1440,
}


def _samples_per_frame(sample_rate: int, frame_duration_ms: int) -> int:
    key = (sample_rate, frame_duration_ms)
    if key not in _FRAME_SAMPLES:
        return int(sample_rate * frame_duration_ms / 1000)
    return _FRAME_SAMPLES[key]


def decode(opus_packet: bytes, sample_rate: int = 16000, frame_duration_ms: int = 60) -> bytes:
    decoder = opuslib.Decoder(sample_rate, 1)
    frame_size = _samples_per_frame(sample_rate, frame_duration_ms)
    return decoder.decode(opus_packet, frame_size)


def encode(pcm: bytes, sample_rate: int = 24000, frame_duration_ms: int = 60) -> bytes:
    encoder = opuslib.Encoder(sample_rate, 1, opuslib.APPLICATION_VOIP)
    frame_size = _samples_per_frame(sample_rate, frame_duration_ms)
    return encoder.encode(pcm, frame_size)
