from dataclasses import dataclass
from typing import Protocol


@dataclass
class STTResult:
    text: str
    latency_ms: int = 0


class STTAdapter(Protocol):
    async def transcribe(self, pcm_audio: bytes, *, sample_rate: int = 16000) -> STTResult: ...
