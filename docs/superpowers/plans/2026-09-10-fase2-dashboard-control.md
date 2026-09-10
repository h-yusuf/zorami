# Fase 2 — Kontrol Device + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setelah Fase 1 voice loop jalan end-to-end, Fase 2 menambahkan kontrol device via MCP (tool-calling LLM ke device), REST API + auth dasar untuk dashboard, tujuh layar React dashboard, dan live monitor real-time via WebSocket browser + event bus. Setelah fase ini, user bisa kelola agent/provider/device dari web UI, melihat voice loop berjalan secara live, dan LLM bisa memanggil tool device (dengan allowlist).

**Architecture:** Masih modular monolith satu proses FastAPI. Paket `control/` sekarang dibangun — berisi REST API + WebSocket untuk browser. `control/` TIDAK boleh impor `device/` langsung; komunikasi lewat event bus (pub/sub in-process asyncio) dan DB. Paket `device/` ditambahi `mcp_client.py` untuk komunikasi JSON-RPC ke device. Frontend React+Vite+Tailwind di `frontend/`.

**Tech Stack:** Backend: Python 3.11+, FastAPI, SQLAlchemy 2.0 (async), Pydantic v2, httpx, websockets, pytest + pytest-asyncio. Frontend: React 19, Vite, Tailwind CSS, TanStack Query, `react-router-dom`, `@tanstack/react-table`. Event bus: asyncio Queue-based pub/sub in-process (diganti Valkey saat multi-worker — catat di README).

**Spec:** [docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md](../specs/2026-09-10-zora-bridge-system-design.md) — plan ini mengimplementasikan §5 (MCP), §3 (event bus), §6 (model data lengkap), §9 poin 10-13. [docs/superpowers/specs/2026-09-10-zora-bridge-ui-design.md](../specs/2026-09-10-zora-bridge-ui-design.md) — tujuh layar dashboard.

## Global Constraints

- `control/` tidak boleh impor `device/` — lewat event bus + DB saja. Satu tempat yang salah = kebocoran lintas akun atau circular import.
- Allowlist tool MCP, bukan blocklist. `self.reboot` dan `self.upgrade_firmware` BISA dipanggil device walau tidak dilist — filter di bridge wajib (spec §5, §8).
- Timeout wajib di setiap `tools/call` ke device — firmware tidak punya timeout sendiri, panggilan bisa menggantung selamanya (spec §5).
- Key BYOK tidak pernah dikirim balik ke browser — hanya `secret_last4` (spec §8).
- Token device disimpan sebagai hash, bukan plaintext (spec §8).
- Scoping tenant di lapisan session/repository, bukan diserahkan ke pemanggil (spec §8).
- Audio percakapan = data paling sensitif. Izin putar audio dipisah dari izin baca transkrip (spec §8). Retensi audio berbatas (usul 30 hari).
- Event bus pub/sub in-process hanya benar selama satu worker. Jalankan satu worker + catat di README. Saat multi-worker, ganti implementasi ke Valkey.
- id JSON-RPC ke device harus integer, bukan string (spec §5).
- `tools/list` paginasi berbasis NAMA TOOL (bukan indeks), batas 8000 byte pada JSON hasil. `nextCursor` = nama tool pertama yang tidak kebagian. Kalau habis, kunci hilang (bukan kosong).
- Frontend dashboard adalah PWA-opsional, tapi wajib responsif dan jalan di Chrome/Firefox modern.
- Timestamp semua UTC.
- **Jangan tulis kode/config library manual.** Pakai command resmi: `npm create vite@latest`, `npx tailwindcss init -p`, `npm install`, `docker init`, `alembic init`, `npx tsc --init`, dll. Lebih cepat + akurat + tidak ada typo. File config (tailwind.config.js, tsconfig.json, postcss.config.js) di-generate oleh command resmi, lalu di-patch sesuai kebutuhan.

---

## File Structure

```
zora-bridge/
  app/
    main.py                        # +mount control router + static frontend
    config.py                      # +settings frontend, cors
    core/
      db.py                         # (Fase 1, tidak diubah)
      crypto.py                    # (Fase 1)
      models.py                    # +tabel agent_snapshots, memories (kalau belum), +relasi
      bus.py                       # BARU: event bus pub/sub asyncio
      security.py                  # BARU: password verify (argon2id), create_access_token
      tenant.py                    # BARU: scoped session — inject owner_id ke query otomatis
    adapters/
      llm/ (Fase 1, tidak diubah)
      stt/ (Fase 1)
      tts/ (Fase 1)
      search/ (Fase 1)
    device/
      ota.py                       # (Fase 1)
      ws.py                        # +emit event ke bus
      protocol_types.py            # (Fase 1)
      session.py                   # +expose state untuk live monitor
      endpointer.py                # (Fase 1)
      pacer.py                     # (Fase 1)
      opus_codec.py                # (Fase 1)
      pipeline.py                  # +inject MCP tool-calls kalau LLM minta
      mcp_client.py                # BARU: JSON-RPC client ke device via WS session
    control/
      __init__.py
      auth.py                      # BARU: dependency FastAPI — verify JWT, inject current_owner
      schemas.py                   # BARU: Pydantic response models (AgentOut, DeviceOut, dll)
      rest/
        __init__.py
        agents.py                   # BARU: CRUD agent
        providers.py                # BARU: CRUD provider_creds + tes koneksi
        devices.py                  # BARU: list/claim/update/delete devices
        conversations.py            # BARU: list/search/transcript/delete
        overview.py                 # BARU: agregasi dashboard overview
      monitor.py                   # BARU: WebSocket /ws/monitor — stream event ke browser
  frontend/
    package.json
    vite.config.ts
    tailwind.config.js
    index.html
    src/
      main.tsx
      App.tsx                       # router + layout
      api/
        client.ts                   # fetch wrapper + auth token
        hooks.ts                    # TanStack Query hooks
      components/
        Layout.tsx                  # sidebar + topbar
        StatCard.tsx
        ProviderBadge.tsx
        LatencyBar.tsx
      pages/
        Overview.tsx
        Agents.tsx
        Providers.tsx
        Devices.tsx
        LiveMonitor.tsx
        Conversations.tsx
        UsersRoles.tsx              # stub — lencana "Fase 3"
  tests/
    core/test_bus.py                # BARU
    core/test_security.py           # BARU
    core/test_tenant.py             # BARU
    control/test_auth.py            # BARU
    control/test_rest_agents.py     # BARU
    control/test_rest_providers.py  # BARU
    control/test_rest_devices.py    # BARU
    control/test_rest_conversations.py # BARU
    control/test_rest_overview.py   # BARU
    control/test_monitor.py         # BARU
    device/test_mcp_client.py       # BARU
    device/test_pipeline_mcp.py      # BARU
    frontend/                        # Vitest (opsional di Fase 2 awal)
```

---

## Precondition: Fase 1 sudah jalan

Sebelum executor mulai Task 1 Fase 2, hal berikut harus sudah lulus dari Fase 1:

- Voice loop end-to-end jalan: device bicara → STT → LLM → TTS → device menjawab.
- Endpoint OTA `check_version` + `/activate` jalan dengan semantik 202/200.
- WebSocket handshake jalan, `audio_params` 24000/60.
- Adapter LLM (omnirouter), STT (Groq Whisper), TTS (Piper) masing-masing punya Protocol + implementasi.
- `endpointer.py` dan `pacer.py` jalan.
- Postgres + Alembic + model dasar (`users`, `owners`, `agents`, `devices`, `activation_codes`, `provider_creds`, `conversations`, `messages`) sudah ada.
- `crypto.py` (Fernet encrypt/decrypt) jalan.
- `pipeline.py` sudah orkestrasi STT → LLM → TTS end-to-end.
- Satu owner sudah di-seed di DB (untuk auth Fase 2).
- `pytest -v` lulus semua.

---

## Task 11: Event Bus + Tenant Scoping

Dibutuhkan sebelum MCP (Task 14) dan monitor (Task 17) karena keduanya butuh event bus untuk komunikasi device → control tanpa impor langsung. Tenant scoping wajib sebelum REST API (Task 15-16) untuk mencegah kebocoran lintas akun.

**Files:**
- Create: `app/core/bus.py`
- Create: `app/core/tenant.py`
- Create: `app/core/security.py`
- Test: `tests/core/test_bus.py`
- Test: `tests/core/test_tenant.py`
- Test: `tests/core/test_security.py`

### `app/core/bus.py`

Event bus pub/sub in-process asyncio. Satu implementasi, bukan dua.

```python
import asyncio
from collections import defaultdict
from typing import Any, Awaitable, Callable

# topic -> set of subscriber callbacks
_subscribers: dict[str, set[Callable[[Any], Awaitable[None]]]] = defaultdict(set)

async def publish(topic: str, payload: Any) -> None:
    """Publish event ke semua subscriber. Non-blocking — kalau handler lambat, tidak memblok publisher."""
    for cb in list(_subscribers.get(topic, set())):
        try:
            await cb(payload)
        except Exception:
            pass  # handler error tidak boleh memblok publisher

async def subscribe(topic: str, callback: Callable[[Any], Awaitable[None]]) -> None:
    """Subscribe callback ke topic."""
    _subscribers[topic].add(callback)

async def unsubscribe(topic: str, callback: Callable[[Any], Awaitable[None]]) -> None:
    """Unsubscribe callback dari topic."""
    _subscribers[topic].discard(callback)

def clear() -> None:
    """Clear all subscriptions — untuk testing."""
    _subscribers.clear()
```

