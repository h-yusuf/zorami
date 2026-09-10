import itertools
import uuid

from app.core.db import get_sessionmaker
from app.core.models import Conversation, Device, Message

_mac_counter = itertools.count(100)


async def _make_device(owner_id: str) -> str:
    session_maker = get_sessionmaker()
    mac = f"AA:BB:CC:DD:FF:{next(_mac_counter):02X}"
    async with session_maker() as session:
        device = Device(
            owner_id=uuid.UUID(owner_id),
            device_id=mac,
            client_id="client-1",
            token_hash="hashed",
        )
        session.add(device)
        await session.flush()
        device_id = str(device.id)
        await session.commit()
        return device_id


async def _make_conversation(owner_id: str, device_id: str, *, title=None) -> str:
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        conv = Conversation(
            owner_id=uuid.UUID(owner_id),
            device_id=uuid.UUID(device_id),
            session_id="sess-1",
            title=title,
        )
        session.add(conv)
        await session.flush()
        conv_id = str(conv.id)
        await session.commit()
        return conv_id


async def _make_message(owner_id: str, conversation_id: str, role: str, text: str) -> None:
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        msg = Message(
            owner_id=uuid.UUID(owner_id),
            conversation_id=uuid.UUID(conversation_id),
            role=role,
            text=text,
        )
        session.add(msg)
        await session.commit()


async def test_list_conversations_empty(client, auth_headers):
    r = client.get("/api/conversations", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_list_conversations_filter_by_device(client, auth_headers, seeded_owner):
    device_a = await _make_device(seeded_owner["owner_id"])
    device_b = await _make_device(seeded_owner["owner_id"])
    await _make_conversation(seeded_owner["owner_id"], device_a, title="Convo A")
    await _make_conversation(seeded_owner["owner_id"], device_b, title="Convo B")

    r = client.get(f"/api/conversations?device_id={device_a}", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["title"] == "Convo A"


async def test_get_conversation_detail_with_messages(client, auth_headers, seeded_owner):
    device_id = await _make_device(seeded_owner["owner_id"])
    conv_id = await _make_conversation(seeded_owner["owner_id"], device_id)
    await _make_message(seeded_owner["owner_id"], conv_id, "user", "Halo")
    await _make_message(seeded_owner["owner_id"], conv_id, "assistant", "Hai juga")

    r = client.get(f"/api/conversations/{conv_id}", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data["messages"]) == 2
    assert data["messages"][0]["text"] == "Halo"


async def test_delete_conversation(client, auth_headers, seeded_owner):
    device_id = await _make_device(seeded_owner["owner_id"])
    conv_id = await _make_conversation(seeded_owner["owner_id"], device_id)

    r = client.delete(f"/api/conversations/{conv_id}", headers=auth_headers)
    assert r.status_code == 204
    r2 = client.get(f"/api/conversations/{conv_id}", headers=auth_headers)
    assert r2.status_code == 404


async def test_cannot_access_other_owner_conversation(client, auth_headers, other_auth_headers, seeded_owner):
    device_id = await _make_device(seeded_owner["owner_id"])
    conv_id = await _make_conversation(seeded_owner["owner_id"], device_id)

    r = client.get("/api/conversations", headers=other_auth_headers)
    assert r.json() == []

    r2 = client.get(f"/api/conversations/{conv_id}", headers=other_auth_headers)
    assert r2.status_code == 404

    r3 = client.delete(f"/api/conversations/{conv_id}", headers=other_auth_headers)
    assert r3.status_code == 404
