import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.db import get_sessionmaker
from app.core.security import hash_password

_TABLES = (
    "messages",
    "conversations",
    "activation_codes",
    "devices",
    "owners",
    "users",
)


@pytest.fixture(autouse=True)
async def _clean_db():
    """Kosongkan tabel domain sebelum tiap test - test integrasi Task 3+ menulis
    ke Postgres sungguhan lewat get_sessionmaker(), jadi butuh state bersih."""
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        for table in _TABLES:
            await session.execute(text(f"TRUNCATE TABLE {table} CASCADE"))
        await session.commit()
    yield


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
