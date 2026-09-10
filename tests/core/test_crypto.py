from app.core.crypto import decrypt_secret, encrypt_secret, last4


def test_round_trip():
    plaintext = "sk-or-abcdef1234567890"
    token = encrypt_secret(plaintext)
    assert token != plaintext
    assert decrypt_secret(token) == plaintext


def test_last4():
    assert last4("sk-or-abcdef1234567890") == "7890"


def test_last4_short_string():
    assert last4("ab") == "ab"
