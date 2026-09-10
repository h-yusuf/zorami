from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

_engine: AsyncEngine | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        # NullPool: setiap test/request pakai event loop asyncio sendiri (pytest-asyncio
        # default function-scoped loop). Koneksi asyncpg yang di-pool lintas loop bikin
        # "RuntimeError: Event loop is closed" saat teardown - NullPool bikin koneksi
        # baru tiap kali, tidak ada yang disimpan lintas loop.
        _engine = create_async_engine(settings.database_url, pool_pre_ping=True, poolclass=NullPool)
    return _engine


def get_sessionmaker() -> async_sessionmaker:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_session():
    async with get_sessionmaker()() as session:
        yield session
