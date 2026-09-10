import asyncio
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import pytest

from app.core.bus import clear, publish


def _receive_json_or_timeout(ws, timeout: float = 2.0):
    """WebSocketTestSession.receive_json() blocks forever if no message ever
    arrives - it has no built-in timeout param in this starlette version. Run it
    in a worker thread and bound it externally so a missing message (the
    owner-filter test) fails fast instead of hanging the suite.

    Note: on timeout the worker thread is left running, still blocked inside
    receive_json - it dies on its own once the `with client.websocket_connect(...)`
    block exits and tears down the connection. Use a bare (non-context-manager)
    executor with wait=False shutdown so we never join that stuck thread here."""
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(ws.receive_json)
    try:
        return future.result(timeout=timeout)
    finally:
        pool.shutdown(wait=False)


@pytest.fixture(autouse=True)
def _clear_bus():
    clear()
    yield
    clear()


def test_monitor_connect_without_token(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/monitor"):
            pass


def test_monitor_connect_with_valid_token_receives_event(client, seeded_owner):
    login = client.post(
        "/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"}
    )
    token = login.json()["access_token"]
    owner_id = seeded_owner["owner_id"]

    with client.websocket_connect(f"/ws/monitor?token={token}") as ws:
        asyncio.run(
            publish("turn.stage", {"owner_id": owner_id, "stage": "stt", "latency_ms": 500})
        )

        msg = _receive_json_or_timeout(ws)
        assert msg["topic"] == "turn.stage"
        assert msg["payload"]["stage"] == "stt"


def test_monitor_filters_by_owner(client, seeded_owner, other_owner):
    """Event milik owner lain tidak diteruskan ke koneksi monitor owner ini."""
    login = client.post(
        "/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"}
    )
    token = login.json()["access_token"]

    with client.websocket_connect(f"/ws/monitor?token={token}") as ws:
        asyncio.run(
            publish("turn.stage", {"owner_id": other_owner["owner_id"], "stage": "stt"})
        )

        with pytest.raises(FutureTimeoutError):
            _receive_json_or_timeout(ws, timeout=1.0)
