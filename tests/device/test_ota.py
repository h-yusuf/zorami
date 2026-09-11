import uuid
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.core.models import ActivationCode, Owner, User
from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_unknown_device_gets_activation_code(client):
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:01", "Client-Id": "test-client-1"},
        json={"application": {"version": "1.9.2"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "activation" in body
    assert len(body["activation"]["code"]) == 6
    # Firmware (board tanpa serial number di eFuse) hanya lanjut manggil
    # /activate kalau field "challenge" ada di respons ini - gerbangnya cuma
    # cek keberadaan, bukan validasi HMAC (ota.cc GetActivationPayload()).
    assert body["activation"]["challenge"]
    assert "server_time" in body
    assert "timestamp" in body["server_time"]
    assert "websocket" not in body


async def test_activate_poll_returns_202_before_claim(client):
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:02", "Client-Id": "test-client-2"},
        json={"application": {"version": "1.9.2"}},
    )
    resp.json()["activation"]["code"]

    poll = await client.post(
        "/ota/activate",
        headers={"Device-Id": "A4:CF:12:9B:99:02", "Client-Id": "test-client-2"},
        json={},
    )
    assert poll.status_code == 202


async def test_activate_returns_200_after_claim(client):
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:03", "Client-Id": "test-client-3"},
        json={"application": {"version": "1.9.2"}},
    )
    code = resp.json()["activation"]["code"]

    session_maker = get_sessionmaker()
    async with session_maker() as session:
        user = User(
            id=uuid.uuid4(), email="test-owner-3@example.com", password_hash="argon2-hash"
        )
        session.add(user)
        await session.flush()

        owner = Owner(id=uuid.uuid4(), user_id=user.id)
        session.add(owner)
        await session.flush()

        result = await session.execute(select(ActivationCode).where(ActivationCode.code == code))
        activation = result.scalar_one()
        activation.claimed_at = datetime.now(timezone.utc)
        activation.claimed_by_owner_id = owner.id
        await session.commit()

    poll = await client.post(
        "/ota/activate",
        headers={"Device-Id": "A4:CF:12:9B:99:03", "Client-Id": "test-client-3"},
        json={},
    )
    assert poll.status_code == 200

    recheck = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:03", "Client-Id": "test-client-3"},
        json={"application": {"version": "1.9.2"}},
    )
    body = recheck.json()
    assert body["websocket"]["url"]
    assert body["websocket"]["token"]
    assert "activation" not in body


async def test_activate_nested_under_check_version_path_works(client):
    """Firmware nyata (tanpa serial number di eFuse) build URL activate dengan
    concat literal `{OTA_URL}/activate`. Kalau OTA_URL diisi persis
    ".../ota/check_version" (device POST OTA_URL apa adanya buat check_version,
    tanpa suffix), request activate-nya mendarat di
    "/ota/check_version/activate", bukan "/ota/activate" flat."""
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:05", "Client-Id": "test-client-5"},
        json={},
    )
    resp.json()["activation"]["code"]

    poll = await client.post(
        "/ota/check_version/activate",
        headers={"Device-Id": "A4:CF:12:9B:99:05", "Client-Id": "test-client-5"},
        json={},
    )
    assert poll.status_code == 202


async def test_websocket_url_uses_request_host_not_localhost(client):
    """Device ESP32 resolve "localhost" jadi dirinya sendiri (127.0.0.1) - kalau
    bridge hardcode itu di respons, device gagal connect ws (ditemukan lewat tes
    manual end-to-end sungguhan, code 0x68). URL harus ikut host yang device
    beneran pakai buat nyampe ke check_version."""
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:06", "Client-Id": "test-client-6"},
        json={},
    )
    code = resp.json()["activation"]["code"]

    session_maker = get_sessionmaker()
    async with session_maker() as session:
        user = User(id=uuid.uuid4(), email="test-owner-6@example.com", password_hash="argon2-hash")
        session.add(user)
        await session.flush()
        owner = Owner(id=uuid.uuid4(), user_id=user.id)
        session.add(owner)
        await session.flush()
        result = await session.execute(select(ActivationCode).where(ActivationCode.code == code))
        activation = result.scalar_one()
        activation.claimed_at = datetime.now(timezone.utc)
        activation.claimed_by_owner_id = owner.id
        await session.commit()

    await client.post(
        "/ota/activate",
        headers={"Device-Id": "A4:CF:12:9B:99:06", "Client-Id": "test-client-6"},
        json={},
    )

    recheck = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:06", "Client-Id": "test-client-6"},
        json={},
    )
    ws_url = recheck.json()["websocket"]["url"]
    assert "localhost" not in ws_url
    assert ws_url == "ws://test/ws"  # host dari base_url test client ("http://test")


async def test_repeated_check_version_reuses_same_code(client):
    r1 = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:04", "Client-Id": "test-client-4"},
        json={},
    )
    r2 = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:04", "Client-Id": "test-client-4"},
        json={},
    )
    assert r1.json()["activation"]["code"] == r2.json()["activation"]["code"]
