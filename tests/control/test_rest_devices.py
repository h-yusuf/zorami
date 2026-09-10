import itertools
import uuid
from datetime import datetime, timedelta, timezone

from app.core.db import get_sessionmaker
from app.core.models import Device

_mac_counter = itertools.count(1)


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
