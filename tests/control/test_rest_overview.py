import itertools
import uuid
from datetime import datetime, timedelta, timezone

from app.core.db import get_sessionmaker
from app.core.models import Agent, Conversation, Device, Message, ProviderCred

_mac_counter = itertools.count(200)


async def _make_device(owner_id: str, *, last_seen_at=None) -> str:
    session_maker = get_sessionmaker()
    mac = f"AA:BB:CC:DD:EE:{next(_mac_counter):02X}"
    async with session_maker() as session:
        device = Device(
            owner_id=uuid.UUID(owner_id),
            device_id=mac,
            client_id="client-1",
            token_hash="hashed",
            last_seen_at=last_seen_at,
        )
        session.add(device)
        await session.commit()
        await session.refresh(device)
        return str(device.id)


async def _make_agent(owner_id: str) -> str:
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        agent = Agent(owner_id=uuid.UUID(owner_id), name="Zora")
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return str(agent.id)


async def _make_conversation(owner_id: str, device_id: str) -> str:
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        conv = Conversation(
            owner_id=uuid.UUID(owner_id), device_id=uuid.UUID(device_id), session_id="sess-1"
        )
        session.add(conv)
        await session.commit()
        await session.refresh(conv)
        return str(conv.id)


async def _add_message(owner_id: str, conversation_id: str) -> None:
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        msg = Message(
            owner_id=uuid.UUID(owner_id),
            conversation_id=uuid.UUID(conversation_id),
            role="user",
            text="hi",
        )
        session.add(msg)
        await session.commit()


async def test_overview_empty(client, auth_headers):
    r = client.get("/api/overview", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["devices_online"] == 0
    assert data["devices_total"] == 0
    assert data["turns_today"] == 0
    assert data["active_conversations"] == 0
    assert data["agents_total"] == 0


async def test_overview_counts(client, auth_headers, seeded_owner):
    # Satu session/transaksi untuk seluruh setup data - mengurangi jumlah koneksi
    # asyncpg terpisah yang dibuka berurutan (NullPool bikin koneksi baru tiap
    # `async with session_maker()`; banyak koneksi beruntun di test yang sama
    # dgn TestClient portal loop pernah memicu race condition Postgres di proyek ini).
    session_maker = get_sessionmaker()
    owner_uuid = uuid.UUID(seeded_owner["owner_id"])
    async with session_maker() as session:
        device_online = Device(
            owner_id=owner_uuid,
            device_id="AA:BB:CC:DD:EE:F1",
            client_id="client-1",
            token_hash="hashed",
            last_seen_at=datetime.now(timezone.utc),
        )
        device_offline = Device(
            owner_id=owner_uuid,
            device_id="AA:BB:CC:DD:EE:F2",
            client_id="client-1",
            token_hash="hashed",
            last_seen_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        )
        agent = Agent(owner_id=owner_uuid, name="Zora")
        session.add_all([device_online, device_offline, agent])
        await session.flush()

        conv = Conversation(owner_id=owner_uuid, device_id=device_online.id, session_id="sess-1")
        session.add(conv)
        await session.flush()

        session.add_all(
            [
                Message(owner_id=owner_uuid, conversation_id=conv.id, role="user", text="hi"),
                Message(owner_id=owner_uuid, conversation_id=conv.id, role="assistant", text="hi2"),
            ]
        )
        await session.commit()

    r = client.get("/api/overview", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["devices_total"] == 2
    assert data["devices_online"] == 1
    assert data["agents_total"] == 1
    assert data["active_conversations"] == 1
    assert data["turns_today"] == 2


async def test_overview_provider_p50_computed_from_real_message_latency(
    client, auth_headers, seeded_owner
):
    session_maker = get_sessionmaker()
    owner_uuid = uuid.UUID(seeded_owner["owner_id"])
    async with session_maker() as session:
        device = Device(
            owner_id=owner_uuid, device_id="AA:BB:CC:DD:EE:F9", client_id="c", token_hash="h"
        )
        provider = ProviderCred(
            owner_id=owner_uuid,
            kind="stt",
            provider_code="groq",
            config={},
            secret_encrypted="enc",
            secret_last4="1234",
        )
        session.add_all([device, provider])
        await session.flush()

        conv = Conversation(owner_id=owner_uuid, device_id=device.id, session_id="sess-p50")
        session.add(conv)
        await session.flush()

        session.add_all(
            [
                Message(
                    owner_id=owner_uuid,
                    conversation_id=conv.id,
                    role="assistant",
                    text="a",
                    latency_ms={"stt": 400, "llm": 700, "tts": 200, "total": 1300},
                ),
                Message(
                    owner_id=owner_uuid,
                    conversation_id=conv.id,
                    role="assistant",
                    text="b",
                    latency_ms={"stt": 600, "llm": 900, "tts": 300, "total": 1800},
                ),
            ]
        )
        await session.commit()

    r = client.get("/api/overview", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    stt_provider = next(p for p in data["providers"] if p["kind"] == "stt")
    assert stt_provider["provider_code"] == "groq"
    assert stt_provider["p50_ms"] == 500  # median(400, 600)
    assert data["p50_latency_ms"] == 1550  # median(1300, 1800)


async def test_overview_scoped_to_owner(client, auth_headers, other_auth_headers, seeded_owner):
    await _make_device(seeded_owner["owner_id"])
    r = client.get("/api/overview", headers=other_auth_headers)
    assert r.status_code == 200
    assert r.json()["devices_total"] == 0
