from app.adapters.tts import piper as piper_module
from app.adapters.tts.piper import PiperAdapter


class _FakeProcess:
    def __init__(self, stdout_bytes: bytes):
        self._stdout_bytes = stdout_bytes
        self.returncode = 0

    async def communicate(self, input: bytes | None = None):
        return self._stdout_bytes, b""

    async def wait(self):
        return 0


async def test_synthesize_returns_pcm(monkeypatch):
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(22050)
        wf.writeframes(b"\x01\x02" * 500)
    fake_wav_bytes = buf.getvalue()

    async def fake_create_subprocess_exec(*args, **kwargs):
        return _FakeProcess(fake_wav_bytes)

    monkeypatch.setattr(
        piper_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )

    adapter = PiperAdapter(binary_path="/usr/bin/piper", model_path="/models/id_ID-news-medium.onnx")
    result = await adapter.synthesize("Halo, apa kabar?", voice="id_ID-news-medium")

    assert isinstance(result.pcm_audio, bytes)
    assert result.sample_rate == 22050
    assert result.latency_ms >= 0
