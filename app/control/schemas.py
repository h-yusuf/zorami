from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    system_prompt: str
    llm_model: str
    temperature: float
    max_tokens: int
    tts_provider: str
    tts_voice: str
    emotion_level: str
    tools_enabled: list[str]
    memory_enabled: bool
    chat_log_level: int
    created_at: datetime
    updated_at: datetime


class AgentCreate(BaseModel):
    name: str
    system_prompt: str = ""
    llm_model: str = "gpt-4o-mini"
    temperature: float = 0.7
    max_tokens: int = 256
    tts_provider: str = "piper"
    tts_voice: str = "id_ID"
    emotion_level: str = "medium"
    tools_enabled: list[str] = []
    memory_enabled: bool = False
    chat_log_level: int = 1


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    llm_model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    tts_provider: Optional[str] = None
    tts_voice: Optional[str] = None
    emotion_level: Optional[str] = None
    tools_enabled: Optional[list[str]] = None
    memory_enabled: Optional[bool] = None
    chat_log_level: Optional[int] = None


class ProviderCredOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    provider_code: str
    config: dict
    secret_last4: str
    fallback_of: Optional[str] = None
    created_at: datetime


class ProviderCredCreate(BaseModel):
    kind: str  # llm|stt|tts|search|vision
    provider_code: str
    config: dict = {}
    secret: str  # API key — dienkripsi sebelum masuk DB
    fallback_of: Optional[str] = None


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device_id: str  # MAC
    client_id: str
    alias: Optional[str] = None
    agent_id: Optional[str] = None
    board: Optional[str] = None
    firmware_version: Optional[str] = None
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    online: bool = False


class DeviceUpdate(BaseModel):
    alias: Optional[str] = None
    agent_id: Optional[str] = None


class DeviceClaimIn(BaseModel):
    code: str


class DeviceClaimOut(BaseModel):
    code: str
    claimed: bool = True


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device_id: str
    agent_id: Optional[str] = None
    session_id: str
    title: Optional[str] = None
    started_at: datetime
    turn_count: int = 0


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: str
    text: str
    provider_used: Optional[dict] = None
    latency_ms: Optional[dict] = None
    audio_path: Optional[str] = None
    created_at: datetime


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut] = []


class OverviewStats(BaseModel):
    devices_online: int
    devices_total: int
    turns_today: int
    p50_latency_ms: int
    active_conversations: int
    agents_total: int
    providers: list[dict]  # [{kind, provider_code, p50_ms}]
    needs_attention: list[dict]  # [{type, message, device_id?}]
