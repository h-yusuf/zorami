import itertools
import uuid
from datetime import datetime, timedelta, timezone

from app.core.db import get_sessionmaker
from app.core.models import ActivationCode, Device

_mac_counter = itertools.count(1)


async def _make_activation_code(
    *, code="ABC234", expires_delta=timedelta(minutes=10), claimed_at=None, claimed_by_owner_id=None
) -> str:
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        activation = ActivationCode(
            code=code,
            device_id=f"AA:BB:CC:DD:EE:{next(_mac_counter):02X}",
            client_id="client-1",
            expires_at=datetime.now(timezone.utc) + expires_delta,
            claimed_at=claimed_at,
            claimed_by_owner_id=uuid.UUID(claimed_by_owner_id) if claimed_by_owner_id else None,
        )
        session.add(activation)
        await session.commit()
        return activation.code


async def _make_device(owner_id: str, *, last_seen_at=None, alias="Zora") -> str:
    session_maker = get_sessionmaker()
    mac = f"AA:BB:CC:DD:EE:{next(_mac_counter):02X}"
    async with session_maker() as session:
        device = Device(
            owner_id=uuid.UUID(owner_id),
            device_id=mac,
            client_id="client-1",
            alias=alias,
            token_hash="hashed",
            last_seen_at=last_seen_at,
        )
        session.add(device)
        await session.flush()
        device_id = str(device.id)
        await session.commit()
        return device_id


async def test_list_devices_empty(client, auth_headers):
    r = client.get("/api/devices", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_list_devices_shows_online_status(client, auth_headers, seeded_owner):
    await _make_device(seeded_owner["owner_id"], last_seen_at=datetime.now(timezone.utc))
    await _make_device(
        seeded_owner["owner_id"],
        last_seen_at=datetime.now(timezone.utc) - timedelta(minutes=10),
    )

    r = client.get("/api/devices", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    online_flags = sorted(d["online"] for d in data)
    assert online_flags == [False, True]


async def test_get_device_detail(client, auth_headers, seeded_owner):
    device_id = await _make_device(seeded_owner["owner_id"])
    r = client.get(f"/api/devices/{device_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["id"] == device_id


async def test_update_device_alias(client, auth_headers, seeded_owner):
    device_id = await _make_device(seeded_owner["owner_id"])
    r = client.put(f"/api/devices/{device_id}", headers=auth_headers, json={"alias": "Living Room"})
    assert r.status_code == 200
    assert r.json()["alias"] == "Living Room"


async def test_delete_device_releases_it(client, auth_headers, seeded_owner):
    device_id = await _make_device(seeded_owner["owner_id"])
    r = client.delete(f"/api/devices/{device_id}", headers=auth_headers)
    assert r.status_code == 204
    r2 = client.get(f"/api/devices/{device_id}", headers=auth_headers)
    assert r2.status_code == 404


async def test_cannot_access_other_owner_device(client, auth_headers, other_auth_headers, seeded_owner):
    device_id = await _make_device(seeded_owner["owner_id"])

    r = client.get("/api/devices", headers=other_auth_headers)
    assert r.json() == []

    r2 = client.get(f"/api/devices/{device_id}", headers=other_auth_headers)
    assert r2.status_code == 404

    r3 = client.put(f"/api/devices/{device_id}", headers=other_auth_headers, json={"alias": "Hijack"})
    assert r3.status_code == 404

    r4 = client.delete(f"/api/devices/{device_id}", headers=other_auth_headers)
    assert r4.status_code == 404


async def test_claim_device_marks_activation_code_claimed(client, auth_headers, seeded_owner):
    code = await _make_activation_code()
    r = client.post("/api/devices/claim", headers=auth_headers, json={"code": code})
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == code
    assert body["claimed"] is True

    session_maker = get_sessionmaker()
    async with session_maker() as session:
        from sqlalchemy import select

        result = await session.execute(select(ActivationCode).where(ActivationCode.code == code))
        activation = result.scalar_one()
        assert activation.claimed_at is not None
        assert str(activation.claimed_by_owner_id) == seeded_owner["owner_id"]


async def test_claim_device_unknown_code_returns_404(client, auth_headers):
    r = client.post("/api/devices/claim", headers=auth_headers, json={"code": "ZZZZZZ"})
    assert r.status_code == 404


async def test_claim_device_expired_code_returns_404(client, auth_headers):
    code = await _make_activation_code(expires_delta=timedelta(minutes=-1))
    r = client.post("/api/devices/claim", headers=auth_headers, json={"code": code})
    assert r.status_code == 404


async def test_claim_device_already_claimed_returns_409(client, auth_headers, seeded_owner):
    code = await _make_activation_code(
        claimed_at=datetime.now(timezone.utc), claimed_by_owner_id=seeded_owner["owner_id"]
    )
    r = client.post("/api/devices/claim", headers=auth_headers, json={"code": code})
    assert r.status_code == 409


async def test_claim_device_requires_auth(client):
    r = client.post("/api/devices/claim", json={"code": "ABC234"})
    assert r.status_code == 401


async def test_pending_activations_lists_unclaimed_unexpired(client, auth_headers):
    await _make_activation_code(code="AAA111")
    r = client.get("/api/devices/pending", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["device_id"].startswith("AA:BB:CC:DD:EE:")
    assert body[0]["client_id"] == "client-1"


async def test_pending_activations_excludes_claimed(client, auth_headers, seeded_owner):
    await _make_activation_code(
        code="BBB222",
        claimed_at=datetime.now(timezone.utc),
        claimed_by_owner_id=seeded_owner["owner_id"],
    )
    r = client.get("/api/devices/pending", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_pending_activations_excludes_expired(client, auth_headers):
    await _make_activation_code(code="CCC333", expires_delta=timedelta(minutes=-1))
    r = client.get("/api/devices/pending", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


async def test_pending_activations_requires_auth(client):
    r = client.get("/api/devices/pending")
    assert r.status_code == 401


async def test_delete_device_with_conversation_history_returns_409(
    client, auth_headers, seeded_owner
):
    from app.core.models import Conversation

    device_id = await _make_device(seeded_owner["owner_id"])
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        conv = Conversation(
            owner_id=uuid.UUID(seeded_owner["owner_id"]),
            device_id=uuid.UUID(device_id),
            session_id="s1",
        )
        session.add(conv)
        await session.commit()

    r = client.delete(f"/api/devices/{device_id}", headers=auth_headers)
    assert r.status_code == 409

    r2 = client.get(f"/api/devices/{device_id}", headers=auth_headers)
    assert r2.status_code == 200
