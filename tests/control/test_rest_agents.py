def test_list_agents_empty(client, auth_headers):
    r = client.get("/api/agents", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


def test_create_agent(client, auth_headers):
    r = client.post(
        "/api/agents",
        headers=auth_headers,
        json={
            "name": "Zora Assistant",
            "system_prompt": "Kamu adalah asisten suara yang ramah.",
            "llm_model": "gpt-4o-mini",
            "temperature": 0.7,
            "max_tokens": 256,
            "tts_provider": "piper",
            "tts_voice": "id_ID",
            "emotion_level": "medium",
            "tools_enabled": ["websearch"],
            "memory_enabled": False,
            "chat_log_level": 1,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Zora Assistant"
    assert data["id"] is not None


def test_get_agent(client, auth_headers):
    create = client.post("/api/agents", headers=auth_headers, json={"name": "Test"})
    agent_id = create.json()["id"]
    r = client.get(f"/api/agents/{agent_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["name"] == "Test"


def test_update_agent(client, auth_headers):
    create = client.post("/api/agents", headers=auth_headers, json={"name": "Old"})
    agent_id = create.json()["id"]
    r = client.put(
        f"/api/agents/{agent_id}", headers=auth_headers, json={"name": "New", "temperature": 0.5}
    )
    assert r.status_code == 200
    assert r.json()["name"] == "New"
    assert r.json()["temperature"] == 0.5


def test_delete_agent(client, auth_headers):
    create = client.post("/api/agents", headers=auth_headers, json={"name": "Delete Me"})
    agent_id = create.json()["id"]
    r = client.delete(f"/api/agents/{agent_id}", headers=auth_headers)
    assert r.status_code == 204
    r2 = client.get(f"/api/agents/{agent_id}", headers=auth_headers)
    assert r2.status_code == 404


def test_cannot_access_other_owner_agent(client, auth_headers, other_auth_headers):
    create = client.post("/api/agents", headers=auth_headers, json={"name": "Mine"})
    agent_id = create.json()["id"]

    r = client.get(f"/api/agents/{agent_id}", headers=other_auth_headers)
    assert r.status_code == 404

    r2 = client.get("/api/agents", headers=other_auth_headers)
    assert r2.json() == []

    r3 = client.put(
        f"/api/agents/{agent_id}", headers=other_auth_headers, json={"name": "Hijacked"}
    )
    assert r3.status_code == 404

    r4 = client.delete(f"/api/agents/{agent_id}", headers=other_auth_headers)
    assert r4.status_code == 404
