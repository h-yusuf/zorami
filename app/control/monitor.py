import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.control.auth import get_current_owner_ws
from app.core.bus import subscribe, unsubscribe

router = APIRouter()

MONITOR_TOPICS = [
    "device.connected",
    "device.disconnected",
    "device.listening",
    "device.speaking",
    "turn.started",
    "turn.stage",
    "turn.completed",
    "turn.aborted",
    "device.mcp_call",
]


@router.websocket("/ws/monitor")
async def monitor_ws(ws: WebSocket) -> None:
    """Live monitor WebSocket buat dashboard browser. Subscribe ke semua topic event
    bus yang relevan, forward tiap event ke browser sebagai JSON {"topic", "payload"}.

    Auth via query param `?token=` (bukan header Authorization) karena WebSocket
    browser biasa tidak bisa attach header custom. Event tanpa `owner_id` di payload
    di-drop diam-diam - tidak bisa dipastikan kepunyaan siapa, jadi jangan diteruskan
    ke browser manapun."""
    token = ws.query_params.get("token")
    owner_id = await get_current_owner_ws(token)
    if owner_id is None:
        await ws.close(code=4001)
        return

    await ws.accept()

    queue: asyncio.Queue = asyncio.Queue()

    def make_handler(topic: str):
        async def handler(payload):
            if payload.get("owner_id") != owner_id:
                return
            await queue.put((topic, payload))

        return handler

    handlers = {topic: make_handler(topic) for topic in MONITOR_TOPICS}

    for topic, handler in handlers.items():
        await subscribe(topic, handler)

    try:
        while True:
            topic, payload = await queue.get()
            await ws.send_json({"topic": topic, "payload": payload})
    except WebSocketDisconnect:
        pass
    finally:
        for topic, handler in handlers.items():
            await unsubscribe(topic, handler)
