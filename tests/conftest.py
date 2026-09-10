import os

from sqlalchemy.engine import make_url

# WAJIB paling atas, sebelum import apa pun dari `app.*` - Settings() di
# app/config.py adalah singleton yang dibaca sekali saat modul itu pertama kali
# di-import. Kalau kita telat set env var ini, test suite bakal ikutan pakai
# ZORA_DATABASE_URL dari .env - yaitu DB yang SAMA dengan yang dipakai Docker/dev
# manual. Itu yang kejadian sebelumnya: `_clean_db` (di bawah) men-DELETE semua
# baris tiap test, jadi menjalankan `pytest` menghapus data yang di-seed manual
# di dashboard Docker. Test suite HARUS py sendiri, terpisah total.
_dev_url = os.environ.get("ZORA_DATABASE_URL")
if _dev_url is None:
    # .env belum di-load ke environment (misal pytest dijalankan tanpa dotenv) -
    # baca langsung dari file .env kalau ada, atau pola default project.
    from pathlib import Path

    env_path = Path(__file__).resolve().parents[1] / ".env"
    _dev_url = "postgresql+asyncpg://zora:zora_dev_only@localhost:5432/zora_bridge"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.strip().startswith("ZORA_DATABASE_URL="):
                _dev_url = line.split("=", 1)[1].strip()
                break

_url = make_url(_dev_url)
_test_url = _url.set(database=f"{_url.database}_test")
os.environ["ZORA_DATABASE_URL"] = str(_test_url.render_as_string(hide_password=False))


def _ensure_test_database() -> None:
    """Bikin database test kalau belum ada - dijalankan sinkron, sekali, saat
    modul ini di-import (sebelum test apa pun jalan)."""
    import psycopg2
    import psycopg2.errors

    conn = psycopg2.connect(
        dbname="postgres",
        user=_url.username,
        password=_url.password,
        host=_url.host,
        port=_url.port,
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(f'CREATE DATABASE "{_test_url.database}"')
    except psycopg2.errors.DuplicateDatabase:
        pass
    finally:
        conn.close()


def _ensure_schema() -> None:
    """Pastikan semua tabel model ada di database test - idempotent, aman
    dipanggil tiap kali test suite start."""
    from sqlalchemy import create_engine

    from app.core.models import Base

    sync_url = _test_url.set(drivername="postgresql+psycopg2")
    engine = create_engine(sync_url)
    Base.metadata.create_all(engine)
    engine.dispose()


_ensure_test_database()
_ensure_schema()


import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.db import get_sessionmaker, reset_engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402

_TABLES = (
    "messages",
    "conversations",
    "activation_codes",
    "devices",
    "provider_creds",
    "agents",
    "owners",
    "users",
)


@pytest.fixture(autouse=True)
async def _clean_db():
    """Kosongkan tabel domain sebelum tiap test - test integrasi Task 3+ menulis
    ke Postgres sungguhan lewat get_sessionmaker(), jadi butuh state bersih.
    Ini jalan di database TEST (lihat override ZORA_DATABASE_URL di atas modul
    ini), bukan database dev/Docker - aman dijalankan kapan saja.

    Pakai DELETE FROM, BUKAN TRUNCATE. TRUNCATE butuh AccessExclusiveLock per
    tabel; kalau ada koneksi lain (mis. sesi test sebelumnya yang belum benar2
    selesai menutup transaksinya, atau TestClient dengan event loop terpisah)
    masih pegang AccessShareLock di tabel yang sama, dua-duanya bisa saling
    tunggu -> deadlock Postgres (ketemu random waktu test rest_conversations
    ditulis). DELETE FROM cuma butuh ROW EXCLUSIVE lock, jauh lebih kecil
    kemungkinan bentrok dengan pembaca lain."""
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        for table in _TABLES:
            await session.execute(text(f"DELETE FROM {table}"))
        await session.commit()
    yield
    await reset_engine()


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


@pytest.fixture
async def seeded_owner():
    """Seed satu User + Owner ke test DB. Email 'owner@zora.local', password plaintext
    'testpass123' (di-hash lewat hash_password sebelum disimpan)."""
    from app.core.models import Owner, User

    session_maker = get_sessionmaker()
    async with session_maker() as session:
        user = User(email="owner@zora.local", password_hash=hash_password("testpass123"))
        session.add(user)
        await session.flush()
        owner = Owner(user_id=user.id)
        session.add(owner)
        await session.commit()
        await session.refresh(user)
        await session.refresh(owner)
        return {"user_id": str(user.id), "owner_id": str(owner.id)}


@pytest.fixture
def auth_headers(client, seeded_owner):
    login = client.post(
        "/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"}
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def other_owner():
    """Owner kedua untuk test tenant isolation."""
    from app.core.models import Owner, User

    session_maker = get_sessionmaker()
    async with session_maker() as session:
        user = User(email="other@zora.local", password_hash=hash_password("testpass123"))
        session.add(user)
        await session.flush()
        owner = Owner(user_id=user.id)
        session.add(owner)
        await session.commit()
        await session.refresh(user)
        await session.refresh(owner)
        return {"user_id": str(user.id), "owner_id": str(owner.id)}


@pytest.fixture
def other_auth_headers(client, other_owner):
    login = client.post(
        "/api/auth/login", json={"email": "other@zora.local", "password": "testpass123"}
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
