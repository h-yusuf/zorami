def test_login_success(client, seeded_owner):
    r = client.post("/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "owner_id" in data


def test_login_wrong_password(client, seeded_owner):
    r = client.post("/api/auth/login", json={"email": "owner@zora.local", "password": "wrong"})
    assert r.status_code == 401


def test_login_unknown_email(client):
    r = client.post("/api/auth/login", json={"email": "nobody@nowhere.com", "password": "x"})
    assert r.status_code == 401


def test_protected_endpoint_without_token(client):
    r = client.get("/api/auth/me")
    # HTTPBearer di versi fastapi/starlette proyek ini return 401 (bukan 403) tanpa credentials
    assert r.status_code == 401


def test_protected_endpoint_with_token(client, seeded_owner):
    login = client.post("/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"})
    token = login.json()["access_token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["owner_id"] == login.json()["owner_id"]
