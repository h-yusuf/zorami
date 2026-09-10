import json

from fastapi import APIRouter, Header, WebSocket, WebSocketDisconnect

from app.device.session import DeviceSession

ws_router = APIRouter()

_DOWNLINK_AUDIO_PARAMS = {
    "format": "opus",
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
}


@ws_router.websocket("/ws")
async def device_websocket(
    websocket: WebSocket,
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    await websocket.accept()
    session = DeviceSession(device_id=device_id)

    try:
        raw_hello = await websocket.receive_text()
        hello = json.loads(raw_hello)
        assert hello.get("type") == "hello"

        await websocket.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "transport": "websocket",
                    "session_id": session.session_id,
                    "audio_params": _DOWNLINK_AUDIO_PARAMS,
                }
            )
        )

        # loop pesan berikutnya (listen/abort/binary) diimplementasikan di Task 8
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
