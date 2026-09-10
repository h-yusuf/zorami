import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.core.models import ActivationCode, Device

ota_router = APIRouter(prefix="/ota", tags=["ota"])

_CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "01OI")
_ACTIVATION_TTL = timedelta(minutes=10)


def generate_activation_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


@ota_router.post("/check_version")
async def check_version(
    request: Request,
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    session_maker = get_sessionmaker()
    now = datetime.now(timezone.utc)

    async with session_maker() as session:
        result = await session.execute(select(Device).where(Device.device_id == device_id))
        device = result.scalar_one_or_none()

        body: dict = {
            "server_time": {
                "timestamp": int(now.timestamp() * 1000),
                "timezone_offset": 0,
            },
        }

        if device is not None:
            body["websocket"] = {
                "url": "ws://localhost:8000/ws",
                "token": device.token_hash,
                "version": 1,
            }
            device.last_seen_at = now
            await session.commit()
            return JSONResponse(body)

        result = await session.execute(
            select(ActivationCode).where(
                ActivationCode.device_id == device_id,
                ActivationCode.claimed_at.is_(None),
                ActivationCode.expires_at > now,
            )
        )
        activation = result.scalar_one_or_none()

        if activation is None:
            activation = ActivationCode(
                id=uuid.uuid4(),
                code=generate_activation_code(),
                device_id=device_id,
                client_id=client_id,
                expires_at=now + _ACTIVATION_TTL,
            )
            session.add(activation)
            await session.commit()

        body["activation"] = {
            "message": "Masukkan kode ini di dashboard untuk memasangkan device",
            "code": activation.code,
            "timeout_ms": 30000,
        }
        return JSONResponse(body)


@ota_router.post("/activate")
async def activate(
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    session_maker = get_sessionmaker()
    now = datetime.now(timezone.utc)

    async with session_maker() as session:
        result = await session.execute(
            select(ActivationCode)
            .where(ActivationCode.device_id == device_id)
            .order_by(ActivationCode.created_at.desc())
        )
        activation = result.scalars().first()

        if activation is None or activation.expires_at < now:
            return JSONResponse(status_code=404, content={"error": "no pending activation"})

        if activation.claimed_at is None:
            return JSONResponse(status_code=202, content={})

        existing = await session.execute(select(Device).where(Device.device_id == device_id))
        if existing.scalar_one_or_none() is None:
            # NOTE: token disimpan mentah di kolom token_hash untuk sementara.
            # Sebelum produksi, ganti jadi hash (mis. SHA-256) dan bandingkan
            # hash-nya saat validasi WS handshake - lihat catatan di plan Task 3.
            token = secrets.token_urlsafe(24)
            device = Device(
                id=uuid.uuid4(),
                owner_id=activation.claimed_by_owner_id,
                device_id=device_id,
                client_id=client_id,
                token_hash=token,
            )
            session.add(device)
            await session.commit()

        return JSONResponse(status_code=200, content={"access_token": "granted"})
