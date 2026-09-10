import logging
from collections import defaultdict
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

_subscribers: dict[str, set[Callable[[Any], Awaitable[None]]]] = defaultdict(set)


async def publish(topic: str, payload: Any) -> None:
    """Publish event ke semua subscriber. Non-blocking - handler yang gagal tidak
    boleh menghentikan publisher atau subscriber lain (spec §3: event bus in-process)."""
    for cb in list(_subscribers.get(topic, set())):
        try:
            await cb(payload)
        except Exception:
            logger.exception("Bus handler gagal untuk topic %s", topic)


async def subscribe(topic: str, callback: Callable[[Any], Awaitable[None]]) -> None:
    _subscribers[topic].add(callback)


async def unsubscribe(topic: str, callback: Callable[[Any], Awaitable[None]]) -> None:
    _subscribers[topic].discard(callback)


def clear() -> None:
    """Bersihkan semua subscription - dipakai test."""
    _subscribers.clear()
