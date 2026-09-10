from app.adapters.stt.groq_whisper import GroqWhisperAdapter


async def test_transcribe_returns_text(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.groq.com/openai/v1/audio/transcriptions",
        json={"text": "besok cuaca surabaya gimana"},
    )

    adapter = GroqWhisperAdapter(api_key="gsk-test")
    result = await adapter.transcribe(pcm_audio=b"\x00\x01" * 100, sample_rate=16000)

    assert result.text == "besok cuaca surabaya gimana"
    assert result.latency_ms >= 0
