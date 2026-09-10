import asyncio
import io
import time
import wave

from app.adapters.tts.base import TTSResult


class PiperAdapter:
    def __init__(self, binary_path: str, model_path: str):
        self._binary_path = binary_path
        self._model_path = model_path

    async def synthesize(self, text: str, *, voice: str) -> TTSResult:
        start = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            self._binary_path,
            "--model",
            self._model_path,
            "--output_file",
            "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate(input=text.encode("utf-8"))
        latency_ms = int((time.monotonic() - start) * 1000)

        with wave.open(io.BytesIO(stdout), "rb") as wf:
            pcm = wf.readframes(wf.getnframes())
            sample_rate = wf.getframerate()

        return TTSResult(pcm_audio=pcm, sample_rate=sample_rate, latency_ms=latency_ms)
