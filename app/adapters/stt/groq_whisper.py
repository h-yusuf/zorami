import io
import time
import wave

import httpx

from app.adapters.stt.base import STTResult


def _pcm_to_wav_bytes(pcm_audio: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit PCM
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_audio)
    return buf.getvalue()


class GroqWhisperAdapter:
    def __init__(self, api_key: str, model: str = "whisper-large-v3-turbo", timeout: float = 15.0):
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def transcribe(self, pcm_audio: bytes, *, sample_rate: int = 16000) -> STTResult:
        wav_bytes = _pcm_to_wav_bytes(pcm_audio, sample_rate)

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                files={"file": ("audio.wav", wav_bytes, "audio/wav")},
                data={"model": self._model, "language": "id"},
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        resp.raise_for_status()

        return STTResult(text=resp.json()["text"], latency_ms=latency_ms)
