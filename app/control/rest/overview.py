import statistics
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.control.auth import get_current_owner
from app.control.schemas import OverviewStats
from app.core.db import get_session
from app.core.models import Agent, Conversation, Device, Message, ProviderCred

router = APIRouter(prefix="/api/overview", tags=["overview"])

ONLINE_WINDOW = timedelta(minutes=2)


@router.get("", response_model=OverviewStats)
async def overview(
    owner_id: str = Depends(get_current_owner), db: AsyncSession = Depends(get_session)
):
    owner_uuid = uuid.UUID(owner_id)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    devices_total_result = await db.execute(
        select(func.count()).select_from(Device).where(Device.owner_id == owner_uuid)
    )
    devices_total = devices_total_result.scalar_one()

    devices_online_result = await db.execute(
        select(func.count())
        .select_from(Device)
        .where(Device.owner_id == owner_uuid, Device.last_seen_at >= now - ONLINE_WINDOW)
    )
    devices_online = devices_online_result.scalar_one()

    agents_total_result = await db.execute(
        select(func.count()).select_from(Agent).where(Agent.owner_id == owner_uuid)
    )
    agents_total = agents_total_result.scalar_one()

    active_conversations_result = await db.execute(
        select(func.count()).select_from(Conversation).where(Conversation.owner_id == owner_uuid)
    )
    active_conversations = active_conversations_result.scalar_one()

    turns_today_result = await db.execute(
        select(func.count())
        .select_from(Message)
        .where(Message.owner_id == owner_uuid, Message.created_at >= today_start)
    )
    turns_today = turns_today_result.scalar_one()

    # Simplified p50: pull latency_ms dict values in Python instead of
    # PERCENTILE_CONT (keeps this portable across the SQLite test DB too).
    latency_result = await db.execute(
        select(Message.latency_ms).where(
            Message.owner_id == owner_uuid, Message.latency_ms.is_not(None)
        )
    )
    latencies = [row[0] for row in latency_result if isinstance(row[0], dict)]

    totals = []
    for latency in latencies:
        if "total" in latency:
            try:
                totals.append(float(latency["total"]))
            except (TypeError, ValueError):
                continue
    p50_latency_ms = int(statistics.median(totals)) if totals else 0

    def _stage_p50(stage: str) -> int:
        values = []
        for latency in latencies:
            if stage in latency:
                try:
                    values.append(float(latency[stage]))
                except (TypeError, ValueError):
                    continue
        return int(statistics.median(values)) if values else 0

    providers_result = await db.execute(
        select(ProviderCred.kind, ProviderCred.provider_code).where(
            ProviderCred.owner_id == owner_uuid
        )
    )
    providers = [
        {"kind": kind, "provider_code": provider_code, "p50_ms": _stage_p50(kind)}
        for kind, provider_code in providers_result
    ]

    needs_attention: list[dict] = []
    offline_devices_result = await db.execute(
        select(Device.id, Device.alias).where(
            Device.owner_id == owner_uuid,
            (Device.last_seen_at.is_(None)) | (Device.last_seen_at < now - ONLINE_WINDOW),
        )
    )
    for device_id, alias in offline_devices_result:
        needs_attention.append(
            {
                "type": "device_offline",
                "message": f"Device '{alias}' sedang offline",
                "device_id": str(device_id),
            }
        )

    return OverviewStats(
        devices_online=devices_online,
        devices_total=devices_total,
        turns_today=turns_today,
        p50_latency_ms=p50_latency_ms,
        active_conversations=active_conversations,
        agents_total=agents_total,
        providers=providers,
        needs_attention=needs_attention,
    )
