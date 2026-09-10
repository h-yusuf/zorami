from app.adapters.llm.omnirouter import OmnirouterAdapter


async def test_complete_returns_text(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:20128/v1/chat/completions",
        json={"choices": [{"message": {"role": "assistant", "content": "Besok cuaca cerah."}}]},
    )

    adapter = OmnirouterAdapter(
        base_url="http://localhost:20128/v1", api_key="sk-test", model="claude-sonnet-5"
    )
    result = await adapter.complete(messages=[{"role": "user", "content": "Cuaca besok gimana?"}])

    assert result.text == "Besok cuaca cerah."
    assert result.tool_calls == []
    assert result.latency_ms >= 0


async def test_complete_extracts_tool_calls(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:20128/v1/chat/completions",
        json={
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "function": {
                                    "name": "web_search",
                                    "arguments": '{"query": "cuaca surabaya besok"}',
                                },
                            }
                        ],
                    }
                }
            ]
        },
    )

    adapter = OmnirouterAdapter(
        base_url="http://localhost:20128/v1", api_key="sk-test", model="claude-sonnet-5"
    )
    result = await adapter.complete(
        messages=[{"role": "user", "content": "Cuaca besok gimana?"}],
        tools=[{"type": "function", "function": {"name": "web_search"}}],
    )

    assert result.text == ""
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0]["function"]["name"] == "web_search"


async def test_complete_always_sends_stream_false(httpx_mock):
    # Regresi: ditemukan lewat tes manual ke omnirouter sungguhan bahwa endpoint
    # ini default ke SSE streaming kalau "stream" tidak ada di body sama sekali -
    # bukan default non-streaming seperti spec OpenAI resmi. Tanpa field ini,
    # respons "data: {...}" bukan JSON tunggal dan resp.json() gagal parse.
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:20128/v1/chat/completions",
        json={"choices": [{"message": {"role": "assistant", "content": "ok"}}]},
    )

    adapter = OmnirouterAdapter(
        base_url="http://localhost:20128/v1", api_key="sk-test", model="claude-sonnet-5"
    )
    await adapter.complete(messages=[{"role": "user", "content": "hai"}])

    sent_request = httpx_mock.get_requests()[0]
    import json

    body = json.loads(sent_request.content)
    assert body["stream"] is False
