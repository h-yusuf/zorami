import time

import httpx

from app.adapters.search.base import SearchResult


class SearxngAdapter:
    def __init__(self, base_url: str, timeout: float = 4.0):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def search(self, query: str, *, max_results: int = 3) -> SearchResult:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._base_url}/search",
                params={"q": query, "format": "json"},
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        resp.raise_for_status()

        raw_results = resp.json().get("results", [])[:max_results]
        results = [
            {"title": r["title"], "snippet": r["content"], "url": r["url"]} for r in raw_results
        ]
        return SearchResult(results=results, latency_ms=latency_ms)