Event yang akan dipancarkan (kontrak nama topic):
- `device.connected` — payload: `{device_id, session_id, agent_id}`
- `device.disconnected` — payload: `{device_id, session_id}`
- `device.listening` — payload: `{device_id, session_id, mode}`
- `device.speaking` — payload: `{device_id, session_id}`
- `turn.started` — payload: `{device_id, session_id, conversation_id}`
- `turn.stage` — payload: `{device_id, session_id, stage, latency_ms}` (stage: vad_end, stt, search, llm, tts_start)
- `turn.completed` — payload: `{device_id, session_id, conversation_id, total_ms}`
- `turn.aborted` — payload: `{device_id, session_id}`

### `app/core/tenant.py`

Scoped session — inject `owner_id` ke query otomatis. Semua repository di `control/` harus pakai ini.

```python
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession

class TenantSession:
    """Wrapper AsyncSession yang otomatis filter by owner_id."""
    def __init__(self, session: AsyncSession, owner_id: str):
        self._session = session
        self.owner_id = owner_id

    async def get(self, model, ident):
        obj = await self._session.get(model, ident)
        if obj is not None and getattr(obj, "owner_id", None) != self.owner_id:
            return None
        return obj

    async def execute(self, stmt):
        # caller tetap harus filter by owner_id, tapi ini untuk lapis tambahan
        return await self._session.execute(stmt)

    @property
    def session(self) -> AsyncSession:
        return self._session
```

### `app/core/security.py`

Password verify (argon2id) + create_access_token (JWT HS256).

```python
import os, time, jwt
from argon2 import PasswordHasher
from app.config import settings

_hasher = PasswordHasher()

def hash_password(password: str) -> str:
    return _hasher.hash(password)

def verify_password(password: str, hash: str) -> bool:
    try:
        return _hasher.verify(hash, password)
    except Exception:
        return False

def create_access_token(user_id: str) -> str:
    payload = {"sub": user_id, "iat": int(time.time()), "exp": int(time.time()) + 86400 * 7}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return payload.get("sub")
    except Exception:
        return None
```

### Test: `tests/core/test_bus.py`

```python
import pytest
import asyncio
from app.core.bus import publish, subscribe, unsubscribe, clear

@pytest.mark.asyncio
async def test_publish_subscribe_basic():
    clear()
    received = []

    async def handler(payload):
        received.append(payload)

    await subscribe("device.connected", handler)
    await publish("device.connected", {"device_id": "dev1", "session_id": "s1"})
    await asyncio.sleep(0.01)

    assert received == [{"device_id": "dev1", "session_id": "s1"}]

@pytest.mark.asyncio
async def test_unsubscribe():
    clear()
    received = []

    async def handler(payload):
        received.append(payload)

    await subscribe("device.connected", handler)
    await unsubscribe("device.connected", handler)
    await publish("device.connected", {"device_id": "dev1"})
    await asyncio.sleep(0.01)

    assert received == []

@pytest.mark.asyncio
async def test_handler_error_does_not_block_others():
    clear()
    received = []

    async def bad_handler(payload):
        raise RuntimeError("boom")

    async def good_handler(payload):
        received.append(payload)

    await subscribe("turn.stage", bad_handler)
    await subscribe("turn.stage", good_handler)
    await publish("turn.stage", {"stage": "stt"})
    await asyncio.sleep(0.01)

    assert received == [{"stage": "stt"}]

@pytest.mark.asyncio
async def test_multiple_subscribers():
    clear()
    results_a, results_b = [], []

    async def handler_a(payload): results_a.append(payload)
    async def handler_b(payload): results_b.append(payload)

    await subscribe("turn.completed", handler_a)
    await subscribe("turn.completed", handler_b)
    await publish("turn.completed", {"total_ms": 1500})
    await asyncio.sleep(0.01)

    assert results_a == [{"total_ms": 1500}]
    assert results_b == [{"total_ms": 1500}]
```

### Test: `tests/core/test_security.py`

```python
import pytest
from app.core.security import hash_password, verify_password, create_access_token, decode_access_token

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
```

### Test: `tests/core/test_tenant.py`

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from app.core.tenant import TenantSession

@pytest.mark.asyncio
async def test_get_returns_none_for_wrong_owner():
    mock_obj = MagicMock()
    mock_obj.owner_id = "owner-A"
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=mock_obj)

    ts = TenantSession(mock_session, "owner-B")
    result = await ts.get(MagicMock(), "some-id")
    assert result is None

@pytest.mark.asyncio
async def test_get_returns_obj_for_correct_owner():
    mock_obj = MagicMock()
    mock_obj.owner_id = "owner-A"
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=mock_obj)

    ts = TenantSession(mock_session, "owner-A")
    result = await ts.get(MagicMock(), "some-id")
    assert result is mock_obj

@pytest.mark.asyncio
async def test_owner_id_accessible():
    mock_session = AsyncMock()
    ts = TenantSession(mock_session, "owner-XYZ")
    assert ts.owner_id == "owner-XYZ"
```

### Steps

- [ ] **Step 1:** Tulis `tests/core/test_bus.py` — 4 test: basic pub/sub, unsubscribe, handler error isolation, multiple subscribers.
- [ ] **Step 2:** Jalankan test — expected: FAIL (bus.py belum ada).
- [ ] **Step 3:** Tulis `app/core/bus.py` sesuai spec di atas.
- [ ] **Step 4:** Jalankan test — expected: PASS.
- [ ] **Step 5:** Tulis `tests/core/test_security.py` — hash/verify password, create/decode token, invalid token.
- [ ] **Step 6:** Jalankan test — expected: FAIL (security.py belum ada).
- [ ] **Step 7:** Tulis `app/core/security.py`. Tambah `jwt_secret` dan `argon2-cffi`, `pyjwt` ke `pyproject.toml`.
- [ ] **Step 8:** Jalankan test — expected: PASS.
- [ ] **Step 9:** Tulis `tests/core/test_tenant.py` — 3 test: wrong owner returns None, correct owner returns obj, owner_id accessible.
- [ ] **Step 10:** Tulis `app/core/tenant.py`.
- [ ] **Step 11:** Jalankan test — expected: PASS.
- [ ] **Step 12:** Tambah `jwt_secret` ke `app/config.py` Settings (dari env, default random untuk dev).
- [ ] **Step 13:** Tambah `get_session()` ke `app/core/db.py` — generator dependency FastAPI yang dipakai `control/auth.py` (Task 14) dan seluruh endpoint REST (Task 15):
  ```python
  async def get_session():
      async with get_sessionmaker()() as session:
          yield session
  ```
- [ ] **Step 14:** Jalankan `pytest -v tests/core/` — expected: PASS semua.
- [ ] **Step 15:** Commit.

```bash
git add app/core/bus.py app/core/tenant.py app/core/security.py app/config.py tests/core/test_bus.py tests/core/test_security.py tests/core/test_tenant.py pyproject.toml
git commit -m "feat: event bus, tenant scoping, and auth security helpers"
```

---

## Task 12: MCP Client — JSON-RPC ke Device

Inti Fase 2. LLM bisa memanggil tool device (ambil gambar kamera, baca sensor, dll) via MCP JSON-RPC. Dua hal keamanan wajib: allowlist tool + timeout per `tools/call`.

**Files:**
- Create: `app/device/mcp_client.py`
- Test: `tests/device/test_mcp_client.py`

### `app/device/mcp_client.py`

```python
import asyncio
import json
import time
from typing import Any

from app.core.bus import publish

# Allowlist tool MCP yang boleh diekspos ke LLM.
# self.reboot dan self.upgrade_firmware TIDAK boleh di sini.
DEFAULT_ALLOWLIST: set[str] = {
    "take_photo",
    "get_device_info",
    # tambah tool lain setelah verifikasi aman
}

DANGEROUS_TOOLS: set[str] = {
    "self.reboot",
    "self.upgrade_firmware",
    # tool berbahaya yang TIDAK diekspos walau device punya
}


