from dataclasses import dataclass
from typing import Protocol


@dataclass
class TTSResult:
    pcm_audio: bytes
    sample_rate: int
    latency_ms: int = 0


class TTSAdapter(Protocol):
    async def synthesize(self, text: str, *, voice: str) -> TTSResult: ...
