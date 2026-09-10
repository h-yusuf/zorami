import time

import httpx

from app.adapters.llm.base import LLMResponse


class OmnirouterAdapter:
    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 20.0):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def complete(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        max_tokens: int = 160,
        temperature: float = 0.7,
    ) -> LLMResponse:
        payload = {
            "model": self._model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        resp.raise_for_status()

        message = resp.json()["choices"][0]["message"]
        return LLMResponse(
            text=message.get("content") or "",
            tool_calls=message.get("tool_calls") or [],
            latency_ms=latency_ms,
        )
