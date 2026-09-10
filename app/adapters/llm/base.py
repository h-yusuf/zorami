from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class LLMResponse:
    text: str
    tool_calls: list[dict] = field(default_factory=list)
    latency_ms: int = 0


class LLMAdapter(Protocol):
    async def complete(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        max_tokens: int = 160,
        temperature: float = 0.7,
    ) -> LLMResponse: ...
