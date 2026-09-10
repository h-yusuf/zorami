import uuid
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class DeviceSession:
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str = ""
    listen_mode: Literal["auto", "manual", "realtime"] = "auto"
    state: Literal["idle", "listening", "speaking"] = "idle"
