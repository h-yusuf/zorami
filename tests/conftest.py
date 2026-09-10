import pytest
from sqlalchemy import text

from app.core.db import get_sessionmaker

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
