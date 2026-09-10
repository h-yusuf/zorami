import asyncio

from app.core.bus import clear, publish, subscribe, unsubscribe


async def test_publish_subscribe_basic():
    clear()
    received = []

    async def handler(payload):
        received.append(payload)

    await subscribe("device.connected", handler)
    await publish("device.connected", {"device_id": "dev1", "session_id": "s1"})
    await asyncio.sleep(0.01)

    assert received == [{"device_id": "dev1", "session_id": "s1"}]


async def test_unsubscribe():
    clear()
    received = []

    async def handler(payload):
        received.append(payload)

    await subscribe("device.connected", handler)
    await unsubscribe("device.connected", handler)
    await publish("device.connected", {"device_id": "dev1"})
    await asyncio.sleep(0.01)

    assert received == []


async def test_handler_error_does_not_block_others():
    clear()
    received = []

    async def bad_handler(payload):
        raise RuntimeError("boom")

    async def good_handler(payload):
        received.append(payload)

    await subscribe("turn.stage", bad_handler)
    await subscribe("turn.stage", good_handler)
    await publish("turn.stage", {"stage": "stt"})
    await asyncio.sleep(0.01)

    assert received == [{"stage": "stt"}]


async def test_multiple_subscribers():
    clear()
    results_a, results_b = [], []

    async def handler_a(payload):
        results_a.append(payload)

    async def handler_b(payload):
        results_b.append(payload)

    await subscribe("turn.completed", handler_a)
    await subscribe("turn.completed", handler_b)
    await publish("turn.completed", {"total_ms": 1500})
    await asyncio.sleep(0.01)

    assert results_a == [{"total_ms": 1500}]
    assert results_b == [{"total_ms": 1500}]
