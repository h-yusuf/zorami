import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.control.auth import get_current_owner
from app.control.schemas import (
    DeviceClaimIn,
    DeviceClaimOut,
    DeviceOut,
    DeviceUpdate,
    PendingActivationOut,
)
from app.core.db import get_session
from app.core.models import ActivationCode, Device

router = APIRouter(prefix="/api/devices", tags=["devices"])

ONLINE_WINDOW = timedelta(minutes=2)


async def _get_owned_device(device_id: str, owner_id: str, db: AsyncSession) -> Device:
    try:
        device_uuid = uuid.UUID(device_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan")

    result = await db.execute(
        select(Device).where(Device.id == device_uuid, Device.owner_id == uuid.UUID(owner_id))
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan")
    return device


def _is_online(device: Device) -> bool:
    if device.last_seen_at is None:
        return False
    last_seen = device.last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last_seen <= ONLINE_WINDOW


def _to_out(device: Device) -> DeviceOut:
    return DeviceOut(
        id=str(device.id),
        device_id=device.device_id,
        client_id=device.client_id,
        alias=device.alias,
        agent_id=str(device.agent_id) if device.agent_id else None,
        board=device.board,
        firmware_version=device.firmware_version,
        last_seen_at=device.last_seen_at,
        created_at=device.created_at,
        online=_is_online(device),
    )


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    owner_id: str = Depends(get_current_owner), db: AsyncSession = Depends(get_session)
):
    result = await db.execute(select(Device).where(Device.owner_id == uuid.UUID(owner_id)))
    return [_to_out(d) for d in result.scalars().all()]


@router.get("/pending", response_model=list[PendingActivationOut])
async def list_pending_activations(
    owner_id: str = Depends(get_current_owner), db: AsyncSession = Depends(get_session)
):
    """Device yang sudah nyala dan minta kode aktivasi tapi belum diklaim siapa pun.
    Kode-nya sendiri sengaja tidak diekspos di sini - itu harus dibaca langsung dari
    layar device, supaya klaim tetap butuh kehadiran fisik di depan device."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(ActivationCode)
        .where(ActivationCode.claimed_at.is_(None), ActivationCode.expires_at > now)
        .order_by(ActivationCode.created_at)
    )
    return [
        PendingActivationOut(
            device_id=a.device_id, client_id=a.client_id, created_at=a.created_at
        )
        for a in result.scalars().all()
    ]


@router.post("/claim", response_model=DeviceClaimOut)
async def claim_device(
    body: DeviceClaimIn,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    now = datetime.now(timezone.utc)
    result = await db.execute(select(ActivationCode).where(ActivationCode.code == body.code))
    activation = result.scalar_one_or_none()

    if activation is None or activation.expires_at < now:
        raise HTTPException(status_code=404, detail="Kode aktivasi tidak ditemukan atau kedaluwarsa")

    if activation.claimed_at is not None:
        raise HTTPException(status_code=409, detail="Kode aktivasi sudah diklaim")

    activation.claimed_at = now
    activation.claimed_by_owner_id = uuid.UUID(owner_id)
    await db.commit()
    return DeviceClaimOut(code=activation.code)


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(
    device_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    device = await _get_owned_device(device_id, owner_id, db)
    return _to_out(device)


@router.put("/{device_id}", response_model=DeviceOut)
async def update_device(
    device_id: str,
    body: DeviceUpdate,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    device = await _get_owned_device(device_id, owner_id, db)
    updates = body.model_dump(exclude_unset=True)
    if "agent_id" in updates:
        raw = updates.pop("agent_id")
        device.agent_id = uuid.UUID(raw) if raw else None
    for field, value in updates.items():
        setattr(device, field, value)
    await db.commit()
    await db.refresh(device)
    return _to_out(device)


@router.delete("/{device_id}", status_code=204)
async def delete_device(
    device_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    device = await _get_owned_device(device_id, owner_id, db)
    await db.delete(device)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Device masih punya riwayat percakapan tersimpan dan tidak bisa dihapus.",
        )