class McpClient:
    """JSON-RPC client ke device via WebSocket session."""

    def __init__(self, ws_send_fn, *, call_timeout: float = 10.0, allowlist: set[str] | None = None):
        self._send = ws_send_fn  # async fn(str) -> None
        self._call_timeout = call_timeout
        self._allowlist = allowlist or DEFAULT_ALLOWLIST
        self._pending: dict[int, asyncio.Future] = {}
        self._next_id: int = 1

    async def initialize(self) -> dict[str, Any] | None:
        """Kirim initialize sekali per koneksi untuk ambil vision URL + token."""
        result = await self._call("initialize", {})
        return result

    async def list_tools(self, cursor: str | None = None, with_user_tools: bool = True) -> dict[str, Any]:
        """Paginasi tools/list berbasis NAMA TOOL. Batas 8000 byte JSON hasil."""
        params = {"withUserTools": with_user_tools}
        if cursor is not None:
            params["cursor"] = cursor

        result = await self._call("tools/list", params)
        # result: {tools: [...], nextCursor?: str}
        return result

    async def list_all_tools(self) -> list[dict[str, Any]]:
        """Fetch semua halaman tools/list."""
        all_tools: list[dict[str, Any]] = []
        cursor: str | None = None

        while True:
            page = await self.list_tools(cursor=cursor, with_user_tools=True)
            all_tools.extend(page.get("tools", []))

            cursor = page.get("nextCursor")
            if cursor is None:
                break

        return all_tools

    async def get_allowed_tools(self) -> list[dict[str, Any]]:
        """List tool yang BOLEH diekspos ke LLM (setelah allowlist filter)."""
        all_tools = await self.list_all_tools()
        return [t for t in all_tools if t.get("name") in self._allowlist]

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        """Call tool device dengan timeout sendiri. Tolak tool berbahaya."""
        if name in DANGEROUS_TOOLS:
            return {"isError": True, "content": [{"type": "text", "text": f"Tool '{name}' diblokir oleh allowlist bridge"}]}
        if name not in self._allowlist:
            return {"isError": True, "content": [{"type": "text", "text": f"Tool '{name}' tidak ada di allowlist bridge"}]}

        result = await self._call("tools/call", {"name": name, "arguments": arguments or {}})
        return result

    async def handle_response(self, msg: str) -> None:
        """Terima respons JSON-RPC dari device, selesaikan future yang menunggu."""
        data = json.loads(msg)
        rpc_id = data.get("id")
        if rpc_id is None or not isinstance(rpc_id, int):
            return  # bukan response ke call kita

        future = self._pending.pop(rpc_id, None)
        if future is None:
            return

        if "error" in data:
            # error dari device: hanya ada message, tanpa code
            err = data["error"]
            future.set_result({"isError": True, "content": [{"type": "text", "text": err.get("message", "unknown error")}]})
        elif "result" in data:
            future.set_result(data["result"])
        else:
            future.set_result({"isError": True, "content": [{"type": "text", "text": "malformed response"}]})

    async def _call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """Kirim JSON-RPC call ke device, tunggu respons dengan timeout."""
        rpc_id = self._next_id
        self._next_id += 1

        msg = json.dumps({"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params})

        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[rpc_id] = future

        await self._send(msg)
        await publish("device.mcp_call", {"method": method, "id": rpc_id})

        try:
            result = await asyncio.wait_for(future, timeout=self._call_timeout)
            return result
        except asyncio.TimeoutError:
            self._pending.pop(rpc_id, None)
            return {"isError": True, "content": [{"type": "text", "text": f"timeout: device tidak merespons {method} dalam {self._call_timeout}s"}]}
```

### Test: `tests/device/test_mcp_client.py`

```python
import pytest
import asyncio
import json
from app.device.mcp_client import McpClient, DEFAULT_ALLOWLIST, DANGEROUS_TOOLS

@pytest.mark.asyncio
async def test_list_tools_single_page():
    sent = []

    async def mock_send(msg: str):
        sent.append(msg)

    client = McpClient(mock_send)

    # Simulate device response
    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"tools": [{"name": "take_photo", "description": "ambil foto"}], }
            # no nextCursor = habis
        }))

    asyncio.create_task(respond())
    result = await client.list_tools()

    assert len(result["tools"]) == 1
    assert "nextCursor" not in result or result.get("nextCursor") is None

@pytest.mark.asyncio
async def test_list_tools_pagination():
    sent = []

    async def mock_send(msg: str):
        sent.append(msg)

    client = McpClient(mock_send)

    call_count = 0

    async def respond():
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.01)

        if call_count == 1:
            await client.handle_response(json.dumps({
                "jsonrpc": "2.0", "id": 1,
                "result": {"tools": [{"name": "tool_a"}], "nextCursor": "tool_b"}
            }))
        else:
            await client.handle_response(json.dumps({
                "jsonrpc": "2.0", "id": 2,
                "result": {"tools": [{"name": "tool_b"}]}
                # no nextCursor = habis
            }))

    asyncio.create_task(respond())
    asyncio.create_task(respond())

    all_tools = await client.list_all_tools()
    assert len(all_tools) == 2

@pytest.mark.asyncio
async def test_call_tool_allowed():
    async def mock_send(msg: str): pass

    client = McpClient(mock_send, allowlist={"take_photo"})

    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(json.dumps({
            "jsonrpc": "2.0", "id": 1,
            "result": {"content": [{"type": "text", "text": "photo data"}], "isError": False}
        }))

    asyncio.create_task(respond())
    result = await client.call_tool("take_photo", {})

    assert result["isError"] is False
    assert result["content"][0]["text"] == "photo data"

@pytest.mark.asyncio
async def test_call_tool_dangerous_blocked():
    async def mock_send(msg: str): pass

    client = McpClient(mock_send, allowlist={"take_photo"})

    result = await client.call_tool("self.reboot", {})

    assert result["isError"] is True
    assert "diblokir" in result["content"][0]["text"]

@pytest.mark.asyncio
async def test_call_tool_not_in_allowlist_blocked():
    async def mock_send(msg: str): pass

    client = McpClient(mock_send, allowlist={"take_photo"})

    result = await client.call_tool("unknown_tool", {})

    assert result["isError"] is True
    assert "allowlist" in result["content"][0]["text"]

@pytest.mark.asyncio
async def test_call_tool_timeout():
    async def mock_send(msg: str): pass  # device tidak pernah balas

    client = McpClient(mock_send, call_timeout=0.1, allowlist={"take_photo"})

    result = await client.call_tool("take_photo", {})

    assert result["isError"] is True
    assert "timeout" in result["content"][0]["text"]

@pytest.mark.asyncio
async def test_handle_error_response():
    async def mock_send(msg: str): pass

    client = McpClient(mock_send, allowlist={"take_photo"})

    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(json.dumps({
            "jsonrpc": "2.0", "id": 1,
            "error": {"message": "device busy"}
        }))

    asyncio.create_task(respond())
    result = await client.call_tool("take_photo", {})

    assert result["isError"] is True
    assert result["content"][0]["text"] == "device busy"

@pytest.mark.asyncio
async def test_id_is_integer():
    sent = []

    async def mock_send(msg: str):
        sent.append(msg)

    client = McpClient(mock_send)

    async def respond():
        await asyncio.sleep(0.01)
        await client.handle_response(json.dumps({
            "jsonrpc": "2.0", "id": 1,
            "result": {"tools": []}
        }))

    asyncio.create_task(respond())
    await client.list_tools()

    msg = json.loads(sent[0])
    assert isinstance(msg["id"], int)
```

### Steps

- [ ] **Step 1:** Tulis `tests/device/test_mcp_client.py` — 8 test: single page, pagination, allowed call, dangerous blocked, not-in-allowlist blocked, timeout, error response, id is integer.
- [ ] **Step 2:** Jalankan test — expected: FAIL.
- [ ] **Step 3:** Tulis `app/device/mcp_client.py`.
- [ ] **Step 4:** Jalankan test — expected: PASS.
- [ ] **Step 5:** Verifikasi `self.reboot` dan `self.upgrade_firmware` ada di `DANGEROUS_TOOLS` dan TIDAK ada di `DEFAULT_ALLOWLIST`.
- [ ] **Step 6:** Jalankan `pytest -v tests/device/test_mcp_client.py` — expected: PASS.
- [ ] **Step 7:** Commit.

```bash
git add app/device/mcp_client.py tests/device/test_mcp_client.py
git commit -m "feat: MCP JSON-RPC client with allowlist and timeout"
```

---

## Task 13: Integrasi MCP ke Pipeline

Sambungkan McpClient ke pipeline voice loop. Saat LLM membalas dengan `tool_calls`, pipeline memanggil tool device via McpClient, lalu kirim hasilnya kembali ke LLM untuk response akhir.

**Interface asli dari Fase 1 (jangan diimprovisasi ulang):** `Pipeline.handle_utterance(self, pcm_audio: bytes) -> AsyncIterator[OutgoingEvent]` (generator yang menghasilkan event `stt`/`tts_start`/`tts_sentence`/`audio_frame`/`tts_stop` — bukan method `process()` yang mengembalikan objek tunggal), dan `LLMAdapter.complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7) -> LLMResponse` (bukan `.chat()`). Task 9 Fase 1 sudah menambahkan parameter `search: SearchAdapter | None` dan logika tool-call untuk web search dengan pola: kalau `llm_result.tool_calls` ada, jalankan tool, suntik hasilnya sebagai pesan `role: "tool"`, panggil `self._llm.complete(messages=messages)` lagi. Task 13 ini mengikuti pola YANG SAMA, cuma menambah `mcp` sebagai sumber tool kedua di samping `search`.

**Files:**
- Modify: `app/device/pipeline.py` — tambah parameter `mcp` dan tool schema MCP ke `Pipeline.__init__`, perluas logika tool-call Task 9 supaya bisa mendispatch ke `search` ATAU `mcp` tergantung nama tool yang diminta LLM
- Modify: `app/device/ws.py` — instantiate McpClient per session, route pesan JSON-RPC respons ke `handle_response`
- Test: `tests/device/test_pipeline_mcp.py`

### Test: `tests/device/test_pipeline_mcp.py`

```python
import json

import pytest

from app.adapters.llm.base import LLMResponse
from app.adapters.stt.base import STTResult
from app.adapters.tts.base import TTSResult
from app.device.pipeline import Pipeline


class _FakeSTT:
    async def transcribe(self, pcm_audio, *, sample_rate=16000):
        return STTResult(text="ambil foto dong", latency_ms=100)


class _FakeTTS:
    async def synthesize(self, text, *, voice):
        return TTSResult(pcm_audio=b"\x00\x01" * 480, sample_rate=24000, latency_ms=50)


class _FakeLLMWithMcpToolCall:
    def __init__(self):
        self._call_count = 0

    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        self._call_count += 1
        if self._call_count == 1:
            return LLMResponse(
                text="",
                tool_calls=[
                    {"id": "call_1", "function": {"name": "take_photo", "arguments": "{}"}}
                ],
                latency_ms=500,
            )
        return LLMResponse(text="Ini foto dari kamera device.", tool_calls=[], latency_ms=600)


