def test_list_providers_empty(client, auth_headers):
    r = client.get("/api/providers", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


def test_create_provider_encrypts_secret(client, auth_headers):
    r = client.post(
        "/api/providers",
        headers=auth_headers,
        json={
            "kind": "llm",
            "provider_code": "omnirouter",
            "config": {"base_url": "http://localhost:20128/v1"},
            "secret": "sk-supersecretvalue1234",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["secret_last4"] == "1234"
    assert "secret" not in data
    assert "secret_encrypted" not in data
    assert data["provider_code"] == "omnirouter"


def test_list_providers_only_last4(client, auth_headers):
    client.post(
        "/api/providers",
        headers=auth_headers,
        json={"kind": "stt", "provider_code": "groq", "secret": "abcd1234wxyz"},
    )
    r = client.get("/api/providers", headers=auth_headers)
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["secret_last4"] == "wxyz"
    assert "secret_encrypted" not in r.json()[0]


def test_delete_provider(client, auth_headers):
    create = client.post(
        "/api/providers",
        headers=auth_headers,
        json={"kind": "tts", "provider_code": "piper", "secret": "none"},
    )
    provider_id = create.json()["id"]
    r = client.delete(f"/api/providers/{provider_id}", headers=auth_headers)
    assert r.status_code == 204
    r2 = client.get("/api/providers", headers=auth_headers)
    assert r2.json() == []


def test_test_connection_returns_placeholder_for_unimplemented_combo(client, auth_headers):
    create = client.post(
        "/api/providers",
        headers=auth_headers,
        json={"kind": "search", "provider_code": "searxng", "secret": "none"},
    )
    provider_id = create.json()["id"]
    r = client.post(f"/api/providers/{provider_id}/test", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert "belum diimplementasikan" in r.json()["message"]


def test_test_connection_calls_real_omnirouter(client, auth_headers, httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="http://localhost:20128/v1/models",
        json={"data": [{"id": "model-a"}, {"id": "model-b"}]},
    )

    create = client.post(
        "/api/providers",
        headers=auth_headers,
        json={
            "kind": "llm",
            "provider_code": "omnirouter",
            "config": {"base_url": "http://localhost:20128/v1"},
            "secret": "sk-test",
        },
    )
    provider_id = create.json()["id"]

    r = client.post(f"/api/providers/{provider_id}/test", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "2 model terbaca" in body["message"]


def test_test_connection_reports_failure_without_crashing(client, auth_headers, httpx_mock):
    httpx_mock.add_response(method="GET", url="https://api.groq.com/openai/v1/models", status_code=401)

    create = client.post(
        "/api/providers",
        headers=auth_headers,
        json={"kind": "stt", "provider_code": "groq", "secret": "bad-key"},
    )
    provider_id = create.json()["id"]

    r = client.post(f"/api/providers/{provider_id}/test", headers=auth_headers)
    assert r.status_code == 200  # test-connection tidak pernah 500 walau provider gagal
    body = r.json()
    assert body["ok"] is False
    assert "401" in body["message"]


def test_cannot_access_other_owner_provider(client, auth_headers, other_auth_headers):
    create = client.post(
        "/api/providers",
        headers=auth_headers,
        json={"kind": "llm", "provider_code": "omnirouter", "secret": "sk-mine1234"},
    )
    provider_id = create.json()["id"]

    r = client.get("/api/providers", headers=other_auth_headers)
    assert r.json() == []

    r2 = client.delete(f"/api/providers/{provider_id}", headers=other_auth_headers)
    assert r2.status_code == 404

    r3 = client.post(f"/api/providers/{provider_id}/test", headers=other_auth_headers)
    assert r3.status_code == 404
