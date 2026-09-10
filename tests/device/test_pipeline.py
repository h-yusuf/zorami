from app.adapters.llm.base import LLMResponse
from app.adapters.stt.base import STTResult
from app.adapters.tts.base import TTSResult
from app.device.pipeline import Pipeline


class _FakeSTT:
    async def transcribe(self, pcm_audio: bytes, *, sample_rate: int = 16000) -> STTResult:
        return STTResult(text="besok cuaca gimana", latency_ms=400)


class _FakeLLM:
    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        return LLMResponse(text="Besok cerah.", tool_calls=[], latency_ms=700)


class _FakeTTS:
    async def synthesize(self, text: str, *, voice: str) -> TTSResult:
        return TTSResult(pcm_audio=b"\x00\x01" * 480, sample_rate=24000, latency_ms=200)


class _FakeTTSNonOpusRate:
    """Simula Piper voice id_ID sungguhan, yang keluar di 22050Hz - bukan salah
    satu dari 5 sample rate valid Opus (8k/12k/16k/24k/48k)."""

    async def synthesize(self, text: str, *, voice: str) -> TTSResult:
        return TTSResult(pcm_audio=b"\x00\x01" * 2205, sample_rate=22050, latency_ms=200)


async def test_handle_utterance_emits_events_in_order():
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLM(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora, asisten suara.",
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    kinds = [e["kind"] for e in events]
    assert kinds[0] == "stt"
    assert events[0]["text"] == "besok cuaca gimana"
    assert "tts_start" in kinds
    assert kinds.index("tts_start") < kinds.index("audio_frame")
    assert kinds[-1] == "tts_stop"


async def test_handle_utterance_includes_llm_text_as_sentence():
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLM(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
    )
    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]
    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any(e["text"] == "Besok cerah." for e in sentence_events)


class _FakeLLMWithToolCall:
    def __init__(self):
        self._call_count = 0

    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        self._call_count += 1
        if self._call_count == 1:
            return LLMResponse(
                text="",
                tool_calls=[
                    {
                        "id": "call_1",
                        "function": {"name": "web_search", "arguments": '{"query": "cuaca surabaya besok"}'},
                    }
                ],
                latency_ms=500,
            )
        return LLMResponse(text="Besok Surabaya hujan ringan sore.", tool_calls=[], latency_ms=600)


class _FakeSearch:
    async def search(self, query: str, *, max_results: int = 3):
        from app.adapters.search.base import SearchResult

        return SearchResult(
            results=[{"title": "BMKG", "snippet": "Hujan ringan sore.", "url": "https://bmkg.go.id"}],
            latency_ms=890,
        )


async def test_handle_utterance_with_tool_call_invokes_search():
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMWithToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        search=_FakeSearch(),
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]
    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any("hujan ringan" in e["text"].lower() for e in sentence_events)


async def test_handle_utterance_without_search_adapter_ignores_tool_calls():
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMWithToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        search=None,
    )
    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]
    assert events[-1]["kind"] == "tts_stop"


async def test_handle_utterance_resamples_non_opus_rate_before_encoding():
    # Regresi: ditemukan lewat tes manual end-to-end sungguhan - opuslib.Encoder
    # melempar "invalid argument" untuk sample rate yang bukan salah satu dari
    # 8000/12000/16000/24000/48000. Voice Piper id_ID kita (22050Hz) selalu kena
    # ini tanpa resample dulu.
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLM(),
        tts=_FakeTTSNonOpusRate(),
        voice="id_ID-news_tts-medium",
        system_prompt="Kamu Zora.",
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    audio_frames = [e for e in events if e["kind"] == "audio_frame"]
    assert len(audio_frames) > 0
    assert events[-1]["kind"] == "tts_stop"
