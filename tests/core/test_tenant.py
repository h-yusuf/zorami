from unittest.mock import AsyncMock, MagicMock

from app.core.tenant import TenantSession


async def test_get_returns_none_for_wrong_owner():
    mock_obj = MagicMock()
    mock_obj.owner_id = "owner-A"
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=mock_obj)

    ts = TenantSession(mock_session, "owner-B")
    result = await ts.get(MagicMock(), "some-id")
    assert result is None


async def test_get_returns_obj_for_correct_owner():
    mock_obj = MagicMock()
    mock_obj.owner_id = "owner-A"
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=mock_obj)

    ts = TenantSession(mock_session, "owner-A")
    result = await ts.get(MagicMock(), "some-id")
    assert result is mock_obj


async def test_owner_id_accessible():
    mock_session = AsyncMock()
    ts = TenantSession(mock_session, "owner-XYZ")
    assert ts.owner_id == "owner-XYZ"
