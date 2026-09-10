from app.adapters.search.langsearch import LangSearchAdapter


async def test_search_returns_top_results(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.langsearch.com/v1/web-search",
        json={
            "code": 200,
            "log_id": "x",
            "msg": None,
            "data": {
                "_type": "SearchResponse",
                "webPages": {
                    "value": [
                        {
                            "id": "1",
                            "name": "BMKG",
                            "url": "https://bmkg.go.id",
                            "displayUrl": "https://bmkg.go.id",
                            "snippet": "cuaca cerah",
                            "summary": "Cuaca Surabaya besok hujan ringan sore hari.",
                        },
                        {
                            "id": "2",
                            "name": "Cuaca.com",
                            "url": "https://cuaca.com",
                            "displayUrl": "https://cuaca.com",
                            "snippet": "26-29 derajat",
                            "summary": "",
                        },
                        {
                            "id": "3",
                            "name": "Hasil ke-3",
                            "url": "https://x.com/3",
                            "displayUrl": "https://x.com/3",
                            "snippet": "diabaikan",
                        },
                        {
                            "id": "4",
                            "name": "Hasil ke-4",
                            "url": "https://x.com/4",
                            "displayUrl": "https://x.com/4",
                            "snippet": "dipotong",
                        },
                    ]
                },
            },
        },
    )

    adapter = LangSearchAdapter(api_key="sk-test")
    result = await adapter.search("cuaca surabaya besok", max_results=3)

    assert len(result.results) == 3
    assert result.results[0]["title"] == "BMKG"
    assert result.results[0]["snippet"] == "Cuaca Surabaya besok hujan ringan sore hari."
    # fallback ke snippet kalau summary kosong/tidak ada
    assert result.results[1]["snippet"] == "26-29 derajat"
    assert result.results[2]["snippet"] == "diabaikan"
    assert result.latency_ms >= 0