class _FakeMcpClient:
    def __init__(self, result: dict):
        self._result = result
        self.call_count = 0

    async def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        self.call_count += 1
        return self._result

    async def get_allowed_tools(self) -> list[dict]:
        return [{"name": "take_photo", "description": "ambil foto", "inputSchema": {"type": "object", "properties": {}}}]


async def test_handle_utterance_dispatches_mcp_tool_call():
    fake_mcp = _FakeMcpClient({"isError": False, "content": [{"type": "text", "text": "photo data"}]})
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMWithMcpToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        mcp=fake_mcp,
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any("foto" in e["text"].lower() for e in sentence_events)
    assert fake_mcp.call_count == 1
    assert events[-1]["kind"] == "tts_stop"


async def test_handle_utterance_mcp_error_still_completes():
    fake_mcp = _FakeMcpClient({"isError": True, "content": [{"type": "text", "text": "timeout"}]})
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMWithMcpToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        mcp=fake_mcp,
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    # LLM tetap dipanggil ronde kedua dengan konteks error tool, dan pipeline tetap selesai
    assert events[-1]["kind"] == "tts_stop"
    assert fake_mcp.call_count == 1


class _FakeLLMNoToolCall:
    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        return LLMResponse(text="Halo, apa kabar?", tool_calls=[], latency_ms=400)


async def test_handle_utterance_without_tool_call_never_touches_mcp():
    fake_mcp = _FakeMcpClient({"isError": False, "content": []})
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMNoToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        mcp=fake_mcp,
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    assert fake_mcp.call_count == 0
    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any(e["text"] == "Halo, apa kabar?" for e in sentence_events)
```

### Steps

- [ ] **Step 1:** Tulis `tests/device/test_pipeline_mcp.py` sesuai kode di atas — 3 test: MCP tool-call dispatched, MCP error tetap selesai, tidak ada tool-call tidak menyentuh MCP.
- [ ] **Step 2:** Jalankan test — expected: FAIL (`Pipeline.__init__` belum menerima parameter `mcp`).
- [ ] **Step 3:** Modify `app/device/pipeline.py`: tambah parameter `mcp: "McpClient | None" = None` ke `Pipeline.__init__` (import `McpClient` cukup untuk type hint — gunakan `from __future__ import annotations` atau string literal untuk menghindari circular import kalau `mcp_client.py` nanti perlu impor sesuatu dari `pipeline.py`). Di dalam `handle_utterance`, PERLUAS blok tool-call yang sudah ada dari Task 9 (bukan ditulis ulang dari nol) — sekarang tool schema gabungan dari `_SEARCH_TOOL_SCHEMA` (kalau `self._search` ada) DAN hasil `await self._mcp.get_allowed_tools()` diterjemahkan ke bentuk OpenAI function-calling (kalau `self._mcp` ada), dan saat memproses `llm_result.tool_calls[0]`, cek nama tool: kalau `call["function"]["name"] == "web_search"` dispatch ke `self._search.search(...)` (kode Task 9 yang sudah ada), SELAIN itu (nama lain) dispatch ke `await self._mcp.call_tool(name, arguments)` — hasil `content[0]["text"]` (atau pesan error kalau `isError: True`) disuntik sebagai pesan `role: "tool"` sama seperti pola search, lalu panggil `self._llm.complete(messages=messages)` lagi untuk jawaban akhir.
- [ ] **Step 4:** Modify `app/device/ws.py` — di dalam `_build_pipeline()` (atau titik setup session di handler WebSocket), instantiate `McpClient(ws_send_fn=websocket.send_text)` per koneksi, kirim `initialize` sekali sebelum turn pertama, dan pastikan pesan masuk bertipe `{"type": "mcp", ...}` di loop pesan WebSocket (blok `if "text" in message` Task 8) di-route ke `await mcp_client.handle_response(message["text"])` alih-alih diabaikan.
- [ ] **Step 5:** Jalankan test — expected: PASS.
- [ ] **Step 6:** Jalankan `pytest -v tests/device/` — expected: PASS semua (Fase 1 + Fase 2), termasuk test Task 9 yang lama (`test_handle_utterance_with_tool_call_invokes_search` dkk) — pastikan perluasan Step 3 tidak meregresi jalur search yang sudah ada.
- [ ] **Step 7:** Commit.

```bash
git add app/device/pipeline.py app/device/ws.py tests/device/test_pipeline_mcp.py
git commit -m "feat: integrate MCP tool-calling into voice loop pipeline"
```

---

## Task 14: REST API — Auth

Auth dasar: login endpoint yang mengembalikan JWT, dependency FastAPI yang verify token dan inject `current_owner`.

**Files:**
- Create: `app/control/__init__.py`
- Create: `app/control/auth.py`
- Test: `tests/control/test_auth.py`

### `app/control/auth.py`

Model `User` dan `Owner` dipisah sejak Fase 1 Task 1 (`User.email`/`password_hash` = identitas login, `Owner.user_id` FK = tenant) — router ini query lewat ORM `select()`, bukan raw SQL, supaya konsisten dengan gaya Task 1 dan tidak butuh impor `text()` terpisah.

```python
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import verify_password, create_access_token, decode_access_token
from app.core.models import User, Owner

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer()

class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    owner_id: str

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email atau password salah")

    owner_result = await db.execute(select(Owner).where(Owner.user_id == user.id))
    owner = owner_result.scalar_one_or_none()
    if owner is None:
        raise HTTPException(status_code=403, detail="User belum punya owner record")

    token = create_access_token(str(user.id))
    return LoginResponse(access_token=token, owner_id=str(owner.id))

async def get_current_owner(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_session),
) -> str:
    """Dependency: returns owner_id string. Gunakan di setiap endpoint REST."""
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Token tidak valid")

    result = await db.execute(select(Owner).where(Owner.user_id == user_id))
    owner = result.scalar_one_or_none()
    if owner is None:
        raise HTTPException(status_code=403, detail="Owner tidak ditemukan")

    return str(owner.id)
```

Catatan: `app.core.db` Fase 1 hanya menyediakan `get_engine()`/`get_sessionmaker()`, belum ada `get_session()` sebagai FastAPI dependency generator. Tambahkan ke `app/core/db.py` sebagai bagian dari Task 11 (sebelum Task 14 dipakai):

```python
async def get_session():
    async with get_sessionmaker()() as session:
        yield session
```

### Test: `tests/control/test_auth.py`

```python
import pytest
from fastapi.testclient import TestClient
from app.main import app

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
    r = client.get("/api/agents")
    assert r.status_code == 403  # HTTPBearer returns 403 without credentials

