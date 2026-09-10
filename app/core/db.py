import asyncio
import weakref

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

# Engine di-cache PER event loop (bukan satu global). NullPool sudah mencegah
# koneksi asyncpg dipakai lintas loop, tapi AsyncEngine sendiri juga menyimpan
# state (lock/greenlet bridge) yang terikat ke loop saat dibuat. Dalam test
# suite ada DUA loop berbeda yang aktif dalam satu test yang sama: loop
# pytest-asyncio (dipakai helper `get_sessionmaker()` langsung) dan loop
# internal TestClient/anyio portal (dipakai endpoint FastAPI lewat
# `get_session()`). Satu engine global dipakai gantian dari dua loop ini
# menghasilkan galat transient acak (deadlock Postgres, FK violation palsu,
# "Could not refresh instance").
#
# PENTING: key HARUS objek loop itu sendiri (WeakKeyDictionary), BUKAN id(loop).
# id() Python cuma alamat memori - begitu loop lama di-garbage-collect, id()
# bisa DIPAKAI ULANG oleh objek loop baru yang tidak berhubungan. Dengan dict
# biasa ber-key id(loop), ini bikin get_engine() salah balikin engine basi
# (punya koneksi ke loop yang sudah mati) seolah-olah valid untuk loop baru -
# persis gejala deadlock/FK-violation acak yang ditemukan saat test
# tests/control/test_rest_conversations.py ditulis. WeakKeyDictionary
# menghindari ini sekaligus otomatis buang entry begitu loop-nya di-GC.
_engines: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, AsyncEngine]" = (
    weakref.WeakKeyDictionary()
)


def get_engine() -> AsyncEngine:
    loop = asyncio.get_running_loop()
    engine = _engines.get(loop)
    if engine is None:
        engine = create_async_engine(settings.database_url, pool_pre_ping=True, poolclass=NullPool)
        _engines[loop] = engine
    return engine


def get_sessionmaker() -> async_sessionmaker:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_session():
    async with get_sessionmaker()() as session:
        yield session


async def reset_engine() -> None:
    """Dispose engine punya loop yang sedang berjalan sekarang - dipakai test
    suite di antar test supaya tidak ada koneksi asyncpg menumpuk lintas test."""
    loop = asyncio.get_running_loop()
    engine = _engines.pop(loop, None)
    if engine is not None:
        try:
            await engine.dispose()
        except Exception:
            pass
