from dataclasses import dataclass
from typing import Protocol


@dataclass
class SearchResult:
    results: list[dict]
    latency_ms: int = 0


class SearchAdapter(Protocol):
    async def search(self, query: str, *, max_results: int = 3) -> SearchResult: ...
