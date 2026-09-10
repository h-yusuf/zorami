import json

from fastapi.testclient import TestClient

from app.main import app


def test_hello_handshake_replies_within_contract():
    client = TestClient(app)
    with client.websocket_connect(
        "/ws", headers={"Device-Id": "A4:CF:12:9B:00:7E", "Client-Id": "test-client"}
    ) as ws:
        ws.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "version": 1,
                    "transport": "websocket",
                    "audio_params": {
                        "format": "opus",
                        "sample_rate": 16000,
                        "channels": 1,
                        "frame_duration": 60,
                    },
                }
            )
        )
        reply = json.loads(ws.receive_text())

        assert reply["type"] == "hello"
        assert reply["transport"] == "websocket"
        assert "session_id" in reply
        assert reply["audio_params"]["sample_rate"] == 24000
        assert reply["audio_params"]["frame_duration"] == 60


def test_hello_without_transport_field_still_acknowledged_by_server():
    client = TestClient(app)
    with client.websocket_connect(
        "/ws", headers={"Device-Id": "A4:CF:12:9B:00:7F", "Client-Id": "test-client-2"}
    ) as ws:
        ws.send_text(json.dumps({"type": "hello", "version": 1}))
        reply = json.loads(ws.receive_text())
        assert reply["type"] == "hello"
