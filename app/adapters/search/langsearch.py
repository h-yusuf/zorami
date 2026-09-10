import time

import httpx

from app.adapters.search.base import SearchResult


class LangSearchAdapter:
    """Adapter buat LangSearch API (https://langsearch.com) - search berbayar
    BYOK, bukan bagian arsitektur inti nol-biaya. Alternatif ke SearxngAdapter
    (self-host gratis) - dipilih user yang gak mau host SearXNG sendiri."""

    def __init__(self, api_key: str, timeout: float = 8.0):
        self._api_key = api_key
        self._timeout = timeout

    async def search(self, query: str, *, max_results: int = 3) -> SearchResult:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.langsearch.com/v1/web-search",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"query": query, "summary": True, "count": max_results},
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        resp.raise_for_status()

        raw_results = resp.json()["data"]["webPages"]["value"][:max_results]
        results = [
            {
                "title": r["name"],
                "snippet": r.get("summary") or r.get("snippet", ""),
                "url": r["url"],
            }
            for r in raw_results
        ]
        return SearchResult(results=results, latency_ms=latency_ms)
