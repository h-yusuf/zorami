from sqlalchemy.ext.asyncio import AsyncSession


def test_health_reports_database_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "ok"


async def test_health_reports_database_down(client, monkeypatch):
    # Regresi: sidebar dashboard sebelumnya nampilin teks statis "postgres ok"
    # yang tidak pernah beneran mengecek apa pun - endpoint ini harus benar-benar
    # menyentuh database dan melaporkan kegagalan kalau query-nya error.
    async def _broken_execute(self, *args, **kwargs):
        raise ConnectionError("simulated db down")

    monkeypatch.setattr(AsyncSession, "execute", _broken_execute)

    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "down"