def test_protected_endpoint_with_token(client, seeded_owner):
    login = client.post("/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"})
    token = login.json()["access_token"]
    r = client.get("/api/agents", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
```

### Steps

- [ ] **Step 1:** Tulis `tests/control/test_auth.py` — 5 test: login success, wrong password, unknown email, protected without token, protected with token.
- [ ] **Step 2:** Tulis `app/control/__init__.py` (kosong) dan `app/control/auth.py`.
- [ ] **Step 3:** Tambah `conftest.py` fixture: `client` (TestClient), `seeded_owner` (seed satu user+owner ke test DB).
- [ ] **Step 4:** Mount `auth.router` di `app/main.py`.
- [ ] **Step 5:** Jalankan test — expected: PASS.
- [ ] **Step 6:** Commit.

```bash
git add app/control/ tests/control/ tests/conftest.py app/main.py
git commit -m "feat: REST API auth with JWT login and owner scoping"
```

---

## Task 15: REST API — Agents, Providers, Devices, Conversations, Overview

Lima kelompok endpoint REST untuk dashboard. Semua pakai `Depends(get_current_owner)` untuk tenant scoping.

**Files:**
- Create: `app/control/schemas.py` — Pydantic response models
- Create: `app/control/rest/__init__.py`
- Create: `app/control/rest/agents.py`
- Create: `app/control/rest/providers.py`
- Create: `app/control/rest/devices.py`
- Create: `app/control/rest/conversations.py`
- Create: `app/control/rest/overview.py`
- Test: `tests/control/test_rest_agents.py`
- Test: `tests/control/test_rest_providers.py`
- Test: `tests/control/test_rest_devices.py`
- Test: `tests/control/test_rest_conversations.py`
- Test: `tests/control/test_rest_overview.py`

### `app/control/schemas.py`

```python
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import uuid

class AgentOut(BaseModel):
    id: str
    name: str
    system_prompt: str
    llm_model: str
    temperature: float
    max_tokens: int
    tts_provider: str
    tts_voice: str
    emotion_level: str
    tools_enabled: list[str]
    memory_enabled: bool
    chat_log_level: int
    created_at: datetime
    updated_at: datetime

class AgentCreate(BaseModel):
    name: str
    system_prompt: str = ""
    llm_model: str = "gpt-4o-mini"
    temperature: float = 0.7
    max_tokens: int = 256
    tts_provider: str = "piper"
    tts_voice: str = "id_ID"
    emotion_level: str = "medium"
    tools_enabled: list[str] = []
    memory_enabled: bool = False
    chat_log_level: int = 1

class ProviderCredOut(BaseModel):
    id: str
    kind: str
    provider_code: str
    config: dict
    secret_last4: str
    fallback_of: Optional[str] = None
    created_at: datetime

class ProviderCredCreate(BaseModel):
    kind: str  # llm|stt|tts|search|vision
    provider_code: str
    config: dict = {}
    secret: str  # API key — dienkripsi sebelum masuk DB
    fallback_of: Optional[str] = None

class DeviceOut(BaseModel):
    id: str
    device_id: str  # MAC
    client_id: str
    alias: Optional[str] = None
    agent_id: Optional[str] = None
    board: Optional[str] = None
    firmware_version: Optional[str] = None
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    online: bool = False

class ConversationOut(BaseModel):
    id: str
    device_id: str
    agent_id: str
    session_id: str
    title: Optional[str] = None
    started_at: datetime
    turn_count: int = 0

class MessageOut(BaseModel):
    id: str
    role: str
    text: str
    provider_used: Optional[dict] = None
    latency_ms: Optional[dict] = None
    audio_path: Optional[str] = None
    created_at: datetime

class OverviewStats(BaseModel):
    devices_online: int
    devices_total: int
    turns_today: int
    p50_latency_ms: int
    active_conversations: int
    providers: list[dict]  # [{kind, provider_code, p50_ms}]
    needs_attention: list[dict]  # [{type, message, device_id?}]
```

### `app/control/rest/agents.py` — endpoint CRUD agent

```
GET    /api/agents                  — list semua agent milik owner
POST   /api/agents                  — buat agent baru
GET    /api/agents/{id}             — detail agent
PUT    /api/agents/{id}             — update agent
DELETE /api/agents/{id}             — hapus agent
POST   /api/agents/{id}/snapshot    — simpan snapshot config (agent_snapshots)
```

### `app/control/rest/providers.py` — endpoint CRUD provider_creds + tes koneksi

```
GET    /api/providers               — list semua provider_creds milik owner
POST   /api/providers               — tambah provider_cred (secret dienkripsi via crypto.py)
DELETE /api/providers/{id}          — hapus provider_cred
POST   /api/providers/{id}/test     — tes koneksi: panggil adapter, balas hasil asli
                                     — LLM: list models + latency
                                     — STT: kirim 1 detik audio dummy, balas teks
                                     — TTS: sintesis "test", balas durasi + latency
                                     — Search: query "test", balas jumlah hasil + latency
```

### `app/control/rest/devices.py` — endpoint list/claim/update/delete devices

```
GET    /api/devices                 — list semua device milik owner + status online
GET    /api/devices/{id}            — detail device + daftar tool MCP (dari list_all_tools cache)
PUT    /api/devices/{id}            — update alias / pindah agent
DELETE /api/devices/{id}           — lepas device dari akun (token_hash di-clear)
POST   /api/devices/{id}/reboot    — kirim self.reboot (tidak lewat LLM — aksi manual dashboard)
POST   /api/devices/{id}/firmware   — kirim self.upgrade_firmware (manual, konfirmasi di UI)
```

Catatan: `reboot` dan `firmware` adalah aksi MANUAL dari dashboard, BUKAN lewat LLM. Endpoint ini langsung kirim JSON-RPC ke device, tidak lewat McpClient.allowlist (karena itu untuk filter LLM). Tapi tetap pakai timeout.

### `app/control/rest/conversations.py` — endpoint list/search/transcript

```
GET    /api/conversations           — list, filter by device_id + date range, search text
GET    /api/conversations/{id}      — detail + messages (transcript)
DELETE /api/conversations/{id}      — hapus percakapan + file audio
GET    /api/conversations/{id}/audio/{message_id} — stream file audio (izin terpisah)
```

### `app/control/rest/overview.py` — aggregasi dashboard

```
GET    /api/overview                — OverviewStats: device count, turns today, p50 latency, active convs, providers + latency, needs_attention
```

### Test: `tests/control/test_rest_agents.py`

```python
import pytest

def test_list_agents_empty(client, auth_headers):
    r = client.get("/api/agents", headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []

def test_create_agent(client, auth_headers):
    r = client.post("/api/agents", headers=auth_headers, json={
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
        "chat_log_level": 1
    })
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
    r = client.put(f"/api/agents/{agent_id}", headers=auth_headers, json={"name": "New", "temperature": 0.5})
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

def test_cannot_access_other_owner_agent(client, auth_headers):
    # Bikin agent sebagai owner A, coba akses sebagai owner B
    # (test ini butuh fixture kedua owner — skip kalau belum ada)
    pass
```

### Test pattern untuk providers, devices, conversations, overview mirip — test CRUD dasar + tenant isolation.

### Steps

- [ ] **Step 1:** Tulis `app/control/schemas.py` dengan semua Pydantic models.
- [ ] **Step 2:** Tulis `tests/control/test_rest_agents.py` — 5 test: list empty, create, get, update, delete.
- [ ] **Step 3:** Tulis `app/control/rest/agents.py` — implementasi CRUD dengan `Depends(get_current_owner)`.
- [ ] **Step 4:** Jalankan test — expected: PASS.
- [ ] **Step 5:** Tulis `tests/control/test_rest_providers.py` — test create (secret terenkripsi), list (only secret_last4), delete, test connection (mock adapter).
- [ ] **Step 6:** Tulis `app/control/rest/providers.py`. Pastikan secret dienkripsi via `crypto.encrypt_secret()` sebelum masuk DB. Response hanya `secret_last4`.
- [ ] **Step 7:** Jalankan test — expected: PASS.
- [ ] **Step 8:** Tulis `tests/control/test_rest_devices.py` — test list, detail (with MCP tools), update alias, delete (release).
- [ ] **Step 9:** Tulis `app/control/rest/devices.py`. Untuk MCP tools di detail device, pakai cache `list_all_tools()` per session.
- [ ] **Step 10:** Jalankan test — expected: PASS.
- [ ] **Step 11:** Tulis `tests/control/test_rest_conversations.py` — test list with filters, detail with messages, delete, audio stream (403 tanpa permission).
- [ ] **Step 12:** Tulis `app/control/rest/conversations.py`. Audio stream butuh permission check terpisah (spec §8 — izin putar audio != izin baca transkrip). Di Fase 2 dengan satu owner, owner bisa keduanya. Pisahkan endpoint-nya sejak awal.
- [ ] **Step 13:** Jalankan test — expected: PASS.
- [ ] **Step 14:** Tulis `tests/control/test_rest_overview.py` — test overview stats agregasi.
- [ ] **Step 15:** Tulis `app/control/rest/overview.py`. Query: `COUNT devices WHERE owner_id`, `COUNT messages WHERE created_at > today`, `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms->>'total')` untuk p50.
- [ ] **Step 16:** Jalankan test — expected: PASS.
- [ ] **Step 17:** Mount semua router di `app/main.py`.
- [ ] **Step 18:** Jalankan `pytest -v tests/control/` — expected: PASS semua.
- [ ] **Step 19:** Commit.

```bash
git add app/control/ tests/control/ app/main.py
git commit -m "feat: REST API for agents, providers, devices, conversations, overview"
```

---

## Task 16: Live Monitor WebSocket

WebSocket browser yang stream event voice loop real-time. Subscribe ke event bus, forward ke browser sebagai JSON.

**Files:**
- Create: `app/control/monitor.py`
- Test: `tests/control/test_monitor.py`

### `app/control/monitor.py`

```python
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from app.core.bus import subscribe, unsubscribe
from app.core.auth import get_current_owner_ws  # versi WebSocket dari auth

router = APIRouter()

@router.websocket("/ws/monitor")
async def monitor_ws(ws: WebSocket):
    # Auth via query param token (WebSocket tidak support header Authorization di browser)
    token = ws.query_params.get("token")
    owner_id = await get_current_owner_ws(token)
    if owner_id is None:
        await ws.close(code=4001)
        return

    await ws.accept()

    # Subscribe ke semua event topic, forward ke browser
    topics = [
        "device.connected", "device.disconnected",
        "device.listening", "device.speaking",
        "turn.started", "turn.stage", "turn.completed", "turn.aborted",
        "device.mcp_call",
    ]

    queue: asyncio.Queue = asyncio.Queue()

    async def handler(payload):
        # Filter by owner — hanya event milik owner ini
        if payload.get("owner_id") != owner_id:
            return
        await queue.put(payload)

    for topic in topics:
        await subscribe(topic, handler)

    try:
        while True:
            payload = await queue.get()
            await ws.send_json({"topic": topic, "payload": payload})
    except WebSocketDisconnect:
        pass
    finally:
        for topic in topics:
            await unsubscribe(topic, handler)
```

### Test: `tests/control/test_monitor.py`

```python
import pytest
import asyncio
import json
from fastapi.testclient import TestClient
from app.main import app
from app.core.bus import publish, clear

def test_monitor_connect_without_token():
    client = TestClient(app)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/monitor"):
            pass

def test_monitor_connect_with_valid_token(client, seeded_owner):
    login = client.post("/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"})
    token = login.json()["access_token"]

    with client.websocket_connect(f"/ws/monitor?token={token}") as ws:
        # Publish event, terima di browser
        asyncio.run(publish("turn.stage", {"owner_id": seeded_owner, "stage": "stt", "latency_ms": 500}))

        msg = ws.receive_json(timeout=2)
        assert msg["topic"] == "turn.stage"
        assert msg["payload"]["stage"] == "stt"

def test_monitor_filters_by_owner(client, seeded_owner, second_owner):
    """Event milik owner B tidak diterima owner A."""
    login = client.post("/api/auth/login", json={"email": "owner@zora.local", "password": "testpass123"})
    token = login.json()["access_token"]

    with client.websocket_connect(f"/ws/monitor?token={token}") as ws:
        asyncio.run(publish("turn.stage", {"owner_id": second_owner, "stage": "stt"}))

        # Should not receive — timeout
        with pytest.raises(Exception):
            ws.receive_json(timeout=1)
