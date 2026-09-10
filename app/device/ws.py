import asyncio
import json

from fastapi import APIRouter, Header, WebSocket, WebSocketDisconnect

from app.device.endpointer import Endpointer
from app.device.opus_codec import decode as opus_decode
from app.device.pipeline import Pipeline
from app.device.session import DeviceSession

ws_router = APIRouter()

_DOWNLINK_AUDIO_PARAMS = {
    "format": "opus",
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
}

_FRAME_DURATION_S = 0.06


def _build_pipeline() -> Pipeline:
    # Fase 1: satu konfigurasi hardcoded. Fase 2 mengambil per-agent dari DB.
    from app.adapters.llm.omnirouter import OmnirouterAdapter
    from app.adapters.search.searxng import SearxngAdapter
    from app.adapters.stt.groq_whisper import GroqWhisperAdapter
    from app.adapters.tts.piper import PiperAdapter
    from app.config import settings

    return Pipeline(
        stt=GroqWhisperAdapter(api_key=settings.groq_api_key),
        llm=OmnirouterAdapter(
            base_url=settings.omnirouter_base_url,
            api_key=settings.omnirouter_api_key,
            model=settings.omnirouter_model,
        ),
        tts=PiperAdapter(binary_path=settings.piper_binary_path, model_path=settings.piper_model_path),
        voice="id_ID-news-medium",
        system_prompt=(
            "Kamu Zora, asisten suara berbahasa Indonesia. Jawab singkat, "
            "maksimal dua kalimat, tanpa markdown."
        ),
        search=SearxngAdapter(base_url=settings.searxng_base_url),
    )


@ws_router.websocket("/ws")
async def device_websocket(
    websocket: WebSocket,
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    await websocket.accept()
    session = DeviceSession(device_id=device_id)
    endpointer = Endpointer(silence_ms=800)
    pipeline = _build_pipeline()

    pcm_buffer = bytearray()
    aborted = False

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

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            if "text" in message and message["text"] is not None:
                payload = json.loads(message["text"])
                msg_type = payload.get("type")

                if msg_type == "listen":
                    session.listen_mode = payload.get("mode", session.listen_mode)
                    if payload.get("state") == "start":
                        session.state = "listening"
                        pcm_buffer.clear()
                        aborted = False

                elif msg_type == "abort":
                    aborted = True
                    session.state = "listening" if session.listen_mode != "manual" else "idle"
                    await websocket.send_text(
                        json.dumps(
                            {"session_id": session.session_id, "type": "tts", "state": "stop"}
                        )
                    )

            elif "bytes" in message and message["bytes"] is not None:
                if session.state != "listening":
                    continue
                opus_packet = message["bytes"]
                pcm_frame = opus_decode(opus_packet, sample_rate=16000)
                pcm_buffer.extend(pcm_frame)

                event = endpointer.feed(pcm_frame)
                if event == "speech_end":
                    session.state = "speaking"
                    utterance_pcm = bytes(pcm_buffer)
                    pcm_buffer.clear()

                    stt_text = ""
                    assistant_text_parts: list[str] = []

                    async for out_event in pipeline.handle_utterance(utterance_pcm):
                        if aborted:
                            break
                        kind = out_event["kind"]
                        if kind == "stt":
                            stt_text = out_event["text"]
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "session_id": session.session_id,
                                        "type": "stt",
                                        "text": out_event["text"],
                                    }
                                )
                            )
                        elif kind == "tts_start":
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "session_id": session.session_id,
                                        "type": "tts",
                                        "state": "start",
                                    }
                                )
                            )
                        elif kind == "tts_sentence":
                            assistant_text_parts.append(out_event["text"])
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "session_id": session.session_id,
                                        "type": "tts",
                                        "state": "sentence_start",
                                        "text": out_event["text"],
                                    }
                                )
                            )
                        elif kind == "audio_frame":
                            # Kirim seirama waktu nyata - antrean device cuma 20 frame
                            # (1.2s), kelebihan kirim dibuang diam-diam (spec §4.6).
                            await websocket.send_bytes(out_event["data"])
                            await asyncio.sleep(_FRAME_DURATION_S)
                        elif kind == "tts_stop":
                            # Log DULU sebelum mengirim "tts stop" - device (atau test
                            # client) boleh memutus koneksi begitu menerima sinyal stop,
                            # jadi menulis DB setelah mengirimnya berisiko race dengan
                            # disconnect yang membatalkan task ini di tengah jalan.
                            if not aborted:
                                await _log_turn(
                                    device_id=device_id,
                                    session_id=session.session_id,
                                    user_text=stt_text,
                                    assistant_text=" ".join(assistant_text_parts),
                                )
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "session_id": session.session_id,
                                        "type": "tts",
                                        "state": "stop",
                                    }
                                )
                            )

                    session.state = "listening" if session.listen_mode == "auto" else "idle"

    except WebSocketDisconnect:
        pass


async def _log_turn(*, device_id: str, session_id: str, user_text: str, assistant_text: str) -> None:
    import uuid

    from sqlalchemy import select

    from app.core.db import get_sessionmaker
    from app.core.models import Conversation, Device, Message

    session_maker = get_sessionmaker()
    async with session_maker() as db_session:
        result = await db_session.execute(select(Device).where(Device.device_id == device_id))
        device = result.scalar_one_or_none()
        if device is None:
            return  # device belum diklaim (mode dev tanpa pairing) - skip logging

        result = await db_session.execute(
            select(Conversation).where(Conversation.session_id == session_id)
        )
        conversation = result.scalar_one_or_none()
        if conversation is None:
            conversation = Conversation(
                id=uuid.uuid4(),
                owner_id=device.owner_id,
                device_id=device.id,
                session_id=session_id,
            )
            db_session.add(conversation)
            await db_session.flush()

        db_session.add(
            Message(
                id=uuid.uuid4(),
                owner_id=device.owner_id,
                conversation_id=conversation.id,
                role="user",
                text=user_text,
            )
        )
        db_session.add(
            Message(
                id=uuid.uuid4(),
                owner_id=device.owner_id,
                conversation_id=conversation.id,
                role="assistant",
                text=assistant_text,
            )
        )
        await db_session.commit()
