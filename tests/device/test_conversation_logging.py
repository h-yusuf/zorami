import asyncio
import json
import struct
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.core.models import Device, Message, Owner, User
from app.device.opus_codec import encode as opus_encode
from app.main import app


def test_turn_is_logged_to_database(monkeypatch):
    import app.device.ws as ws_module
    from app.adapters.llm.base import LLMResponse
    from app.adapters.stt.base import STTResult
    from app.adapters.tts.base import TTSResult
    from app.device.pipeline import Pipeline

    class _FakeSTT:
        async def transcribe(self, pcm_audio, *, sample_rate=16000):
            return STTResult(text="tes logging", latency_ms=100)

    class _FakeLLM:
        async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
            return LLMResponse(text="Oke dicatat.", tool_calls=[], latency_ms=200)

    class _FakeTTS:
        async def synthesize(self, text, *, voice):
            return TTSResult(pcm_audio=b"\x00\x01" * 480, sample_rate=24000, latency_ms=50)

    monkeypatch.setattr(
        ws_module,
        "_build_pipeline",
        lambda mcp: Pipeline(stt=_FakeSTT(), llm=_FakeLLM(), tts=_FakeTTS(), voice="v", system_prompt="p"),
    )

    async def _seed_device():
        session_maker = get_sessionmaker()
        async with session_maker() as session:
            user = User(id=uuid.uuid4(), email="log-owner@example.com", password_hash="hash")
            session.add(user)
            await session.flush()
            owner = Owner(id=uuid.uuid4(), user_id=user.id)
            session.add(owner)
            await session.flush()
            device = Device(
                id=uuid.uuid4(),
                owner_id=owner.id,
                device_id="A4:CF:12:9B:00:9E",
                client_id="log-test",
                token_hash="tok",
            )
            session.add(device)
            await session.commit()

    asyncio.run(_seed_device())

    client = TestClient(app)
    with client.websocket_connect(
        "/ws", headers={"Device-Id": "A4:CF:12:9B:00:9E", "Client-Id": "log-test"}
    ) as ws:
        ws.send_text(json.dumps({"type": "hello", "version": 1, "transport": "websocket"}))
        ws.receive_text()

        ws.send_text(json.dumps({"type": "listen", "state": "start", "mode": "auto"}))

        loud = struct.pack("<960h", *([8000, -8000] * 480))
        silent = struct.pack("<960h", *([0] * 960))

        ws.send_bytes(opus_encode(loud, sample_rate=16000, frame_duration_ms=60))
        for _ in range(15):
            ws.send_bytes(opus_encode(silent, sample_rate=16000, frame_duration_ms=60))

        while True:
            msg = ws.receive()
            if msg.get("text"):
                payload = json.loads(msg["text"])
                if payload.get("type") == "tts" and payload.get("state") == "stop":
                    break

    async def _fetch_messages():
        session_maker = get_sessionmaker()
        async with session_maker() as session:
            result = await session.execute(select(Message))
            return result.scalars().all()

    messages = asyncio.run(_fetch_messages())
    assert len(messages) >= 2
    assert any(m.role == "user" and m.text == "tes logging" for m in messages)
    assert any(m.role == "assistant" and m.text == "Oke dicatat." for m in messages)