```

### Steps

- [ ] **Step 1:** Tulis `tests/control/test_monitor.py` — 3 test: connect without token rejected, connect with token receives events, filter by owner.
- [ ] **Step 2:** Tulis `app/control/monitor.py`. Tambah `get_current_owner_ws(token)` di `auth.py` versi WebSocket (decode token dari query param).
- [ ] **Step 3:** Modify `app/device/ws.py`, `pipeline.py`, `session.py` — tambah `await bus.publish()` di setiap stage: connected, disconnected, listening, speaking, turn.started, turn.stage, turn.completed, turn.aborted. Payload wajib bawa `owner_id`.
- [ ] **Step 4:** Mount `monitor.router` di `app/main.py`.
- [ ] **Step 5:** Jalankan test — expected: PASS.
- [ ] **Step 6:** Jalankan `pytest -v tests/` — expected: PASS semua (Fase 1 + Fase 2).
- [ ] **Step 7:** Commit.

```bash
git add app/control/monitor.py app/control/auth.py app/device/ tests/control/test_monitor.py app/main.py
git commit -m "feat: live monitor WebSocket with event bus streaming"
```

---

## Task 17: Frontend Scaffold + Layout

Setup React+Vite+Tailwind, layout dengan sidebar 7 item menu, TanStack Query, auth token management.

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/hooks.ts`

### `frontend/package.json`

```json
{
  "name": "zora-bridge-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.51.0",
    "@tanstack/react-table": "^8.20.0",
    "lucide-react": "^0.428.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "vitest": "^2.0.0"
  }
}
```

### `frontend/src/api/client.ts`

```typescript
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export function getToken(): string | null {
  return localStorage.getItem("zora_token");
}

export function setToken(token: string): void {
  localStorage.setItem("zora_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("zora_token");
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
  }
  return res;
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}
```

