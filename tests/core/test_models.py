import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.models import ActivationCode, Base, Device, Owner, User


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def test_user_owner_device_round_trip(session):
    user = User(id=uuid.uuid4(), email="yusuf@tspindonesia.com", password_hash="argon2-hash")
    session.add(user)
    await session.flush()

    owner = Owner(id=uuid.uuid4(), user_id=user.id)
    session.add(owner)
    await session.flush()

    device = Device(
        id=uuid.uuid4(),
        owner_id=owner.id,
        device_id="A4:CF:12:9B:00:7E",
        client_id="b7f19c02-0000-0000-0000-000000000000",
        alias="Zora Ruang Tamu",
        token_hash="hashed-token",
    )
    session.add(device)
    await session.commit()

    fetched = await session.get(Device, device.id)
    assert fetched.owner_id == owner.id
    assert fetched.device_id == "A4:CF:12:9B:00:7E"
    assert fetched.agent_id is None

    fetched_owner = await session.get(Owner, owner.id)
    assert fetched_owner.user_id == user.id


async def test_activation_code_expiry_field(session):
    user = User(id=uuid.uuid4(), email="a@b.com", password_hash="argon2-hash")
    session.add(user)
    await session.flush()

    owner = Owner(id=uuid.uuid4(), user_id=user.id)
    session.add(owner)
    await session.flush()

    code = ActivationCode(
        id=uuid.uuid4(),
        code="4K9T2X",
        device_id="A4:CF:12:9B:07:F3",
        client_id="unclaimed-client",
        expires_at=datetime.now(timezone.utc),
    )
    session.add(code)
    await session.commit()

    fetched = await session.get(ActivationCode, code.id)
    assert fetched.claimed_at is None
