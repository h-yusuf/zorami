from app.core.security import create_access_token, decode_access_token, hash_password, verify_password


def test_hash_and_verify_password():
    h = hash_password("testpass123")
    assert verify_password("testpass123", h) is True


def test_verify_wrong_password():
    h = hash_password("testpass123")
    assert verify_password("wrongpass", h) is False


def test_create_and_decode_token():
    token = create_access_token("user-uuid-123")
    assert token is not None
    user_id = decode_access_token(token)
    assert user_id == "user-uuid-123"


def test_decode_invalid_token():
    assert decode_access_token("invalid.token.here") is None
