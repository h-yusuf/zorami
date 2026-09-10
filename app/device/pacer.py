import asyncio
from collections.abc import AsyncIterator


async def pace_frames(frames: list[bytes], frame_duration_ms: int = 60) -> AsyncIterator[bytes]:
    """Kirim frame seirama waktu nyata, tanpa pre-buffer.

    Antrean decode device hanya menampung ~20 frame (1.2 detik) dan kelebihan
    kirim dibuang diam-diam (spec §4.6). Proyek pembanding punya bug
    PRE_BUFFER_COUNT=5 yang membanjiri RX device dalam 10ms dan memutus
    playback setelah satu suku kata - jangan ulangi itu: frame pertama boleh
    langsung, sisanya WAJIB menunggu penuh.
    """
    frame_interval = frame_duration_ms / 1000.0
    for i, frame in enumerate(frames):
        if i > 0:
            await asyncio.sleep(frame_interval)
        yield frame
