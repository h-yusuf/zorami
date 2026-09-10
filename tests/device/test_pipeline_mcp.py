from app.adapters.llm.base import LLMResponse
from app.adapters.stt.base import STTResult
from app.adapters.tts.base import TTSResult
from app.device.pipeline import Pipeline


class _FakeSTT:
    async def transcribe(self, pcm_audio, *, sample_rate=16000):
        return STTResult(text="ambil foto dong", latency_ms=100)


class _FakeTTS:
    async def synthesize(self, text, *, voice):
        return TTSResult(pcm_audio=b"\x00\x01" * 480, sample_rate=24000, latency_ms=50)


class _FakeLLMWithMcpToolCall:
    def __init__(self):
        self._call_count = 0

    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        self._call_count += 1
        if self._call_count == 1:
            return LLMResponse(
                text="",
                tool_calls=[{"id": "call_1", "function": {"name": "take_photo", "arguments": "{}"}}],
                latency_ms=500,
            )
        return LLMResponse(text="Ini foto dari kamera device.", tool_calls=[], latency_ms=600)


class _FakeMcpClient:
    def __init__(self, result: dict):
        self._result = result
        self.call_count = 0

    async def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        self.call_count += 1
        return self._result

    async def get_allowed_tools(self) -> list[dict]:
        return [
            {"name": "take_photo", "description": "ambil foto", "inputSchema": {"type": "object", "properties": {}}}
        ]


async def test_handle_utterance_dispatches_mcp_tool_call():
    fake_mcp = _FakeMcpClient({"isError": False, "content": [{"type": "text", "text": "photo data"}]})
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMWithMcpToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        mcp=fake_mcp,
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any("foto" in e["text"].lower() for e in sentence_events)
    assert fake_mcp.call_count == 1
    assert events[-1]["kind"] == "tts_stop"


async def test_handle_utterance_mcp_error_still_completes():
    fake_mcp = _FakeMcpClient({"isError": True, "content": [{"type": "text", "text": "timeout"}]})
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMWithMcpToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        mcp=fake_mcp,
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    assert events[-1]["kind"] == "tts_stop"
    assert fake_mcp.call_count == 1


class _FakeLLMNoToolCall:
    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        return LLMResponse(text="Halo, apa kabar?", tool_calls=[], latency_ms=400)


async def test_handle_utterance_without_tool_call_never_touches_mcp():
    fake_mcp = _FakeMcpClient({"isError": False, "content": []})
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMNoToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        mcp=fake_mcp,
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    assert fake_mcp.call_count == 0
    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any(e["text"] == "Halo, apa kabar?" for e in sentence_events)
