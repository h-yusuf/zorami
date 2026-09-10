import uuid

from sqlalchemy import select

from app.core.crypto import encrypt_secret
from app.core.db import get_sessionmaker
from app.core.models import Agent, Device, Owner, ProviderCred, User
from app.core.security import hash_password
from app.device.ws import _resolve_config


async def _make_user_owner(session, email: str) -> Owner:
    user = User(id=uuid.uuid4(), email=email, password_hash=hash_password("x"))
    session.add(user)
    await session.flush()
    owner = Owner(id=uuid.uuid4(), user_id=user.id)
    session.add(owner)
    await session.flush()
    return owner


async def test_resolve_config_unclaimed_device_returns_empty():
    resolved = await _resolve_config("NOT:CLAIMED:00")
    assert resolved == {"agent": None, "providers": {}}


async def test_resolve_config_device_without_agent_or_providers():
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        owner = await _make_user_owner(session, "noagent@test.com")
        device = Device(
            id=uuid.uuid4(),
            owner_id=owner.id,
            device_id="AA:BB:00:00:00:01",
            client_id="c1",
            token_hash="t",
        )
        session.add(device)
        await session.commit()

    resolved = await _resolve_config("AA:BB:00:00:00:01")
    assert resolved["agent"] is None
    assert resolved["providers"] == {}


async def test_resolve_config_device_with_agent_and_providers():
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        owner = await _make_user_owner(session, "withagent@test.com")

        agent = Agent(
            id=uuid.uuid4(),
            owner_id=owner.id,
            name="Zora Test",
            system_prompt="Prompt kustom",
            llm_model="custom-model",
            temperature=0.2,
            max_tokens=320,
            tts_provider="piper",
            tts_voice="id_ID-custom-voice",
            emotion_level="ekspresif",
            tools_enabled=["websearch"],
            memory_enabled=False,
            chat_log_level=1,
        )
        session.add(agent)
        await session.flush()

        device = Device(
            id=uuid.uuid4(),
            owner_id=owner.id,
            agent_id=agent.id,
            device_id="AA:BB:00:00:00:02",
            client_id="c2",
            token_hash="t",
        )
        session.add(device)

        pc = ProviderCred(
            id=uuid.uuid4(),
            owner_id=owner.id,
            kind="llm",
            provider_code="omnirouter",
            config={"base_url": "http://example.test/v1", "model": "ignored"},
            secret_encrypted=encrypt_secret("sk-owner-key"),
            secret_last4="-key",
        )
        session.add(pc)
        await session.commit()

    resolved = await _resolve_config("AA:BB:00:00:00:02")

    assert resolved["agent"]["system_prompt"] == "Prompt kustom"
    assert resolved["agent"]["llm_model"] == "custom-model"
    assert resolved["agent"]["temperature"] == 0.2
    assert resolved["agent"]["max_tokens"] == 320
    assert resolved["agent"]["tts_voice"] == "id_ID-custom-voice"
    assert resolved["agent"]["tools_enabled"] == ["websearch"]

    assert "llm" in resolved["providers"]
    assert resolved["providers"]["llm"]["provider_code"] == "omnirouter"
    assert resolved["providers"]["llm"]["config"]["base_url"] == "http://example.test/v1"
    assert resolved["providers"]["llm"]["secret"] == "sk-owner-key"
    assert "stt" not in resolved["providers"]
