from typing import Literal, TypedDict


class HelloMessage(TypedDict, total=False):
    type: Literal["hello"]
    version: int
    transport: Literal["websocket"]
    session_id: str
    audio_params: dict


class ListenMessage(TypedDict, total=False):
    type: Literal["listen"]
    session_id: str
    state: Literal["start", "stop", "detect"]
    mode: Literal["auto", "manual", "realtime"]
    text: str
