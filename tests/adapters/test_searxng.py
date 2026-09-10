from app.adapters.search.searxng import SearxngAdapter


async def test_search_returns_top_results(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="http://searxng:8080/search?q=cuaca+surabaya+besok&format=json",
        json={
            "results": [
                {"title": "BMKG Surabaya", "content": "Hujan ringan sore hari.", "url": "https://bmkg.go.id/x"},
                {"title": "Cuaca.com", "content": "26-29 derajat.", "url": "https://cuaca.com/y"},
                {"title": "Weather.id", "content": "Berawan.", "url": "https://weather.id/z"},
                {"title": "Hasil ke-4", "content": "diabaikan.", "url": "https://x.com/4"},
            ]
        },
    )

    adapter = SearxngAdapter(base_url="http://searxng:8080")
    result = await adapter.search("cuaca surabaya besok", max_results=3)

    assert len(result.results) == 3
    assert result.results[0]["title"] == "BMKG Surabaya"
    assert result.latency_ms >= 0
