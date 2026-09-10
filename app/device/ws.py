import asyncio
import json
import logging

from fastapi import APIRouter, Header, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

from app.device.endpointer import Endpointer
from app.device.mcp_client import McpClient
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


_DEFAULT_SYSTEM_PROMPT = (
    "Kamu Zora, asisten suara berbahasa Indonesia. Jawab singkat, "
    "maksimal dua kalimat, tanpa markdown."
)
_DEFAULT_VOICE = "id_ID-news-medium"
_HARI_INDONESIA = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]


async def _resolve_config(device_id: str) -> dict:
    """Cari Device -> Agent yang di-assign + ProviderCred milik owner-nya.

    Ini yang bikin dashboard (halaman Agents & Providers) beneran ngefek ke
    voice loop - sebelumnya _build_pipeline 100% hardcoded dari .env, gak
    peduli device-nya siapa atau agent apa yang di-assign di dashboard
    (ditemukan lewat tes manual end-to-end).

    Return dict: {"agent": dict|None, "providers": {kind: {provider_code,
    config, secret}}}. `agent` None atau kind yang tidak ada di `providers`
    berarti "pakai default dari .env" - fallback ini disengaja supaya dev
    lokal tanpa dashboard tetap bisa jalan (spec §9 follow-up)."""
    from sqlalchemy import select

    from app.core.crypto import decrypt_secret
    from app.core.db import get_sessionmaker
    from app.core.models import Agent, Device, ProviderCred

    session_maker = get_sessionmaker()
    async with session_maker() as session:
        result = await session.execute(select(Device).where(Device.device_id == device_id))
        device = result.scalar_one_or_none()
        if device is None:
            return {"agent": None, "providers": {}}

        agent_dict = None
        if device.agent_id is not None:
            agent = await session.get(Agent, device.agent_id)
            if agent is not None:
                agent_dict = {
                    "system_prompt": agent.system_prompt,
                    "llm_model": agent.llm_model,
                    "temperature": agent.temperature,
                    "max_tokens": agent.max_tokens,
                    "tts_voice": agent.tts_voice,
                    "tools_enabled": agent.tools_enabled or [],
                }

        result = await session.execute(
            select(ProviderCred).where(ProviderCred.owner_id == device.owner_id)
        )
        providers: dict[str, dict] = {}
        for pc in result.scalars().all():
            if pc.kind in providers:
                continue  # belum ada konsep "provider aktif" eksplisit - ambil yang pertama
            providers[pc.kind] = {
                "provider_code": pc.provider_code,
                "config": pc.config or {},
                "secret": decrypt_secret(pc.secret_encrypted),
            }

        return {"agent": agent_dict, "providers": providers}


def _context_note() -> str:
    """Suntik waktu server sekarang ke system prompt - tanpa ini LLM tidak
    tahu tanggal/hari sebenarnya dan menebak (ditemukan lewat tes manual:
    ditanya 'hari apa', LLM jawab beda-beda tiap dipanggil tanpa search)."""
    from datetime import datetime, timedelta, timezone

    from app.config import settings

    now = datetime.now(timezone.utc) + timedelta(hours=settings.timezone_offset_hours)
    hari = _HARI_INDONESIA[now.weekday()]
    return (
        f"\n\nKonteks waktu sekarang: hari {hari}, {now.strftime('%d %B %Y')}, "
        f"pukul {now.strftime('%H:%M')} waktu setempat. Kalau ditanya hari atau "
        "tanggal, jawab dari sini - jangan menebak."
    )


async def _build_pipeline(mcp: McpClient, device_id: str) -> Pipeline:
    from app.adapters.llm.omnirouter import OmnirouterAdapter
    from app.adapters.search.langsearch import LangSearchAdapter
    from app.adapters.stt.groq_whisper import GroqWhisperAdapter
    from app.adapters.tts.piper import PiperAdapter
    from app.config import settings

    resolved = await _resolve_config(device_id)
    agent = resolved["agent"]
    providers = resolved["providers"]

    llm_cfg = providers.get("llm")
    stt_cfg = providers.get("stt")
    tts_cfg = providers.get("tts")
    search_cfg = providers.get("search")

    llm = OmnirouterAdapter(
        base_url=(llm_cfg["config"].get("base_url") if llm_cfg else settings.omnirouter_base_url),
        api_key=(llm_cfg["secret"] if llm_cfg else settings.omnirouter_api_key),
        model=(
            agent["llm_model"]
            if agent
            else (llm_cfg["config"].get("model") if llm_cfg else settings.omnirouter_model)
        ),
    )
    stt = GroqWhisperAdapter(api_key=(stt_cfg["secret"] if stt_cfg else settings.groq_api_key))
    tts = PiperAdapter(
        binary_path=(tts_cfg["config"].get("binary_path") if tts_cfg else settings.piper_binary_path),
        model_path=(tts_cfg["config"].get("model_path") if tts_cfg else settings.piper_model_path),
    )
    search = LangSearchAdapter(
        api_key=(search_cfg["secret"] if search_cfg else settings.langsearch_api_key)
    )

    system_prompt = (agent["system_prompt"] if agent else _DEFAULT_SYSTEM_PROMPT) + _context_note()

    return Pipeline(
        stt=stt,
        llm=llm,
        tts=tts,
        voice=(agent["tts_voice"] if agent else _DEFAULT_VOICE),
        system_prompt=system_prompt,
        search=search,
        mcp=mcp,
        max_tokens=(agent["max_tokens"] if agent else 160),
        temperature=(agent["temperature"] if agent else 0.7),
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
    mcp = McpClient(websocket.send_text, session_id=session.session_id)
    pipeline = await _build_pipeline(mcp, device_id)

    pcm_buffer = bytearray()
    aborted = False
    mcp_initialize_task: asyncio.Task | None = None

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

        # Kirim initialize sekali per koneksi - satu-satunya isi balasannya yang
        # dipakai firmware adalah URL+token vision kamera (spec §5). Tidak ada
        # gerbang di firmware sebelum tools/list/tools/call, tapi tetap dikirim
        # supaya vision URL (kalau nanti dipakai) sempat di-set device. Referensi
        # task-nya DISIMPAN dan dibatalkan di finally - fire-and-forget murni bikin
        # task ini hidup sampai 10s call_timeout walau koneksi sudah lama tertutup.
        mcp_initialize_task = asyncio.create_task(mcp.initialize())

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

                elif msg_type == "mcp":
                    # Balasan device atas tools/list atau tools/call kita - JSON-RPC
                    # asli ada di payload["payload"] (envelope spec §4).
                    await mcp.handle_response(json.dumps(payload.get("payload", {})))

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

                    try:
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
                    except Exception:
                        # Kegagalan provider (STT/LLM/TTS/search) TIDAK BOLEH menjatuhkan
                        # koneksi WebSocket - device harus tetap bisa mencoba turn
                        # berikutnya tanpa reconnect + hello ulang. Kirim `tts stop` supaya
                        # device tidak menggantung di state Speaking menunggu audio yang
                        # tidak akan pernah datang.
                        logger.exception(
                            "Turn gagal untuk device %s (session %s)", device_id, session.session_id
                        )
                        try:
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "session_id": session.session_id,
                                        "type": "tts",
                                        "state": "stop",
                                    }
                                )
                            )
                        except Exception:
                            pass  # koneksi sudah putus - tidak ada lagi yang bisa dikirim

                    session.state = "listening" if session.listen_mode == "auto" else "idle"

    except WebSocketDisconnect:
        pass
    finally:
        if mcp_initialize_task is not None and not mcp_initialize_task.done():
            mcp_initialize_task.cancel()


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