### `frontend/src/App.tsx`

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import Overview from "./pages/Overview";
import Agents from "./pages/Agents";
import Providers from "./pages/Providers";
import Devices from "./pages/Devices";
import LiveMonitor from "./pages/LiveMonitor";
import Conversations from "./pages/Conversations";
import UsersRoles from "./pages/UsersRoles";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="agents" element={<Agents />} />
            <Route path="providers" element={<Providers />} />
            <Route path="devices" element={<Devices />} />
            <Route path="monitor" element={<LiveMonitor />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="users" element={<UsersRoles />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

### `frontend/src/components/Layout.tsx`

Sidebar 7 item: Overview, Agents, Providers & Keys, Devices & Pairing, Live Monitor, Percakapan, Users & Roles. Topbar dengan logo + user info. Kalau tidak ada token, redirect ke /login (atau inline login form sederhana).

### Steps

- [ ] **Step 1:** Scaffold frontend dengan command resmi:
  ```bash
  cd /Users/apittmy/me-n-me/AIoT/zora-bridge
  npm create vite@latest frontend -- --template react-ts
  cd frontend
  npm install
  npm install react-router-dom @tanstack/react-query @tanstack/react-table lucide-react
  npm install -D tailwindcss postcss autoprefixer
  npx tailwindcss init -p
  ```
  Ini generate: package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx, src/App.tsx — semua oleh Vite resmi, bukan ditulis manual.
- [ ] **Step 2:** Patch `tailwind.config.js` (generated by `npx tailwindcss init -p`) — tambah `content: ["./index.html","./src/**/*.{ts,tsx}"]`.
- [ ] **Step 3:** Patch `src/index.css` — tambah `@tailwind base; @tailwind components; @tailwind utilities;` (Tailwind directive).
- [ ] **Step 4:** Patch `vite.config.ts` — tambah proxy ke `localhost:8000` untuk `/api` dan `/ws`.
- [ ] **Step 5:** Buat `src/components/Layout.tsx` — sidebar + topbar. 7 menu item dengan icon (lucide-react). Area konten dengan `<Outlet />`.
- [ ] **Step 6:** Buat `src/api/client.ts` — fetch wrapper + token management + 401 redirect.
- [ ] **Step 7:** Buat `src/api/hooks.ts` — TanStack Query hooks: `useAgents()`, `useProviders()`, `useDevices()`, `useOverview()`, `useConversations()`.
- [ ] **Step 8:** Buat 7 page stubs: `Overview.tsx`, `Agents.tsx`, `Providers.tsx`, `Devices.tsx`, `LiveMonitor.tsx`, `Conversations.tsx`, `UsersRoles.tsx` — masing-masing tampilkan judul + "coming soon" dulu.
- [ ] **Step 9:** Patch `src/App.tsx` — ganti default Vite App dengan router + Layout + 7 routes.
- [ ] **Step 10:** Jalankan `npm run dev` — expected: Vite dev server jalan di localhost:5173, sidebar tampil, routing jalan.
- [ ] **Step 11:** Tambah inline login form di Layout kalau tidak ada token (POST /api/auth/login, simpan token, reload).
- [ ] **Step 12:** Verifikasi: login → token tersimpan → GET /api/overview jalan dari frontend.
- [ ] **Step 13:** Commit.

```bash
git add frontend/
git commit -m "feat: React dashboard scaffold with layout, routing, and auth"
```

---

## Task 18: Page Overview

Layar pertama dashboard. Tampilkan: status device real-time, 4 angka ringkas (device online/total, turn hari ini, p50 latensi, percakapan aktif), strip provider aktif + latensi p50 per tahap, daftar "perlu perhatian".

**Files:**
- Create: `frontend/src/pages/Overview.tsx`
- Create: `frontend/src/components/StatCard.tsx`
- Create: `frontend/src/components/ProviderBadge.tsx`
- Create: `frontend/src/components/LatencyBar.tsx`

### Layout Overview

```
+-------------------------------------------------------+
| Overview                                              |
+---+---+---+---+
| 4 | 3 | 1.8s | 2 |     (4 StatCards: online/total, turns, p50, active convs)
+---+---+---+---+
| Providers                                              |
| [LLM: omnirouter · 800ms] [STT: groq · 500ms] [TTS: piper · 250ms] [Search: searxng · 900ms]
+-------------------------------------------------------+
| Perlu Perhatian                                        |
| ⚠ Device A4:CF:12:9B offline >24 jam                  |
| ⚠ Provider STT key kedaluwarsa — perbarui             |
| ⚠ 3 percakapan tanpa respons LLM (error rate tinggi)  |
+-------------------------------------------------------+
```

### Steps

- [ ] **Step 1:** Buat `StatCard.tsx` — kartu angka besar + label + icon + warna (hijau kuning merah).
- [ ] **Step 2:** Buat `ProviderBadge.tsx` — lencana provider: kind (LLM/STT/TTS/Search), provider_code, latensi p50, badge GRATIS vs TOKEN SENDIRI.
- [ ] **Step 3:** Buat `LatencyBar.tsx` — batang proporsional untuk anggaran latensi per tahap (VAD 500-700ms, STT 400-600ms, Search 800-1000ms, LLM 600-900ms, TTS 200-300ms). Warna: hijau kalau di budget, merah kalau over.
- [ ] **Step 4:** Buat `Overview.tsx` — panggil `useOverview()` hook, render 4 StatCards + strip ProviderBadges + daftar needs_attention.
- [ ] **Step 5:** Auto-refresh setiap 10 detik via TanStack Query `refetchInterval: 10000`.
- [ ] **Step 6:** Verifikasi: jalan di browser, data tampil, auto-refresh jalan.
- [ ] **Step 7:** Commit.

```bash
git add frontend/src/pages/Overview.tsx frontend/src/components/StatCard.tsx frontend/src/components/ProviderBadge.tsx frontend/src/components/LatencyBar.tsx
git commit -m "feat: dashboard overview page with stats, providers, and alerts"
```

---

## Task 19: Page Agents

Editor agent bersekat: identitas & persona, suara, model, tools, memori jangka panjang.

**Files:**
- Create: `frontend/src/pages/Agents.tsx`

### Layout Agents

List agent di kiri (klik untuk pilih), editor di kanan. Editor punya 5 sekat:

1. **Identitas & Persona** — nama, wake word (read-only — terhalang, spec §10), system prompt (textarea dengan pencacah karakter, catatan "TTS baca teks ini — jangan markdown"), tombol simpan.
2. **Suara** — pemilih voice (dropdown dari provider TTS voices), tombol preview (sintesis "Halo, saya Zora"), tingkat ekspresi wajah (datar/sedang/ekspresif — radio button).
3. **Model** — LLM per agent (dropdown dari tes koneksi provider), temperature (slider 0-1), max_tokens (number, penjelasan "demi latensi — jangan naikkan tanpa pertimbangan").
4. **Tools** — 3 sakelar toggle: websearch, kontrol device MCP, kamera. Masing-masing tampilkan jumlah pemakaian hari ini atau alasan "belum bisa" (device offline / tidak ada tool). PERINGATAN KOTAK MERAH: "Tool self.reboot dan self.upgrade_firmware tidak diekspos ke LLM — hanya aksi manual dari dashboard."
5. **Memori Jangka Panjang** — sakelar on/off, jumlah fakta tersimpan, daftar fakta (dari tabel memories kind=fact), hapus per fakta.

### Steps

- [ ] **Step 1:** Buat `Agents.tsx` — list + editor dengan 5 sekastt.
- [ ] **Step 2:** Form state management via TanStack Query mutation (POST/PUT /api/agents).
- [ ] **Step 3:** System prompt textarea dengan `onChange` update pencacah karakter.
- [ ] **Step 4:** Tombol preview TTS — POST ke /api/providers/{id}/test dengan teks sample, balik audio, putar via `<audio>`.
- [ ] **Step 5:** Peringatan tool berbahaya — kotak merah dengan ikon warning, teks jelas.
- [ ] **Step 6:** Daftar memori — GET /api/agents/{id}/memories (endpoint baru di rest/agents.py), DELETE per fakta.
- [ ] **Step 7:** Verifikasi: CRUD agent jalan, simpan update, preview TTS, hapus memori.
- [ ] **Step 8:** Commit.

```bash
git add frontend/src/pages/Agents.tsx
git commit -m "feat: agents editor page with persona, voice, model, tools, and memory sections"
```

---

## Task 20: Page Providers & Keys

4 kartu provider (LLM, STT, TTS, Search), pemilih provider per tahap, konfigurasi, key only-last4, tes koneksi.

**Files:**
- Create: `frontend/src/pages/Providers.tsx`

### Layout Providers

Grid 4 kartu (atau 2x2). Tiap kartu:

1. **Header** — label (LLM/STT/TTS/Search) + lencana GRATIS (Piper, SearXNG self-host) vs TOKEN SENDIRI (omnirouter, Groq).
2. **Pemilih provider** — dropdown (LLM: omnirouter, local; STT: groq_whisper, faster_whisper; TTS: piper; Search: searxng).
3. **Konfigurasi** — field dari schema config (LLM: base_url, model; STT: model, language; TTS: voice, model_path; Search: base_url). Render dinamis dari JSON schema.
4. **Key** — input password, hanya tampilkan `secret_last4` kalau sudah ada. Tombol "Ganti Key" buka input. Setelah simpan, field kosong lagi — tidak pernah dikirim balik.
5. **Tes Koneksi** — tombol. Panggil POST /api/providers/{id}/test. Tampilkan hasil asli: "14 model terbaca · 180 ms" atau "Timeout — cek URL/key".
6. **Fallback** — dropdown pilih fallback provider (kalau utama gagal). Tampilkan rantai: omnirouter → local.

### Steps

- [ ] **Step 1:** Buat `Providers.tsx` — grid 4 kartu.
- [ ] **Step 2:** Tiap kartu render config fields dinamis dari `config` dict.
- [ ] **Step 3:** Key field — type password, tampilkan `••••${secret_last4}` kalau sudah ada. Tombol ganti.
- [ ] **Step 4:** Tombol tes koneksi — POST /api/providers/{id}/test, tampilkan hasil + latensi.
- [ ] **Step 5:** Fallback selector — dropdown provider lain di kind yang sama.
- [ ] **Step 6:** Kartu penutup di bawah grid: "Key Anda dienkripsi dengan AES-256 (Fernet) sebelum masuk DB. Kunci dekripsi disimpan di server, tidak di database. Setelah disimpan, key tidak pernah dikirim balik ke browser."
- [ ] **Step 7:** Verifikasi: CRUD provider jalan, tes koneksi tampilkan hasil asli, key only-last4.
- [ ] **Step 8:** Commit.

```bash
git add frontend/src/pages/Providers.tsx
git commit -m "feat: providers and keys page with BYOK, test connection, and fallback"
```

---

## Task 21: Page Devices & Pairing

Panel klaim device, tabel device, panel detail, tindakan manual.

**Files:**
- Create: `frontend/src/pages/Devices.tsx`

### Layout Devices

3 area:

1. **Panel Klaim Device** (atas) — 6 kotak input kode (auto-advance, paste support). Penjelasan alur: "Masukkan kode yang muncul di layar device. Device akan terhubung otomatis ke akun Anda." Tombol Klaim. Error: "Kode tidak valid atau kedaluwarsa."

2. **Tabel Device** — kolom: alias, MAC (device_id), agent, versi firmware, status (online/offline badge warna). Klik baris → buka panel detail.

3. **Panel Detail** (slide-over atau expand) — info: waktu klaim, Client-Id, ekor token (4 char), uptime sesi, daftar tool MCP (dari `list_all_tools()` cache), tool berbahaya ditandai khusus (ikon merah, label "BERBAHAYA — tidak diekspos ke LLM"). Tindakan manual: pindah agent (dropdown), kirim firmware (input URL + tombol — warna bahaya), reboot (tombol — warna bahaya), lepas dari akun (tombol — warna bahaya + konfirmasi + penjelasan konsekuensi).

### Steps

- [ ] **Step 1:** Buat `Devices.tsx` — 3 area.
- [ ] **Step 2:** 6 kotak input kode — controlled component, auto-advance ke kotak berikutnya saat diisi, paste 6 char langsung isi semua.
- [ ] **Step 3:** Tabel device — pakai `@tanstack/react-table`. Status badge: hijau online, abu-abu offline.
- [ ] **Step 4:** Panel detail — slide-over dari kanan. Tool MCP list dari GET /api/devices/{id} (field `mcp_tools`). Tool berbahaya: `self.reboot`, `self.upgrade_firmware` ditandai merah.
- [ ] **Step 5:** Tindakan manual — POST /api/devices/{id}/reboot, /firmware, DELETE /api/devices/{id}. Tombol merah + modal konfirmasi dengan penjelasan.
- [ ] **Step 6:** Verifikasi: klaim jalan, tabel tampil, detail slide-over, tool berbahaya ditandai, tindakan manual konfirmasi.
- [ ] **Step 7:** Commit.

```bash
git add frontend/src/pages/Devices.tsx
git commit -m "feat: devices and pairing page with claim, table, detail, and manual actions"
```

---

## Task 22: Page Live Monitor

Kartu turn berjalan + waterfall waktu per tahap + status sesi + log protokol.

**Files:**
- Create: `frontend/src/pages/LiveMonitor.tsx`

### Layout Live Monitor

Connect ke `/ws/monitor?token=...`. 4 panel:

1. **Kartu Turn Berjalan** (atas, lebar penuh) — transkrip tumbuh real-time. User text muncul saat STT selesai, assistant text muncuk token-by-token (kalau LLM streaming) atau sekaligus. Scroll otomatis ke bawah.

2. **Waterfall Waktu** — batang proporsional per tahap: rekam (merah), endpoint VAD (oranye), STT (biru), search (ungu, kalau ada), LLM (hijau), TTS awal (cyan). Angka ms di tiap batang + total mulut-ke-telinga di akhir. Pakai `LatencyBar.tsx` dari Task 18.

3. **Status Sesi** — mesin state: Idle → Listening → Speaking (badge dengan animasi). Mode listen (auto/manual). Status AEC (on/off). Session ID. Kedalaman antrean audio device (x/20 frame — dari payload `turn.stage` atau event device). Sisa idle timeout ( countdown).

4. **Log Pesan Protokol** — tabel scrollable: timestamp, arah (→ masuk / ← keluar), tipe pesan (hello, listen start, tts start, frame biner, dst). Frame biner diringkas: "FRAME x60ms (48 bytes)" — tidak tampilkan isi biner.

### Steps

- [ ] **Step 1:** Buat `LiveMonitor.tsx` — connect WebSocket di `useEffect`, parse event, dispatch ke state.
- [ ] **Step 2:** Kartu turn — transkrip tumbuh. `turn.started` → mulai container. `turn.stage` dengan stage=stt → tampilkan user text. `turn.stage` dengan stage=llm → tampilkan assistant text (streaming kalau ada). `turn.completed` → finalize + simpan ke history.
- [ ] **Step 3:** Waterfall — setiap `turn.stage` event, tambah batang. `turn.completed` → total di bawah. Reset di turn baru.
- [ ] **Step 4:** Status sesi — update badge state dari `device.listening` dan `device.speaking` event. Antrean audio dari payload. Countdown idle timeout.
- [ ] **Step 5:** Log protokol — append setiap event. Frame biner diringkas jumlahnya, bukan isi.
- [ ] **Step 6:** Auto-reconnect WebSocket kalau putus (backoff 1s, 2s, 5s, 10s).
- [ ] **Step 7:** Verifikasi: start voice loop di device → event muncul real-time di browser → waterfall tampil → log terisi.
- [ ] **Step 8:** Commit.

```bash
git add frontend/src/pages/LiveMonitor.tsx
git commit -m "feat: live monitor page with turn card, waterfall, session status, and protocol log"
```

---

## Task 23: Page Conversations

Pencarian teks penuh, daftar percakapan, transkrip per turn, kontrol tingkat pencatatan, ekspor/hapus.

**Files:**
- Create: `frontend/src/pages/Conversations.tsx`

### Layout Conversations

2 area:

1. **Search + List** (kiri) — search bar (full-text search via Postgres `ILIKE` atau `tsvector`), filter device (dropdown), filter rentang tanggal (date range picker). Daftar percakapan: judul otomatis + device + agent + jumlah turn + tanggal. Klik → buka transkrip.

2. **Transkrip** (kanan) — per turn: teks, tombol putar audio + durasi (GET /api/conversations/{id}/audio/{message_id}), kutipan hasil websearch (kalau ada — dari `provider_used`), penanda memori disimpan (ikon brain), baris provider + latensi tiap tahap + total (LatencyBar mini).

Di bawah transkrip: kontrol tingkat pencatatan per agent (3 pilihan: tidak dicatat / teks saja / teks + audio — dengan konsekuensi + penjelasan retensi 30 hari). Tombol ekspor (download JSON) + hapus per percakapan.

### Steps

- [ ] **Step 1:** Buat `Conversations.tsx` — 2 area.
- [ ] **Step 2:** Search bar — GET /api/conversations?q=...&device_id=...&from=...&to=... Postgres ILIKE.
- [ ] **Step 3:** Daftar percakapan — klik buka transkrip di kanan.
- [ ] **Step 4:** Transkrip — per message, tampilkan teks + tombol audio + metadata. LatencyBar mini per turn.
- [ ] **Step 5:** Kontrol tingkat pencatatan — PUT /api/agents/{id} dengan `chat_log_level` 0/1/2. 3 pilihan dengan penjelasan.
- [ ] **Step 6:** Ekspor — GET /api/conversations/{id}?format=json → download. Hapus — DELETE dengan konfirmasi.
- [ ] **Step 7:** Verifikasi: search jalan, transkrip tampil, audio putar, ekspor/hapus jalan.
- [ ] **Step 8:** Commit.

```bash
git add frontend/src/pages/Conversations.tsx
git commit -m "feat: conversations page with search, transcript, audio playback, and log level control"
```

---

## Task 24: Page Users & Roles (Stub)

Layar 7 — lencana "Fase 3 — dirancang, belum aktif". Catatan satu pemilik tunggal. Matriks izin 3 peran preview.

**Files:**
- Create: `frontend/src/pages/UsersRoles.tsx`

### Layout UsersRoles

- Header: "Users & Roles" + lencana badge "Fase 3 — dirancang, belum aktif" (kuning).
- Catatan: "Saat ini sistem berjalan dengan satu pemilik tunggal. Manajemen multi-user akan diaktifkan di Fase 3."
- Matriks izin preview (read-only, greyed out):

| Kemampuan | Owner | Operator | Viewer |
|---|---|---|---|
| Kelola agent | Ya | Ya | Tidak |
| Kelola provider & key | Ya | Tidak | Tidak |
| Klaim & kelola device | Ya | Ya | Tidak |
| Lihat live monitor | Ya | Ya | Ya |
| Baca transkrip | Ya | Ya | Ya |
| Putar rekaman audio | Ya | Tidak | Tidak |
| Kelola user & peran | Ya | Tidak | Tidak |
| Ekspor & hapus percakapan | Ya | Ya | Tidak |

- Catatan di bawah: "Izin 'baca transkrip' dipisah dari 'putar rekaman audio' — Operator mendapat baca transkrip tanpa putar audio."

### Steps

- [ ] **Step 1:** Buat `UsersRoles.tsx` — lencana + catatan + matriks preview (static HTML table).
- [ ] **Step 2:** Verifikasi: halaman tampil, matriks readable, lencana jelas.
- [ ] **Step 3:** Commit.

```bash
git add frontend/src/pages/UsersRoles.tsx
git commit -m "feat: users and roles page stub with Fase 3 preview"
```

---

## Task 25: Integrasi End-to-End + Build

Sambungkan semua, pastikan frontend bisa di-build dan diserve oleh FastAPI, jalankan full test suite.

**Files:**
- Modify: `app/main.py` — mount static frontend build
- Modify: `app/config.py` — CORS settings
- Modify: `frontend/vite.config.ts` — build output ke `../static`

### Steps

- [ ] **Step 1:** Build frontend — `cd frontend && npm run build`. Output ke `frontend/dist/`.
- [ ] **Step 2:** Mount static files di `app/main.py`:
  ```python
  from fastapi.staticfiles import StaticFiles
  app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")
  ```
  Catatan: mount di akhir setelah semua API route, supaya `/api/*` dan `/ws/*` tidak tertimpa.
- [ ] **Step 3:** Konfigurasi CORS di `app/main.py` untuk development (frontend di 5173, backend di 8000).
- [ ] **Step 4:** Tambah `README.md` — catatan: "Jalankan satu worker saja (`uvicorn app.main:app --workers 1`). Event bus pub/sub in-process tidak support multi-worker. Saat butuh multi-worker, ganti implementasi bus.py ke Valkey."
- [ ] **Step 5:** Jalankan backend: `docker-compose up -d` (Postgres) + `uvicorn app.main:app --reload`.
- [ ] **Step 6:** Buka browser → login → verifikasi semua 7 halaman jalan.
- [ ] **Step 7:** Jalankan full test suite: `pytest -v` — expected: PASS semua (Fase 1 + Fase 2).
- [ ] **Step 8:** Smoke test manual: klaim device → start voice loop → lihat live monitor → LLM minta tool → tool dipanggil → jawaban kembali.
- [ ] **Step 9:** Commit.

```bash
git add app/main.py app/config.py frontend/vite.config.ts README.md
git commit -m "feat: integrate frontend build, CORS, single-worker note, end-to-end"
```

---

## Self-Review Checklist

Setelah semua task selesai, verifikasi:

- [ ] **1. Allowlist MCP:** `self.reboot` dan `self.upgrade_firmware` ada di `DANGEROUS_TOOLS` dan TIDAK ada di `DEFAULT_ALLOWLIST`. Test `test_call_tool_dangerous_blocked` lulus.
- [ ] **2. Timeout MCP:** Test `test_call_tool_timeout` lulus — device tidak merespons → bridge timeout → error message ke LLM.
- [ ] **3. Tenant isolation:** Semua REST endpoint pakai `Depends(get_current_owner)`. Test tenant isolation lulus (owner A tidak bisa akses data owner B).
- [ ] **4. Key BYOK:** Provider credential `secret` dienkripsi via `crypto.encrypt_secret()` sebelum masuk DB. Response hanya `secret_last4`. Tidak ada endpoint yang mengembalikan secret plaintext.
- [ ] **5. Event bus:** `device/` tidak impor `control/`. Komunikasi lewat `bus.publish()` + DB. Test `test_handler_error_does_not_block_others` lulus.
- [ ] **6. Audio permission:** Endpoint audio stream terpisah dari endpoint transkrip. Di Fase 2 satu owner bisa keduanya, tapi endpoint sudah dipisah sejak awal.
- [ ] **7. id JSON-RPC integer:** Test `test_id_is_integer` lulus.
- [ ] **8. Paginasi MCP berbasis nama:** Test `test_list_tools_pagination` lulus — cursor = nama tool, bukan indeks.
- [ ] **9. Live monitor filter by owner:** Test `test_monitor_filters_by_owner` lulus.
- [ ] **10. Frontend 7 halaman:** Semua halaman accessible dari sidebar. UsersRoles punya lencana "Fase 3".
- [ ] **11. Single worker:** README catat ini. Event bus in-process.
- [ ] **12. Full test suite:** `pytest -v` lulus semua (Fase 1 + Fase 2).

---

## Pitfalls

1. **Circular import:** `control/` impor `device/` → circular. Gunakan event bus. Kalau butuh data device di REST, baca dari DB, bukan dari `device/session.py` langsung.
2. **MCP id sebagai string:** Firmware mengharapkan integer. Kalau kirim string, device tidak merespons → panggilan menggantung. Test `test_id_is_integer` menjaga ini.
3. **Allowlist vs blocklist:** Jangan pakai blocklist. Tool baru yang berbahaya akan lolos. Allowlist = hanya yang explicitly diizinkan yang boleh.
4. **WebSocket auth di browser:** Browser tidak bisa kirim `Authorization` header di WebSocket. Pakai query param `?token=...`. Tetap aman karena token sudah diencode di URL, dan HTTPS mengenkripsi query string.
5. **Frame biner di log monitor:** Jangan tampilkan isi biner frame audio — bisa ribuan byte. Ringkas: "FRAME x60ms (48 bytes)".
6. **Frontend build menimpa API route:** Mount StaticFiles di `"/"` di akhir, setelah semua route `/api/*` dan `/ws/*`. Kalau tidak, API tertimpa.
7. **Event bus memory leak:** Subscriber yang tidak unsubscribe akan terus menerima event. Pastikan `finally: unsubscribe()` di monitor WebSocket.
8. **Tool berbahaya tetap bisa dipanggil:** `DoToolCall` di firmware mencari di seluruh daftar tool tanpa cek `withUserTools`. Allowlist bridge adalah satu-satunya filter. Jangan andalkan `tools/list` untuk menyaring.
9. **Pagination cursor kosong vs hilang:** `nextCursor` yang kosong ("") vs tidak ada. Firmware: kalau habis, kunci hilang sama sekali. Test `test_list_tools_single_page` memverifikasi ini.
10. **Timeout device tidak ada:** Firmware tidak punya timeout per `tools/call`. Tanpa timeout bridge, panggilan bisa menggantung selamanya. Jangan set timeout ke 0 atau None.

---

## Criteria untuk Lulus Fase 2

1. MCP tool-calling jalan: LLM minta tool → bridge panggil device via JSON-RPC → hasil kembali ke LLM → jawaban ke user.
2. Allowlist efektif: `self.reboot` dan `self.upgrade_firmware` tidak bisa dipanggil lewat LLM.
3. Timeout efektif: device tidak merespons → bridge timeout dalam 10 detik → error message ke LLM → LLM tetap merespons user.
4. REST API lengkap: agents CRUD, providers CRUD + tes koneksi, devices list/claim/detail/reboot/firmware/release, conversations list/search/transcript/delete/audio, overview stats.
5. Auth jalan: login → JWT → semua endpoint terlindungi → tenant isolation (owner A tidak bisa akses owner B).
6. Dashboard 7 halaman: Overview, Agents, Providers & Keys, Devices & Pairing, Live Monitor, Conversations, Users & Roles (stub).
7. Live Monitor real-time: event voice loop muncul di browser, waterfall latensi, status sesi, log protokol.
8. Frontend bisa di-build dan diserve oleh FastAPI.
9. `pytest -v` lulus semua (Fase 1 + Fase 2).
10. Satu worker + README catat ini.
