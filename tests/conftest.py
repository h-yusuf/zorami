import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.db import get_sessionmaker, reset_engine
from app.core.security import hash_password

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
