import uuid
import uuid as uuid_mod
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import CHAR, TypeDecorator


class GUID(TypeDecorator):
    """UUID sebagai CHAR(36) - portabel Postgres & SQLite (dipakai di test)."""

    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return uuid_mod.UUID(value)


def _json_type():
    from sqlalchemy import JSON

    return JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class User(Base):
    """Identitas login - bukan tenant. Satu User bisa punya Owner (tenant) sendiri
    dan/atau Membership ke tenant orang lain lewat Fase 3 (RBAC). Jangan gabung
    ini dengan Owner walau di Fase 1 rasanya berlebihan - Fase 3 butuh satu User
    memetakan ke banyak tenant dengan peran berbeda-beda per tenant."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Owner(Base):
    """Tenant - unit isolasi data (agents, devices, conversations semua di-scope ke
    owner_id ini, bukan ke user_id). `user_id` menunjuk User yang membuat tenant ini."""

    __tablename__ = "owners"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("users.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("agents.id"), nullable=True)
    device_id: Mapped[str] = mapped_column(String(17), unique=True)  # MAC, format AA:BB:CC:DD:EE:FF
    client_id: Mapped[str] = mapped_column(String(64))
    alias: Mapped[str] = mapped_column(String(120), default="Zora")
    board: Mapped[str | None] = mapped_column(String(64), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(128))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ActivationCode(Base):
    __tablename__ = "activation_codes"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    device_id: Mapped[str] = mapped_column(String(17))
    client_id: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_by_owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("devices.id"), index=True)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("agents.id"), nullable=True)
    session_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    llm_model: Mapped[str] = mapped_column(String(120), default="gpt-4o-mini")
    temperature: Mapped[float] = mapped_column(default=0.7)
    max_tokens: Mapped[int] = mapped_column(default=256)
    tts_provider: Mapped[str] = mapped_column(String(64), default="piper")
    tts_voice: Mapped[str] = mapped_column(String(64), default="id_ID")
    emotion_level: Mapped[str] = mapped_column(String(32), default="medium")
    tools_enabled: Mapped[list] = mapped_column(_json_type(), default=list)
    memory_enabled: Mapped[bool] = mapped_column(default=False)
    chat_log_level: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class ProviderCred(Base):
    __tablename__ = "provider_creds"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # llm|stt|tts|search|vision
    provider_code: Mapped[str] = mapped_column(String(64))
    config: Mapped[dict] = mapped_column(_json_type(), default=dict)
    secret_encrypted: Mapped[str] = mapped_column(Text)
    secret_last4: Mapped[str] = mapped_column(String(8))
    fallback_of: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("provider_creds.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("conversations.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # "user" | "assistant"
    text: Mapped[str] = mapped_column(Text)
    provider_used: Mapped[dict | None] = mapped_column(_json_type(), nullable=True)
    latency_ms: Mapped[dict | None] = mapped_column(_json_type(), nullable=True)
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
