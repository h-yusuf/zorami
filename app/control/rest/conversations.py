import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.control.auth import get_current_owner
from app.control.schemas import ConversationDetailOut, ConversationOut, MessageOut
from app.core.db import get_session
from app.core.models import Conversation, Message

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _conv_to_out(conv: Conversation, turn_count: int = 0) -> ConversationOut:
    return ConversationOut(
        id=str(conv.id),
        device_id=str(conv.device_id),
        agent_id=str(conv.agent_id) if conv.agent_id else None,
        session_id=conv.session_id,
        title=conv.title,
        started_at=conv.started_at,
        turn_count=turn_count,
    )


def _msg_to_out(msg: Message) -> MessageOut:
    return MessageOut(
        id=str(msg.id),
        role=msg.role,
        text=msg.text,
        provider_used=msg.provider_used,
        latency_ms=msg.latency_ms,
        audio_path=msg.audio_path,
        created_at=msg.created_at,
    )


async def _get_owned_conversation(
    conversation_id: str, owner_id: str, db: AsyncSession
) -> Conversation:
    try:
        conv_uuid = uuid.UUID(conversation_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Percakapan tidak ditemukan")

    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conv_uuid, Conversation.owner_id == uuid.UUID(owner_id)
        )
    )
    conv = result.scalar_one_or_none()
    if conv is None:
        raise HTTPException(status_code=404, detail="Percakapan tidak ditemukan")
    return conv


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    device_id: Optional[str] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    q: Optional[str] = Query(default=None, description="search text di title/messages"),
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    stmt = select(Conversation).where(Conversation.owner_id == uuid.UUID(owner_id))
    if device_id:
        try:
            stmt = stmt.where(Conversation.device_id == uuid.UUID(device_id))
        except ValueError:
            return []
    if date_from:
        stmt = stmt.where(Conversation.started_at >= date_from)
    if date_to:
        stmt = stmt.where(Conversation.started_at <= date_to)
    if q:
        stmt = stmt.where(Conversation.title.ilike(f"%{q}%"))

    result = await db.execute(stmt.order_by(Conversation.started_at.desc()))
    convs = result.scalars().all()

    out = []
    for conv in convs:
        count_result = await db.execute(
            select(func.count()).select_from(Message).where(Message.conversation_id == conv.id)
        )
        turn_count = count_result.scalar_one()
        out.append(_conv_to_out(conv, turn_count))
    return out


@router.get("/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(
    conversation_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    conv = await _get_owned_conversation(conversation_id, owner_id, db)
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at.asc())
    )
    messages = result.scalars().all()
    base = _conv_to_out(conv, len(messages))
    return ConversationDetailOut(**base.model_dump(), messages=[_msg_to_out(m) for m in messages])


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str,
    owner_id: str = Depends(get_current_owner),
    db: AsyncSession = Depends(get_session),
):
    conv = await _get_owned_conversation(conversation_id, owner_id, db)
    # Hapus messages dulu (belum ada file audio nyata di Fase 1 - hapus record cukup).
    await db.execute(
        Message.__table__.delete().where(Message.conversation_id == conv.id)
    )
    await db.delete(conv)
    await db.commit()
