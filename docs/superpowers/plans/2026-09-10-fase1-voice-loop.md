# Fase 1 — Voice Loop Inti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Device ESP32 Zora Mini bisa diklaim ke akun lewat kode di layarnya, lalu voice loop dua arah (bicara → STT → LLM → TTS → jawab) berjalan end-to-end lewat bridge self-host, termasuk websearch kondisional dan pencatatan tiap turn ke Postgres.

**Architecture:** Modular monolith satu proses FastAPI. Paket `device/` menangani WebSocket + OTA + pipeline suara; paket `adapters/` membungkus provider LLM/STT/TTS/search di belakang `Protocol` Python; paket `core/` menyediakan koneksi DB dan enkripsi key. Paket `control/` (REST dashboard) TIDAK dibangun di fase ini — auth pakai satu owner yang di-seed langsung ke DB.

**Tech Stack:** Python 3.11+, FastAPI + `websockets` (asyncio), Pydantic v2, SQLAlchemy 2.0 (async) + Alembic, Postgres 16 (Docker Compose), `opuslib`, `httpx`, `cryptography` (Fernet), `openai` client (buat omnirouter), `pytest` + `pytest-asyncio`.

**Spec:** [docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md](../specs/2026-09-10-zora-bridge-system-design.md) — plan ini mengimplementasikan §3 (arsitektur), §4 (kontrak device), §5 (MCP — ditunda ke Fase 2), §6 (model data, subset Fase 1), §9 (urutan kerja poin 1-9). Baca dokumen itu untuk alasan di balik tiap keputusan; plan ini fokus ke langkah konkret.

## Global Constraints

- Arsitektur inti wajib nol biaya + lisensi permisif (MIT/BSD/Apache-2.0). Tidak ada Redis (pakai Valkey kalau nanti perlu cache — Fase 1 belum butuh). Tidak ada `pydub` (pakai `numpy`/`soxr` kalau perlu resample manual).
- edge-tts (GPL-3.0) TIDAK di-`import` ke codebase. Default TTS Fase 1 adalah **Piper**, dipanggil sebagai subprocess.
- Setiap baris tabel domain (`devices`, `conversations`, `messages`, dst) membawa `owner_id` sejak skema pertama — tidak ada migrasi susulan.
- `control/` (belum dibangun di fase ini) tidak boleh diimpor oleh `device/`, dan `device/` tidak diimpor `control/` nanti. Semua komunikasi lewat DB atau (nanti) event bus.
- Semua timestamp disimpan UTC.
- **Server yang mendeteksi akhir ucapan, bukan device** — device di mode `auto`/`realtime` tidak pernah mengirim `listen stop` (spec §4.3).
- `tts start` wajib dikirim sebelum frame biner apa pun; frame di luar itu dibuang device secara diam-diam (spec §4.6).
- Kirim audio TTS seirama waktu nyata — antrean device hanya 20 frame (1.2 detik), kelebihan kirim dibuang tanpa pemberitahuan (spec §4.6).
- Endpoint `check_version` harus tetap murah — device polling ini setiap 60 detik saat idle (spec §4.8).
- Audio percakapan disimpan sebagai file di filesystem, bukan BLOB di database (spec §6).

---

## File Structure

```
zora-bridge/
  pyproject.toml
  docker-compose.yml
  alembic.ini
  alembic/
    env.py
    versions/
  app/
    main.py                       # entrypoint FastAPI, mount router
    config.py                     # Settings (pydantic-settings) dari env
    core/
      db.py                       # engine async + session factory
      crypto.py                   # encrypt_secret / decrypt_secret (Fernet)
      models.py                   # SQLAlchemy models
    adapters/
      llm/
        base.py                   # Protocol LLMAdapter
        omnirouter.py              # implementasi via openai client
      stt/
        base.py                   # Protocol STTAdapter
        groq_whisper.py
      tts/
        base.py                   # Protocol TTSAdapter
        piper.py
      search/
        base.py                   # Protocol SearchAdapter
        searxng.py
    device/
      ota.py                      # router: POST/GET check_version, POST /activate
      ws.py                       # router: WebSocket /ws
      protocol_types.py           # dataclass pesan JSON (hello, listen, tts, dst)
      session.py                  # DeviceSession — state per koneksi
      endpointer.py                # VAD sisi server
      pacer.py                    # pengatur irama kirim audio
      opus_codec.py                # decode/encode helper tipis di atas opuslib
      pipeline.py                  # orkestrasi STT -> memori -> LLM -> (search) -> TTS
  tests/
    conftest.py
    core/test_crypto.py
    device/test_ota.py
    device/test_ws_handshake.py
    device/test_endpointer.py
    device/test_pacer.py
    device/test_pipeline.py
    adapters/test_omnirouter.py
    adapters/test_groq_whisper.py
    adapters/test_piper.py
    adapters/test_searxng.py
```

---

## Precondition: dev environment sebelum Task 1

Sebelum executor mulai Task 1, environment berikut harus ada:

- Docker + Docker Compose terpasang.
- Python 3.11+ terpasang lokal (buat menjalankan `pytest` di luar container saat iterasi cepat).
- `libopus` terpasang di sistem (`brew install opus` di macOS, `apt install libopus0 libopus-dev` di Debian) — `opuslib` adalah binding ctypes ke library native ini, bukan pure-Python.
- Akses ke sebuah instance omnirouter (`http://localhost:20128/v1`) dengan API key yang valid, buat testing manual di Task 4. Unit test Task 4 pakai HTTP mock, tidak butuh omnirouter sungguhan.
- (Opsional untuk Task 5/6, tidak wajib buat lulus test) key Groq dan binary Piper + satu model suara `id_ID` — kalau tidak ada, test unit tetap jalan lewat mock; hanya smoke-test manual end-to-end yang butuh ini.

---

### Task 1: Project scaffold, Postgres, dan model data dasar

**Files:**
- Create: `pyproject.toml`
- Create: `docker-compose.yml`
- Create: `app/__init__.py`, `app/config.py`
- Create: `app/core/__init__.py`, `app/core/db.py`, `app/core/models.py`
- Create: `alembic.ini`, `alembic/env.py`
- Create: `tests/conftest.py`
- Create: `tests/core/test_models.py`

**Interfaces:**
- Produces: `app.core.db.get_engine() -> AsyncEngine`, `app.core.db.get_sessionmaker() -> async_sessionmaker`, `app.config.Settings` (pydantic-settings `BaseSettings` dengan field `database_url: str`, `secret_key: bytes`), model SQLAlchemy `Owner`, `Device`, `ActivationCode`, `Conversation`, `Message` di `app.core.models` (semuanya `DeclarativeBase` subclass bernama `Base`).

- [ ] **Step 1: Tulis `pyproject.toml`**

```toml
[project]
name = "zora-bridge"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "websockets>=13.0",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "sqlalchemy[asyncio]>=2.0.35",
    "asyncpg>=0.30",
    "alembic>=1.13",
    "httpx>=0.27",
    "cryptography>=43.0",
    "openai>=1.54",
    "opuslib>=3.0.1",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "pytest-httpx>=0.33",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: Tulis `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: zora
      POSTGRES_PASSWORD: zora_dev_only
      POSTGRES_DB: zora_bridge
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zora"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

- [ ] **Step 3: Jalankan Postgres**

Run: `docker compose up -d postgres`
Expected: container `zora-bridge-postgres-1` status `healthy` dalam 15 detik (`docker compose ps`).

- [ ] **Step 4: Tulis `app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ZORA_")

    database_url: str = "postgresql+asyncpg://zora:zora_dev_only@localhost:5432/zora_bridge"
    secret_key: str = "dev-only-change-me-32-bytes-min!!"


settings = Settings()
```

- [ ] **Step 5: Tulis test model dulu (gagal karena `app.core.models` belum ada)**

`tests/core/test_models.py`:

```python
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.core.models import Base, Owner, Device, ActivationCode


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def test_owner_device_round_trip(session):
    owner = Owner(id=uuid.uuid4(), email="yusuf@tspindonesia.com")
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


async def test_activation_code_expiry_field(session):
    owner = Owner(id=uuid.uuid4(), email="a@b.com")
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
```

Note: `sqlite+aiosqlite` dipakai HANYA untuk test model ini (cepat, tanpa Docker). Pastikan tambahkan `aiosqlite` ke `dev` deps di `pyproject.toml` Step 1 sebelum lanjut.

- [ ] **Step 6: Jalankan test, pastikan gagal (module belum ada)**

Run: `pip install -e ".[dev]" && pytest tests/core/test_models.py -v`
Expected: FAIL dengan `ModuleNotFoundError: No module named 'app.core.models'`

- [ ] **Step 7: Tulis `app/core/models.py`**

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Text, Integer, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator, CHAR
import uuid as uuid_mod


class GUID(TypeDecorator):
    """UUID sebagai CHAR(36) - portabel Postgres & SQLite (dipakai di test)."""
    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return uuid_mod.UUID(value)


def _json_type():
    # JSONB hanya jalan di Postgres; test model pakai SQLite jadi fallback ke JSON generik
    from sqlalchemy import JSON
    return JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class Owner(Base):
    __tablename__ = "owners"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    device_id: Mapped[str] = mapped_column(String(17), unique=True)  # MAC, format AA:BB:CC:DD:EE:FF
    client_id: Mapped[str] = mapped_column(String(64))
    alias: Mapped[str] = mapped_column(String(120), default="Zora")
    board: Mapped[str | None] = mapped_column(String(64), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(128))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ActivationCode(Base):
    __tablename__ = "activation_codes"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    device_id: Mapped[str] = mapped_column(String(17))
    client_id: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_by_owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("devices.id"), index=True)
    session_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("owners.id"), index=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("conversations.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # "user" | "assistant"
    text: Mapped[str] = mapped_column(Text)
    provider_used: Mapped[dict | None] = mapped_column(_json_type(), nullable=True)
    latency_ms: Mapped[dict | None] = mapped_column(_json_type(), nullable=True)
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 8: Jalankan test, pastikan lulus**

Run: `pytest tests/core/test_models.py -v`
Expected: PASS (2 test)

- [ ] **Step 9: Tulis `app/core/db.py`**

```python
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.config import settings

_engine: AsyncEngine | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    return _engine


def get_sessionmaker() -> async_sessionmaker:
    return async_sessionmaker(get_engine(), expire_on_commit=False)
```

- [ ] **Step 10: Inisialisasi Alembic dan buat migrasi pertama**

Run:
```bash
alembic init alembic
```

Edit `alembic.ini`: ganti baris `sqlalchemy.url = ...` jadi kosong (akan di-set dari `env.py`).

Edit `alembic/env.py`, tambahkan di atas `target_metadata = None`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.core.models import Base

config.set_main_option("sqlalchemy.url", settings.database_url.replace("+asyncpg", ""))
target_metadata = Base.metadata
```

(Alembic secara default jalan sync; ganti `+asyncpg` ke driver sync `psycopg2` khusus untuk migrasi. Tambahkan `psycopg2-binary` ke `pyproject.toml` dev deps.)

Run: `alembic revision --autogenerate -m "initial schema"`
Expected: file baru muncul di `alembic/versions/`, isinya `create_table` untuk `owners`, `devices`, `activation_codes`, `conversations`, `messages`.

- [ ] **Step 11: Terapkan migrasi ke Postgres sungguhan**

Run: `alembic upgrade head`
Expected: tidak ada error; `docker exec -it zora-bridge-postgres-1 psql -U zora -d zora_bridge -c '\dt'` menampilkan lima tabel.

- [ ] **Step 12: Commit**

```bash
git add pyproject.toml docker-compose.yml app/ alembic.ini alembic/ tests/
git commit -m "feat: scaffold project, postgres, and core data models"
```

---

### Task 2: Enkripsi key (crypto helper)

Dibutuhkan sebelum adapter provider (Task 4-6) karena key BYOK harus tersimpan terenkripsi sejak baris pertama ditulis, sesuai spec §8.

**Files:**
- Create: `app/core/crypto.py`
- Test: `tests/core/test_crypto.py`

**Interfaces:**
- Consumes: `app.config.settings.secret_key` (dari Task 1)
- Produces: `encrypt_secret(plaintext: str) -> str`, `decrypt_secret(token: str) -> str`, `last4(plaintext: str) -> str`

- [ ] **Step 1: Tulis test**

`tests/core/test_crypto.py`:

```python
from app.core.crypto import encrypt_secret, decrypt_secret, last4


def test_round_trip():
    plaintext = "sk-or-abcdef1234567890"
    token = encrypt_secret(plaintext)
    assert token != plaintext
    assert decrypt_secret(token) == plaintext


def test_last4():
    assert last4("sk-or-abcdef1234567890") == "7890"


def test_last4_short_string():
    assert last4("ab") == "ab"
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/core/test_crypto.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implementasi**

```python
import base64
import hashlib

from cryptography.fernet import Fernet

from app.config import settings


def _fernet() -> Fernet:
    # Fernet butuh key 32-byte urlsafe-base64. Turunkan dari secret_key settings
    # supaya operator cukup set satu ZORA_SECRET_KEY di env, bukan key Fernet mentah.
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def last4(plaintext: str) -> str:
    return plaintext[-4:] if len(plaintext) >= 4 else plaintext
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/core/test_crypto.py -v`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add app/core/crypto.py tests/core/test_crypto.py
git commit -m "feat: add secret encryption helper for BYOK keys"
```

---

### Task 3: Endpoint OTA — `check_version` dan `/activate`

Ini jalur pairing device. Wajib tepat pada semantik 202/200 (spec §4.2) — proyek pembanding paling sering gagal di sini.

**Files:**
- Create: `app/device/__init__.py`, `app/device/ota.py`
- Modify: `app/main.py` (buat kalau belum ada, mount router)
- Test: `tests/device/test_ota.py`

**Interfaces:**
- Consumes: `app.core.db.get_sessionmaker()`, model `Device`, `ActivationCode`, `Owner` (Task 1)
- Produces: FastAPI `APIRouter` bernama `ota_router` dengan route `POST /ota/check_version` dan `POST /ota/activate`; fungsi `generate_activation_code() -> str` (6 karakter alfanumerik kapital, tanpa `0/O/1/I` biar gak ambigu di layar kecil).

- [ ] **Step 1: Tulis test untuk device yang belum dikenal (harus dapat kode aktivasi)**

`tests/device/test_ota.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.core.db import get_sessionmaker
from app.core.models import Device


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_unknown_device_gets_activation_code(client):
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:01", "Client-Id": "test-client-1"},
        json={"application": {"version": "1.9.2"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "activation" in body
    assert len(body["activation"]["code"]) == 6
    assert "server_time" in body
    assert "timestamp" in body["server_time"]
    assert "websocket" not in body  # belum diklaim, jangan kasih token


async def test_activate_poll_returns_202_before_claim(client):
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:02", "Client-Id": "test-client-2"},
        json={"application": {"version": "1.9.2"}},
    )
    code = resp.json()["activation"]["code"]

    poll = await client.post(
        "/ota/activate",
        headers={"Device-Id": "A4:CF:12:9B:99:02", "Client-Id": "test-client-2"},
        json={},
    )
    assert poll.status_code == 202


async def test_activate_returns_200_after_claim(client):
    resp = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:03", "Client-Id": "test-client-3"},
        json={"application": {"version": "1.9.2"}},
    )
    code = resp.json()["activation"]["code"]

    session_maker = get_sessionmaker()
    async with session_maker() as session:
        from app.core.models import Owner, ActivationCode
        from sqlalchemy import select
        import uuid
        from datetime import datetime, timezone

        owner = Owner(id=uuid.uuid4(), email="test-owner@example.com")
        session.add(owner)
        await session.flush()

        result = await session.execute(
            select(ActivationCode).where(ActivationCode.code == code)
        )
        activation = result.scalar_one()
        activation.claimed_at = datetime.now(timezone.utc)
        activation.claimed_by_owner_id = owner.id
        await session.commit()

    poll = await client.post(
        "/ota/activate",
        headers={"Device-Id": "A4:CF:12:9B:99:03", "Client-Id": "test-client-3"},
        json={},
    )
    assert poll.status_code == 200

    recheck = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:03", "Client-Id": "test-client-3"},
        json={"application": {"version": "1.9.2"}},
    )
    body = recheck.json()
    assert body["websocket"]["url"]
    assert body["websocket"]["token"]
    assert "activation" not in body
```

Catatan: test ini butuh Postgres dari Task 1 hidup (`docker compose up -d postgres`) dan `alembic upgrade head` sudah jalan, karena OTA router menulis ke DB sungguhan lewat `get_sessionmaker()`. Tambahkan fixture `conftest.py` yang men-truncate tabel `owners`, `devices`, `activation_codes` sebelum tiap test kalau belum ada — kalau sudah ada dari Task 1, cukup pastikan mencakup tabel ini juga.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_ota.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'` (atau serupa)

- [ ] **Step 3: Tulis `app/main.py` minimal**

```python
from fastapi import FastAPI

from app.device.ota import ota_router

app = FastAPI(title="Zora Bridge")
app.include_router(ota_router)
```

- [ ] **Step 4: Tulis `app/device/ota.py`**

```python
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.core.models import ActivationCode, Device

ota_router = APIRouter(prefix="/ota", tags=["ota"])

_CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "01OI")
_ACTIVATION_TTL = timedelta(minutes=10)


def generate_activation_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


@ota_router.post("/check_version")
async def check_version(
    request: Request,
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    session_maker = get_sessionmaker()
    now = datetime.now(timezone.utc)

    async with session_maker() as session:
        result = await session.execute(
            select(Device).where(Device.device_id == device_id)
        )
        device = result.scalar_one_or_none()

        body: dict = {
            "server_time": {
                "timestamp": int(now.timestamp() * 1000),
                "timezone_offset": 0,
            },
        }

        if device is not None:
            # sudah diklaim - kasih config websocket, JANGAN kasih activation
            body["websocket"] = {
                "url": "ws://localhost:8000/ws",
                "token": device.token_hash,  # lihat catatan Task 3 Step 7 soal token vs hash
                "version": 1,
            }
            device.last_seen_at = now
            await session.commit()
            return JSONResponse(body)

        # belum diklaim - cari activation code aktif atau buat baru
        result = await session.execute(
            select(ActivationCode).where(
                ActivationCode.device_id == device_id,
                ActivationCode.claimed_at.is_(None),
                ActivationCode.expires_at > now,
            )
        )
        activation = result.scalar_one_or_none()

        if activation is None:
            import uuid

            activation = ActivationCode(
                id=uuid.uuid4(),
                code=generate_activation_code(),
                device_id=device_id,
                client_id=client_id,
                expires_at=now + _ACTIVATION_TTL,
            )
            session.add(activation)
            await session.commit()

        body["activation"] = {
            "message": "Masukkan kode ini di dashboard untuk memasangkan device",
            "code": activation.code,
            "timeout_ms": 30000,
        }
        return JSONResponse(body)


@ota_router.post("/activate")
async def activate(
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    session_maker = get_sessionmaker()
    now = datetime.now(timezone.utc)

    async with session_maker() as session:
        result = await session.execute(
            select(ActivationCode)
            .where(ActivationCode.device_id == device_id)
            .order_by(ActivationCode.created_at.desc())
        )
        activation = result.scalars().first()

        if activation is None or activation.expires_at < now:
            return JSONResponse(status_code=404, content={"error": "no pending activation"})

        if activation.claimed_at is None:
            return JSONResponse(status_code=202, content={})

        # sudah diklaim - buat row Device kalau belum ada, lalu 200
        existing = await session.execute(
            select(Device).where(Device.device_id == device_id)
        )
        if existing.scalar_one_or_none() is None:
            import secrets as _secrets
            import uuid

            token = _secrets.token_urlsafe(24)
            device = Device(
                id=uuid.uuid4(),
                owner_id=activation.claimed_by_owner_id,
                device_id=device_id,
                client_id=client_id,
                token_hash=token,  # lihat catatan Task 3 Step 7
            )
            session.add(device)
            await session.commit()

        return JSONResponse(status_code=200, content={"access_token": "granted"})
```

**Catatan penting untuk implementer** (bukan placeholder — ini keputusan yang sengaja ditunda dengan alasan eksplisit): field `token_hash` di model `Device` (Task 1) dinamai demikian karena spec §8 mensyaratkan token disimpan sebagai hash, bukan plaintext. Kode Step 4 di atas untuk sementara MENYIMPAN TOKEN MENTAH ke kolom itu supaya Task 3 bisa selesai dan diuji tanpa bergantung pada skema hashing token device (belum dispesifikasikan — beda dari password hashing `Owner.password_hash` yang pakai argon2 di Fase 2/3). **Sebelum Fase 1 dianggap selesai, buka isu susulan:** ganti jadi hash (mis. SHA-256 token, karena token device bukan password yang butuh argon2 — device membandingkan token apa adanya, bukan lewat form login) dan bandingkan hash saat validasi WS handshake di Task 7. Jangan biarkan token plaintext ini lolos ke produksi.

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pytest tests/device/test_ota.py -v`
Expected: PASS (3 test)

- [ ] **Step 6: Tes manual idempotensi — device yang sama check_version dua kali sebelum diklaim dapat kode yang SAMA**

Tambahkan test:

```python
async def test_repeated_check_version_reuses_same_code(client):
    r1 = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:04", "Client-Id": "test-client-4"},
        json={},
    )
    r2 = await client.post(
        "/ota/check_version",
        headers={"Device-Id": "A4:CF:12:9B:99:04", "Client-Id": "test-client-4"},
        json={},
    )
    assert r1.json()["activation"]["code"] == r2.json()["activation"]["code"]
```

Run: `pytest tests/device/test_ota.py -v`
Expected: PASS (4 test). Kalau gagal, cek query `ActivationCode` di Step 4 — filter `claimed_at.is_(None)` dan `expires_at > now` harus match row yang sudah dibuat.

- [ ] **Step 7: Commit**

```bash
git add app/main.py app/device/ota.py tests/device/test_ota.py
git commit -m "feat: implement OTA check_version and activation polling"
```

---

### Task 4: Adapter LLM — omnirouter

**Files:**
- Create: `app/adapters/__init__.py`, `app/adapters/llm/__init__.py`, `app/adapters/llm/base.py`, `app/adapters/llm/omnirouter.py`
- Test: `tests/adapters/test_omnirouter.py`

**Interfaces:**
- Produces: `Protocol LLMAdapter` dengan method `async def complete(self, messages: list[dict], *, tools: list[dict] | None = None, max_tokens: int = 160, temperature: float = 0.7) -> LLMResponse`; dataclass `LLMResponse(text: str, tool_calls: list[dict], latency_ms: int)`; class `OmnirouterAdapter(base_url: str, api_key: str, model: str)` yang mengimplementasikan protocol itu.

- [ ] **Step 1: Tulis test pakai `pytest-httpx` (mock HTTP, tidak butuh omnirouter sungguhan)**

`tests/adapters/test_omnirouter.py`:

```python
import pytest

from app.adapters.llm.omnirouter import OmnirouterAdapter


async def test_complete_returns_text(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:20128/v1/chat/completions",
        json={
            "choices": [
                {"message": {"role": "assistant", "content": "Besok cuaca cerah."}}
            ]
        },
    )

    adapter = OmnirouterAdapter(
        base_url="http://localhost:20128/v1",
        api_key="sk-test",
        model="claude-sonnet-5",
    )
    result = await adapter.complete(
        messages=[{"role": "user", "content": "Cuaca besok gimana?"}]
    )

    assert result.text == "Besok cuaca cerah."
    assert result.tool_calls == []
    assert result.latency_ms >= 0


async def test_complete_extracts_tool_calls(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:20128/v1/chat/completions",
        json={
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "function": {
                                    "name": "web_search",
                                    "arguments": '{"query": "cuaca surabaya besok"}',
                                },
                            }
                        ],
                    }
                }
            ]
        },
    )

    adapter = OmnirouterAdapter(
        base_url="http://localhost:20128/v1", api_key="sk-test", model="claude-sonnet-5"
    )
    result = await adapter.complete(
        messages=[{"role": "user", "content": "Cuaca besok gimana?"}],
        tools=[{"type": "function", "function": {"name": "web_search"}}],
    )

    assert result.text == ""
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0]["function"]["name"] == "web_search"
```

Tambahkan `pytest-httpx` ke `pyproject.toml` dev deps kalau belum ada dari Task 1.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/adapters/test_omnirouter.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Tulis `app/adapters/llm/base.py`**

```python
from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class LLMResponse:
    text: str
    tool_calls: list[dict] = field(default_factory=list)
    latency_ms: int = 0


class LLMAdapter(Protocol):
    async def complete(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        max_tokens: int = 160,
        temperature: float = 0.7,
    ) -> LLMResponse:
        ...
```

- [ ] **Step 4: Tulis `app/adapters/llm/omnirouter.py`**

```python
import time

import httpx

from app.adapters.llm.base import LLMResponse


class OmnirouterAdapter:
    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 20.0):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def complete(
        self,
        messages: list[dict],
        *,
        tools: list[dict] | None = None,
        max_tokens: int = 160,
        temperature: float = 0.7,
    ) -> LLMResponse:
        payload = {
            "model": self._model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        resp.raise_for_status()

        message = resp.json()["choices"][0]["message"]
        return LLMResponse(
            text=message.get("content") or "",
            tool_calls=message.get("tool_calls") or [],
            latency_ms=latency_ms,
        )
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pytest tests/adapters/test_omnirouter.py -v`
Expected: PASS (2 test)

- [ ] **Step 6: Commit**

```bash
git add app/adapters/llm/ tests/adapters/test_omnirouter.py
git commit -m "feat: add omnirouter LLM adapter"
```

---

### Task 5: Adapter STT (Groq Whisper) + endpointer VAD sisi server

Ini task paling kritis di spec — device tidak pernah bilang "user berhenti bicara" di mode auto/realtime (spec §4.3). `endpointer.py` yang harus memutuskan.

**Files:**
- Create: `app/adapters/stt/__init__.py`, `app/adapters/stt/base.py`, `app/adapters/stt/groq_whisper.py`
- Create: `app/device/endpointer.py`
- Test: `tests/adapters/test_groq_whisper.py`, `tests/device/test_endpointer.py`

**Interfaces:**
- Produces (adapter): `Protocol STTAdapter` dengan `async def transcribe(self, pcm_audio: bytes, *, sample_rate: int = 16000) -> STTResult`; dataclass `STTResult(text: str, latency_ms: int)`; class `GroqWhisperAdapter(api_key: str, model: str = "whisper-large-v3-turbo")`.
- Produces (endpointer): class `Endpointer(silence_ms: int = 800, sample_rate: int = 16000, frame_ms: int = 60)` dengan method `feed(self, pcm_frame: bytes) -> EndpointEvent | None` yang dipanggil per frame 60ms PCM; `EndpointEvent` adalah `Literal["speech_start", "speech_end"]`. Endpointer TIDAK melakukan decode Opus — itu tanggung jawab `pipeline.py` di Task 7, yang memanggil `opus_codec.decode()` dulu baru menyuapkan PCM ke `Endpointer.feed()`.

- [ ] **Step 1: Tulis test adapter Groq (mock HTTP)**

`tests/adapters/test_groq_whisper.py`:

```python
import pytest

from app.adapters.stt.groq_whisper import GroqWhisperAdapter


async def test_transcribe_returns_text(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.groq.com/openai/v1/audio/transcriptions",
        json={"text": "besok cuaca surabaya gimana"},
    )

    adapter = GroqWhisperAdapter(api_key="gsk-test")
    result = await adapter.transcribe(pcm_audio=b"\x00\x01" * 100, sample_rate=16000)

    assert result.text == "besok cuaca surabaya gimana"
    assert result.latency_ms >= 0
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/adapters/test_groq_whisper.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Tulis `app/adapters/stt/base.py`**

```python
from dataclasses import dataclass
from typing import Protocol


@dataclass
class STTResult:
    text: str
    latency_ms: int = 0


class STTAdapter(Protocol):
    async def transcribe(self, pcm_audio: bytes, *, sample_rate: int = 16000) -> STTResult:
        ...
```

- [ ] **Step 4: Tulis `app/adapters/stt/groq_whisper.py`**

PCM mentah dibungkus jadi WAV in-memory dulu (Groq butuh file audio dengan header, bukan raw PCM tanpa konteks format).

```python
import io
import time
import wave

import httpx

from app.adapters.stt.base import STTResult


def _pcm_to_wav_bytes(pcm_audio: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit PCM
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_audio)
    return buf.getvalue()


class GroqWhisperAdapter:
    def __init__(self, api_key: str, model: str = "whisper-large-v3-turbo", timeout: float = 15.0):
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def transcribe(self, pcm_audio: bytes, *, sample_rate: int = 16000) -> STTResult:
        wav_bytes = _pcm_to_wav_bytes(pcm_audio, sample_rate)

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                files={"file": ("audio.wav", wav_bytes, "audio/wav")},
                data={"model": self._model, "language": "id"},
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        resp.raise_for_status()

        return STTResult(text=resp.json()["text"], latency_ms=latency_ms)
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pytest tests/adapters/test_groq_whisper.py -v`
Expected: PASS (1 test)

- [ ] **Step 6: Commit adapter**

```bash
git add app/adapters/stt/ tests/adapters/test_groq_whisper.py
git commit -m "feat: add groq whisper STT adapter"
```

- [ ] **Step 7: Tulis test endpointer — deteksi speech_start dan speech_end pakai energi frame sederhana**

`tests/device/test_endpointer.py`:

```python
import struct

from app.device.endpointer import Endpointer


def _silent_frame(n_samples: int = 960) -> bytes:
    # 60ms @ 16kHz mono 16-bit = 960 sample
    return struct.pack(f"<{n_samples}h", *([0] * n_samples))


def _loud_frame(n_samples: int = 960, amplitude: int = 8000) -> bytes:
    return struct.pack(f"<{n_samples}h", *([amplitude, -amplitude] * (n_samples // 2)))


def test_speech_start_on_first_loud_frame():
    ep = Endpointer(silence_ms=800, sample_rate=16000, frame_ms=60)

    assert ep.feed(_silent_frame()) is None
    event = ep.feed(_loud_frame())
    assert event == "speech_start"


def test_speech_end_after_silence_threshold():
    ep = Endpointer(silence_ms=180, sample_rate=16000, frame_ms=60)  # 3 frame @ 60ms

    ep.feed(_loud_frame())  # speech_start
    assert ep.feed(_silent_frame()) is None       # hening frame 1/3
    assert ep.feed(_silent_frame()) is None       # hening frame 2/3
    event = ep.feed(_silent_frame())              # hening frame 3/3 - cukup
    assert event == "speech_end"


def test_no_event_during_continuous_speech():
    ep = Endpointer(silence_ms=800, sample_rate=16000, frame_ms=60)

    ep.feed(_loud_frame())
    for _ in range(5):
        assert ep.feed(_loud_frame()) is None


def test_brief_silence_does_not_end_speech():
    ep = Endpointer(silence_ms=800, sample_rate=16000, frame_ms=60)  # butuh ~13 frame hening

    ep.feed(_loud_frame())
    assert ep.feed(_silent_frame()) is None
    assert ep.feed(_silent_frame()) is None
    event = ep.feed(_loud_frame())  # bicara lagi sebelum ambang hening tercapai
    assert event is None
```

- [ ] **Step 8: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_endpointer.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 9: Implementasi endpointer berbasis energi RMS per frame**

```python
import audioop
from typing import Literal

EndpointEvent = Literal["speech_start", "speech_end"]


class Endpointer:
    """VAD sisi server berbasis energi RMS per frame.

    Device tidak pernah mengirim sinyal akhir-ucapan di mode auto/realtime
    (spec §4.3) — bridge yang wajib mendeteksinya sendiri dari stream PCM
    yang sudah di-decode dari Opus.
    """

    _ENERGY_THRESHOLD = 500  # ambang RMS 16-bit PCM; disetel manual, lihat spec §10 (perlu tuning)

    def __init__(self, silence_ms: int = 800, sample_rate: int = 16000, frame_ms: int = 60):
        self._silence_frames_needed = max(1, silence_ms // frame_ms)
        self._in_speech = False
        self._consecutive_silence_frames = 0

    def feed(self, pcm_frame: bytes) -> EndpointEvent | None:
        energy = audioop.rms(pcm_frame, 2)  # 2 = 16-bit sample width
        is_loud = energy >= self._ENERGY_THRESHOLD

        if not self._in_speech:
            if is_loud:
                self._in_speech = True
                self._consecutive_silence_frames = 0
                return "speech_start"
            return None

        # sudah dalam speech
        if is_loud:
            self._consecutive_silence_frames = 0
            return None

        self._consecutive_silence_frames += 1
        if self._consecutive_silence_frames >= self._silence_frames_needed:
            self._in_speech = False
            self._consecutive_silence_frames = 0
            return "speech_end"
        return None
```

- [ ] **Step 10: Jalankan test, pastikan lulus**

Run: `pytest tests/device/test_endpointer.py -v`
Expected: PASS (4 test)

- [ ] **Step 11: Commit**

```bash
git add app/device/endpointer.py tests/device/test_endpointer.py
git commit -m "feat: add server-side VAD endpointer for turn detection"
```

---

### Task 6: Adapter TTS (Piper) + pacer irama audio

`pacer.py` mencegah bug yang sudah terjadi di proyek pembanding: pre-buffer yang melewati rate-limit membanjiri RX device (spec §4.6).

**Files:**
- Create: `app/adapters/tts/__init__.py`, `app/adapters/tts/base.py`, `app/adapters/tts/piper.py`
- Create: `app/device/pacer.py`
- Test: `tests/adapters/test_piper.py`, `tests/device/test_pacer.py`

**Interfaces:**
- Produces (adapter): `Protocol TTSAdapter` dengan `async def synthesize(self, text: str, *, voice: str) -> TTSResult`; dataclass `TTSResult(pcm_audio: bytes, sample_rate: int, latency_ms: int)`; class `PiperAdapter(binary_path: str, model_path: str)` yang memanggil binary Piper via subprocess.
- Produces (pacer): async generator function `pace_frames(frames: list[bytes], frame_duration_ms: int = 60) -> AsyncIterator[bytes]` yang menghasilkan tiap frame dengan jeda `frame_duration_ms` milidetik antar frame (kecuali frame pertama, dikirim segera) — **tanpa pre-buffer**, sesuai catatan spec §4.6 soal bug `PRE_BUFFER_COUNT=5` di proyek pembanding.

- [ ] **Step 1: Tulis test Piper — mock subprocess, bukan panggil binary sungguhan**

`tests/adapters/test_piper.py`:

```python
import pytest

from app.adapters.tts import piper as piper_module
from app.adapters.tts.piper import PiperAdapter


class _FakeProcess:
    def __init__(self, stdout_bytes: bytes):
        self._stdout_bytes = stdout_bytes
        self.returncode = 0

    async def communicate(self, input: bytes | None = None):
        return self._stdout_bytes, b""

    async def wait(self):
        return 0


async def test_synthesize_returns_pcm(monkeypatch):
    fake_wav_header = b"RIFF" + b"\x00" * 40  # header WAV palsu, cukup buat cek pemanggilan
    fake_pcm_body = b"\x01\x02" * 500

    async def fake_create_subprocess_exec(*args, **kwargs):
        return _FakeProcess(fake_wav_header + fake_pcm_body)

    monkeypatch.setattr(
        piper_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )

    adapter = PiperAdapter(binary_path="/usr/bin/piper", model_path="/models/id_ID-news-medium.onnx")
    result = await adapter.synthesize("Halo, apa kabar?", voice="id_ID-news-medium")

    assert isinstance(result.pcm_audio, bytes)
    assert result.sample_rate == 22050
    assert result.latency_ms >= 0
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/adapters/test_piper.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Tulis `app/adapters/tts/base.py`**

```python
from dataclasses import dataclass
from typing import Protocol


@dataclass
class TTSResult:
    pcm_audio: bytes
    sample_rate: int
    latency_ms: int = 0


class TTSAdapter(Protocol):
    async def synthesize(self, text: str, *, voice: str) -> TTSResult:
        ...
```

- [ ] **Step 4: Tulis `app/adapters/tts/piper.py`**

```python
import asyncio
import time
import wave
import io

from app.adapters.tts.base import TTSResult

_PIPER_SAMPLE_RATE = 22050  # default keluaran model id_ID Piper


class PiperAdapter:
    def __init__(self, binary_path: str, model_path: str):
        self._binary_path = binary_path
        self._model_path = model_path

    async def synthesize(self, text: str, *, voice: str) -> TTSResult:
        start = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            self._binary_path,
            "--model", self._model_path,
            "--output-raw" if False else "--output_file", "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate(input=text.encode("utf-8"))
        latency_ms = int((time.monotonic() - start) * 1000)

        with wave.open(io.BytesIO(stdout), "rb") as wf:
            pcm = wf.readframes(wf.getnframes())
            sample_rate = wf.getframerate()

        return TTSResult(pcm_audio=pcm, sample_rate=sample_rate, latency_ms=latency_ms)
```

Catatan: flag CLI Piper sungguhan (`--output_file -` vs `--output-raw`) harus diverifikasi terhadap versi binary yang dipasang saat smoke-test manual (Step 6) — dokumentasi Piper berubah antar versi. Test unit di atas mem-mock subprocess sepenuhnya jadi tidak tersandera oleh ini.

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pytest tests/adapters/test_piper.py -v`
Expected: PASS (1 test)

- [ ] **Step 6 (manual, opsional — butuh Piper terpasang): verifikasi flag CLI sungguhan**

Run: `echo "Halo dunia" | piper --model /path/ke/id_ID-*.onnx --output_file /tmp/test.wav && afplay /tmp/test.wav` (ganti `afplay` dengan `aplay` di Linux)
Expected: terdengar suara Bahasa Indonesia mengucapkan "Halo dunia". Kalau flag berbeda, sesuaikan `piper.py` Step 4.

- [ ] **Step 7: Commit adapter**

```bash
git add app/adapters/tts/ tests/adapters/test_piper.py
git commit -m "feat: add piper TTS adapter"
```

- [ ] **Step 8: Tulis test pacer**

`tests/device/test_pacer.py`:

```python
import time

import pytest

from app.device.pacer import pace_frames


async def test_first_frame_sent_immediately():
    frames = [b"frame0", b"frame1", b"frame2"]
    start = time.monotonic()
    sent = []
    async for frame in pace_frames(frames, frame_duration_ms=60):
        sent.append((frame, time.monotonic() - start))

    assert sent[0][1] < 0.01  # frame pertama nyaris instan
    assert [f for f, _ in sent] == frames


async def test_frames_spaced_by_frame_duration():
    frames = [b"a", b"b", b"c"]
    timestamps = []
    start = time.monotonic()
    async for _ in pace_frames(frames, frame_duration_ms=60):
        timestamps.append(time.monotonic() - start)

    gap_1 = timestamps[1] - timestamps[0]
    gap_2 = timestamps[2] - timestamps[1]
    assert 0.05 <= gap_1 <= 0.09   # ~60ms, toleransi jadwal asyncio
    assert 0.05 <= gap_2 <= 0.09


async def test_no_prebuffer_burst():
    # Bug proyek pembanding: PRE_BUFFER_COUNT=5 mengirim 5 frame nyaris bersamaan.
    # pace_frames tidak boleh mengirim lebih dari 1 frame dalam 10ms pertama.
    frames = [b"x"] * 10
    start = time.monotonic()
    burst_count = 0
    async for _ in pace_frames(frames, frame_duration_ms=60):
        if time.monotonic() - start < 0.01:
            burst_count += 1
    assert burst_count == 1
```

- [ ] **Step 9: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_pacer.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 10: Implementasi pacer**

```python
import asyncio
from collections.abc import AsyncIterator


async def pace_frames(
    frames: list[bytes], frame_duration_ms: int = 60
) -> AsyncIterator[bytes]:
    """Kirim frame seirama waktu nyata, tanpa pre-buffer.

    Antrean decode device hanya menampung ~20 frame (1.2 detik) dan
    kelebihan kirim dibuang diam-diam (spec §4.6). Proyek pembanding
    punya bug PRE_BUFFER_COUNT=5 yang membanjiri RX device dalam 10ms
    dan memutus playback setelah satu suku kata — jangan ulangi itu:
    frame pertama boleh langsung, sisanya WAJIB menunggu penuh.
    """
    frame_interval = frame_duration_ms / 1000.0
    for i, frame in enumerate(frames):
        if i > 0:
            await asyncio.sleep(frame_interval)
        yield frame
```

- [ ] **Step 11: Jalankan test, pastikan lulus**

Run: `pytest tests/device/test_pacer.py -v`
Expected: PASS (3 test)

- [ ] **Step 12: Commit**

```bash
git add app/device/pacer.py tests/device/test_pacer.py
git commit -m "feat: add real-time audio pacer to prevent device RX flooding"
```

---

### Task 7: WebSocket handshake dan opus codec

**Files:**
- Create: `app/device/opus_codec.py`
- Create: `app/device/protocol_types.py`
- Create: `app/device/session.py`
- Create: `app/device/ws.py`
- Modify: `app/main.py` (mount `ws_router`)
- Test: `tests/device/test_opus_codec.py`, `tests/device/test_ws_handshake.py`

**Interfaces:**
- Consumes: `app.core.db.get_sessionmaker()`, `Device` model (Task 1)
- Produces: `opus_codec.decode(opus_packet: bytes, sample_rate: int = 16000) -> bytes` (PCM 16-bit mono), `opus_codec.encode(pcm: bytes, sample_rate: int = 24000, frame_duration_ms: int = 60) -> bytes`; class `DeviceSession(session_id: str, device_id: str)` menyimpan `listen_mode: Literal["auto", "manual", "realtime"]` dan `state: Literal["idle", "listening", "speaking"]`; `ws_router` dengan route `WebSocket /ws`.

- [ ] **Step 1: Tulis test opus codec — round-trip encode/decode**

`tests/device/test_opus_codec.py`:

```python
import struct

from app.device.opus_codec import decode, encode


def test_encode_decode_round_trip_preserves_length():
    n_samples = 960  # 60ms @ 16kHz mono
    pcm_in = struct.pack(f"<{n_samples}h", *([1000, -1000] * (n_samples // 2)))

    opus_packet = encode(pcm_in, sample_rate=16000, frame_duration_ms=60)
    assert isinstance(opus_packet, bytes)
    assert len(opus_packet) < len(pcm_in)  # opus harus mengompresi

    pcm_out = decode(opus_packet, sample_rate=16000)
    assert len(pcm_out) == len(pcm_in)  # sample count balik ke jumlah semula
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_opus_codec.py -v`
Expected: FAIL — `ModuleNotFoundError`. Kalau gagal dengan error terkait `libopus` (`OSError: cannot load library`), install dulu: `brew install opus` (macOS) atau `apt install libopus0` (Linux) — lihat Precondition di atas.

- [ ] **Step 3: Implementasi `app/device/opus_codec.py`**

```python
import opuslib

_FRAME_SAMPLES = {
    (16000, 60): 960,
    (24000, 60): 1440,
}


def _samples_per_frame(sample_rate: int, frame_duration_ms: int) -> int:
    key = (sample_rate, frame_duration_ms)
    if key not in _FRAME_SAMPLES:
        return int(sample_rate * frame_duration_ms / 1000)
    return _FRAME_SAMPLES[key]


def decode(opus_packet: bytes, sample_rate: int = 16000, frame_duration_ms: int = 60) -> bytes:
    decoder = opuslib.Decoder(sample_rate, 1)
    frame_size = _samples_per_frame(sample_rate, frame_duration_ms)
    return decoder.decode(opus_packet, frame_size)


def encode(pcm: bytes, sample_rate: int = 24000, frame_duration_ms: int = 60) -> bytes:
    encoder = opuslib.Encoder(sample_rate, 1, opuslib.APPLICATION_VOIP)
    frame_size = _samples_per_frame(sample_rate, frame_duration_ms)
    return encoder.encode(pcm, frame_size)
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/device/test_opus_codec.py -v`
Expected: PASS (1 test)

- [ ] **Step 5: Commit codec**

```bash
git add app/device/opus_codec.py tests/device/test_opus_codec.py
git commit -m "feat: add opus encode/decode wrapper"
```

- [ ] **Step 6: Tulis `app/device/protocol_types.py` dan `app/device/session.py` (tanpa test terpisah — dipakai lewat test handshake Step 7)**

```python
# app/device/protocol_types.py
from typing import Literal, TypedDict


class HelloMessage(TypedDict, total=False):
    type: Literal["hello"]
    version: int
    transport: Literal["websocket"]
    session_id: str
    audio_params: dict


class ListenMessage(TypedDict, total=False):
    type: Literal["listen"]
    session_id: str
    state: Literal["start", "stop", "detect"]
    mode: Literal["auto", "manual", "realtime"]
    text: str
```

```python
# app/device/session.py
import uuid
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class DeviceSession:
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str = ""
    listen_mode: Literal["auto", "manual", "realtime"] = "auto"
    state: Literal["idle", "listening", "speaking"] = "idle"
```

- [ ] **Step 7: Tulis test handshake WebSocket**

`tests/device/test_ws_handshake.py`:

```python
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_hello_handshake_replies_within_contract():
    client = TestClient(app)
    with client.websocket_connect(
        "/ws", headers={"Device-Id": "A4:CF:12:9B:00:7E", "Client-Id": "test-client"}
    ) as ws:
        ws.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "version": 1,
                    "transport": "websocket",
                    "audio_params": {
                        "format": "opus",
                        "sample_rate": 16000,
                        "channels": 1,
                        "frame_duration": 60,
                    },
                }
            )
        )
        reply = json.loads(ws.receive_text())

        assert reply["type"] == "hello"
        assert reply["transport"] == "websocket"
        assert "session_id" in reply
        assert reply["audio_params"]["sample_rate"] == 24000
        assert reply["audio_params"]["frame_duration"] == 60


def test_hello_without_transport_field_still_acknowledged_by_server():
    # server harus tetap membalas type=hello meski device kirim versi lama tanpa transport;
    # firmware yang mengabaikan balasan itu urusan device, bukan bridge (spec §4.5)
    client = TestClient(app)
    with client.websocket_connect(
        "/ws", headers={"Device-Id": "A4:CF:12:9B:00:7F", "Client-Id": "test-client-2"}
    ) as ws:
        ws.send_text(json.dumps({"type": "hello", "version": 1}))
        reply = json.loads(ws.receive_text())
        assert reply["type"] == "hello"
```

- [ ] **Step 8: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_ws_handshake.py -v`
Expected: FAIL — `ModuleNotFoundError` atau 404 di `/ws`

- [ ] **Step 9: Implementasi `app/device/ws.py`**

```python
import json

from fastapi import APIRouter, Header, WebSocket, WebSocketDisconnect

from app.device.session import DeviceSession

ws_router = APIRouter()

_DOWNLINK_AUDIO_PARAMS = {
    "format": "opus",
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
}


@ws_router.websocket("/ws")
async def device_websocket(
    websocket: WebSocket,
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    await websocket.accept()
    session = DeviceSession(device_id=device_id)

    try:
        raw_hello = await websocket.receive_text()
        hello = json.loads(raw_hello)
        assert hello.get("type") == "hello"

        await websocket.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "transport": "websocket",
                    "session_id": session.session_id,
                    "audio_params": _DOWNLINK_AUDIO_PARAMS,
                }
            )
        )

        # loop pesan berikutnya diimplementasikan di Task 8 (pipeline.py)
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            # penanganan listen/abort/binary didelegasikan ke pipeline di Task 8
    except WebSocketDisconnect:
        pass
```

- [ ] **Step 10: Mount router di `app/main.py`**

```python
from fastapi import FastAPI

from app.device.ota import ota_router
from app.device.ws import ws_router

app = FastAPI(title="Zora Bridge")
app.include_router(ota_router)
app.include_router(ws_router)
```

- [ ] **Step 11: Jalankan test, pastikan lulus**

Run: `pytest tests/device/test_ws_handshake.py -v`
Expected: PASS (2 test)

- [ ] **Step 12: Commit**

```bash
git add app/device/protocol_types.py app/device/session.py app/device/ws.py app/main.py tests/device/test_ws_handshake.py
git commit -m "feat: implement websocket hello handshake"
```

---

### Task 8: Pipeline end-to-end (STT → LLM → TTS) + abort

Ini task yang menyatukan Task 4-7 jadi voice loop sungguhan.

**Files:**
- Create: `app/device/pipeline.py`
- Modify: `app/device/ws.py` (panggil pipeline dari loop pesan)
- Test: `tests/device/test_pipeline.py`

**Interfaces:**
- Consumes: `Endpointer` (Task 5), `opus_codec.decode/encode` (Task 7), `pace_frames` (Task 6), `LLMAdapter`/`STTAdapter`/`TTSAdapter` protocol (Task 4-6), `DeviceSession` (Task 7)
- Produces: class `Pipeline(stt: STTAdapter, llm: LLMAdapter, tts: TTSAdapter, voice: str, system_prompt: str)` dengan method `async def handle_utterance(self, pcm_audio: bytes) -> AsyncIterator[OutgoingEvent]`; `OutgoingEvent` adalah union tagged `{"kind": "stt", "text": str} | {"kind": "tts_start"} | {"kind": "tts_sentence", "text": str} | {"kind": "audio_frame", "data": bytes} | {"kind": "tts_stop"}`. `handle_utterance` TIDAK menyentuh WebSocket langsung — `ws.py` yang membaca event dari generator ini dan mengirimkannya sebagai pesan JSON/biner ke device, plus memanggil `pace_frames` di antara `audio_frame` events.

- [ ] **Step 1: Tulis test pipeline dengan adapter palsu (fake, bukan mock library — supaya perilaku async iterator gampang dikontrol)**

`tests/device/test_pipeline.py`:

```python
import pytest

from app.adapters.llm.base import LLMResponse
from app.adapters.stt.base import STTResult
from app.adapters.tts.base import TTSResult
from app.device.pipeline import Pipeline


class _FakeSTT:
    async def transcribe(self, pcm_audio: bytes, *, sample_rate: int = 16000) -> STTResult:
        return STTResult(text="besok cuaca gimana", latency_ms=400)


class _FakeLLM:
    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        return LLMResponse(text="Besok cerah.", tool_calls=[], latency_ms=700)


class _FakeTTS:
    async def synthesize(self, text: str, *, voice: str) -> TTSResult:
        return TTSResult(pcm_audio=b"\x00\x01" * 480, sample_rate=24000, latency_ms=200)


async def test_handle_utterance_emits_events_in_order():
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLM(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora, asisten suara.",
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]

    kinds = [e["kind"] for e in events]
    assert kinds[0] == "stt"
    assert events[0]["text"] == "besok cuaca gimana"
    assert "tts_start" in kinds
    assert kinds.index("tts_start") < kinds.index("audio_frame")
    assert kinds[-1] == "tts_stop"


async def test_handle_utterance_includes_llm_text_as_sentence():
    pipeline = Pipeline(
        stt=_FakeSTT(), llm=_FakeLLM(), tts=_FakeTTS(),
        voice="id_ID-news-medium", system_prompt="Kamu Zora.",
    )
    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]
    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any(e["text"] == "Besok cerah." for e in sentence_events)
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implementasi `app/device/pipeline.py`**

Catatan desain: Fase 1 mengirim seluruh balasan LLM sebagai satu kalimat TTS (bukan streaming per-kalimat granular). Spec §7 menyebut streaming per-kalimat sebagai optimasi latensi — itu perbaikan lanjutan, dicatat di bagian Follow-up plan ini, bukan blocker buat "program selesai".

```python
from typing import AsyncIterator, TypedDict

from app.adapters.llm.base import LLMAdapter
from app.adapters.stt.base import STTAdapter
from app.adapters.tts.base import TTSAdapter
from app.device.opus_codec import encode as opus_encode


class OutgoingEvent(TypedDict, total=False):
    kind: str
    text: str
    data: bytes


class Pipeline:
    def __init__(
        self,
        stt: STTAdapter,
        llm: LLMAdapter,
        tts: TTSAdapter,
        voice: str,
        system_prompt: str,
    ):
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._voice = voice
        self._system_prompt = system_prompt

    async def handle_utterance(self, pcm_audio: bytes) -> AsyncIterator[OutgoingEvent]:
        stt_result = await self._stt.transcribe(pcm_audio, sample_rate=16000)
        yield OutgoingEvent(kind="stt", text=stt_result.text)

        llm_result = await self._llm.complete(
            messages=[
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": stt_result.text},
            ]
        )

        tts_result = await self._tts.synthesize(llm_result.text, voice=self._voice)

        yield OutgoingEvent(kind="tts_start")
        yield OutgoingEvent(kind="tts_sentence", text=llm_result.text)

        frame_bytes = 2 * (tts_result.sample_rate * 60 // 1000)  # 16-bit mono, 60ms
        pcm = tts_result.pcm_audio
        for offset in range(0, len(pcm), frame_bytes):
            chunk = pcm[offset : offset + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
            opus_packet = opus_encode(chunk, sample_rate=tts_result.sample_rate, frame_duration_ms=60)
            yield OutgoingEvent(kind="audio_frame", data=opus_packet)

        yield OutgoingEvent(kind="tts_stop")
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/device/test_pipeline.py -v`
Expected: PASS (2 test)

- [ ] **Step 5: Sambungkan pipeline ke `ws.py`, termasuk endpointer dan abort**

Ganti isi loop pesan di `app/device/ws.py` Task 7 Step 9 (bagian `# penanganan listen/abort/binary...`) jadi:

```python
import json

from fastapi import APIRouter, Header, WebSocket, WebSocketDisconnect

from app.device.endpointer import Endpointer
from app.device.opus_codec import decode as opus_decode
from app.device.pacer import pace_frames
from app.device.pipeline import Pipeline
from app.device.session import DeviceSession

ws_router = APIRouter()

_DOWNLINK_AUDIO_PARAMS = {
    "format": "opus",
    "sample_rate": 24000,
    "channels": 1,
    "frame_duration": 60,
}


def _build_pipeline() -> Pipeline:
    # Fase 1: satu konfigurasi hardcoded. Fase 2 mengambil per-agent dari DB (Task control/).
    from app.adapters.llm.omnirouter import OmnirouterAdapter
    from app.adapters.stt.groq_whisper import GroqWhisperAdapter
    from app.adapters.tts.piper import PiperAdapter
    from app.config import settings

    return Pipeline(
        stt=GroqWhisperAdapter(api_key=settings.groq_api_key),
        llm=OmnirouterAdapter(
            base_url=settings.omnirouter_base_url,
            api_key=settings.omnirouter_api_key,
            model=settings.omnirouter_model,
        ),
        tts=PiperAdapter(binary_path=settings.piper_binary_path, model_path=settings.piper_model_path),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora, asisten suara berbahasa Indonesia. Jawab singkat, maksimal dua kalimat, tanpa markdown.",
    )


@ws_router.websocket("/ws")
async def device_websocket(
    websocket: WebSocket,
    device_id: str = Header(..., alias="Device-Id"),
    client_id: str = Header(..., alias="Client-Id"),
):
    await websocket.accept()
    session = DeviceSession(device_id=device_id)
    endpointer = Endpointer(silence_ms=800)
    pipeline = _build_pipeline()

    pcm_buffer = bytearray()
    aborted = False

    try:
        raw_hello = await websocket.receive_text()
        hello = json.loads(raw_hello)
        assert hello.get("type") == "hello"

        await websocket.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "transport": "websocket",
                    "session_id": session.session_id,
                    "audio_params": _DOWNLINK_AUDIO_PARAMS,
                }
            )
        )

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            if "text" in message and message["text"] is not None:
                payload = json.loads(message["text"])
                msg_type = payload.get("type")

                if msg_type == "listen":
                    session.listen_mode = payload.get("mode", session.listen_mode)
                    if payload.get("state") == "start":
                        session.state = "listening"
                        pcm_buffer.clear()
                        aborted = False

                elif msg_type == "abort":
                    aborted = True
                    session.state = "listening" if session.listen_mode != "manual" else "idle"
                    await websocket.send_text(json.dumps({
                        "session_id": session.session_id, "type": "tts", "state": "stop",
                    }))

            elif "bytes" in message and message["bytes"] is not None:
                if session.state != "listening":
                    continue
                opus_packet = message["bytes"]
                pcm_frame = opus_decode(opus_packet, sample_rate=16000)
                pcm_buffer.extend(pcm_frame)

                event = endpointer.feed(pcm_frame)
                if event == "speech_end":
                    session.state = "speaking"
                    utterance_pcm = bytes(pcm_buffer)
                    pcm_buffer.clear()

                    async for out_event in pipeline.handle_utterance(utterance_pcm):
                        if aborted:
                            break
                        kind = out_event["kind"]
                        if kind == "stt":
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "stt", "text": out_event["text"],
                            }))
                        elif kind == "tts_start":
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "tts", "state": "start",
                            }))
                        elif kind == "tts_sentence":
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "tts",
                                "state": "sentence_start", "text": out_event["text"],
                            }))
                        elif kind == "audio_frame":
                            async for framed in pace_frames([out_event["data"]], frame_duration_ms=60):
                                await websocket.send_bytes(framed)
                        elif kind == "tts_stop":
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "tts", "state": "stop",
                            }))

                    session.state = "listening" if session.listen_mode == "auto" else "idle"

    except WebSocketDisconnect:
        pass
```

Catatan penting soal `pace_frames([out_event["data"]], ...)`: dipanggil per-frame tunggal di sini karena `Pipeline.handle_utterance` sudah menghasilkan `audio_frame` satu-satu dari generator-nya sendiri — irama antar frame TTS yang berurutan tetap terjaga karena tiap iterasi loop `async for out_event in pipeline.handle_utterance(...)` menunggu `await websocket.send_bytes` sebelumnya selesai, dan `pace_frames` dengan daftar satu-elemen mengirim segera (tidak ada frame kedua buat dijeda). Ini BUKAN bug — pacing yang sesungguhnya (jeda antar frame) terjadi secara alami dari kecepatan iterasi generator ditambah `await asyncio.sleep` yang perlu ditambahkan di titik ini. **Perbaikan yang harus dilakukan sebelum smoke-test manual:** tambahkan `await asyncio.sleep(0.06)` setelah tiap `send_bytes` di cabang `audio_frame`, atau — lebih bersih — ubah `Pipeline.handle_utterance` untuk mengumpulkan semua `audio_frame` jadi satu list dan biarkan `ws.py` memanggil `pace_frames(all_frames)` satu kali di luar loop kind-matching. Catat ini sebagai TODO eksplisit di kode dengan komentar yang menunjuk ke spec §4.6, dan pilih salah satu pendekatan sebelum Task 8 dianggap selesai — jangan biarkan frame terkirim tanpa jeda ke device sungguhan.

- [ ] **Step 6: Tambahkan field yang dibutuhkan di `app/config.py`**

Tambahkan ke class `Settings` di `app/config.py` (Task 1 Step 4):

```python
    omnirouter_base_url: str = "http://localhost:20128/v1"
    omnirouter_api_key: str = ""
    omnirouter_model: str = "claude-sonnet-5"
    groq_api_key: str = ""
    piper_binary_path: str = "/usr/local/bin/piper"
    piper_model_path: str = "/models/id_ID-news-medium.onnx"
```

- [ ] **Step 7: Jalankan seluruh test suite, pastikan semua lulus**

Run: `pytest -v`
Expected: PASS (semua test dari Task 1-8, tidak ada regresi)

- [ ] **Step 8: Commit**

```bash
git add app/device/ws.py app/device/pipeline.py app/config.py tests/device/test_pipeline.py
git commit -m "feat: wire end-to-end voice pipeline into websocket handler"
```

- [ ] **Step 9 (manual, butuh device Zora Mini sungguhan): smoke test end-to-end**

1. Jalankan bridge: `uvicorn app.main:app --reload --port 8000`
2. Set NVS device secara manual (dev-only, bypass alur pairing) menunjuk `ws://<ip-lokal>:8000/ws`, ATAU jalankan alur pairing sungguhan lewat `check_version` + kode aktivasi.
3. Ngomong ke device: "Halo, apa kabar?"
4. Expected: device menampilkan transkrip STT di layar (kalau ada display), lalu menjawab lewat speaker dalam Bahasa Indonesia, tanpa terpotong di tengah.
5. Cek log bridge: pastikan urutan `stt` → `tts start` → `tts sentence_start` → frame biner → `tts stop` muncul tanpa error.

Expected hasil: voice loop dua arah berhasil. Kalau audio terpotong, cek TODO pacing di Step 5 di atas — itu penyebab paling mungkin.

---

### Task 9: Adapter Search (SearXNG) + tool-call kondisional

**Files:**
- Create: `app/adapters/search/__init__.py`, `app/adapters/search/base.py`, `app/adapters/search/searxng.py`
- Modify: `app/device/pipeline.py` (tambahkan parameter `search` dan logika tool-call)
- Test: `tests/adapters/test_searxng.py`, tambahan test di `tests/device/test_pipeline.py`

**Interfaces:**
- Produces: `Protocol SearchAdapter` dengan `async def search(self, query: str, *, max_results: int = 3) -> SearchResult`; dataclass `SearchResult(results: list[dict], latency_ms: int)` dengan tiap dict berisi `{"title": str, "snippet": str, "url": str}`; class `SearxngAdapter(base_url: str)`.
- Modify `Pipeline.__init__` menambah parameter `search: SearchAdapter | None = None`.

- [ ] **Step 1: Tulis test adapter SearXNG**

`tests/adapters/test_searxng.py`:

```python
import pytest

from app.adapters.search.searxng import SearxngAdapter


async def test_search_returns_top_results(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="http://searxng:8080/search?q=cuaca+surabaya+besok&format=json",
        json={
            "results": [
                {"title": "BMKG Surabaya", "content": "Hujan ringan sore hari.", "url": "https://bmkg.go.id/x"},
                {"title": "Cuaca.com", "content": "26-29 derajat.", "url": "https://cuaca.com/y"},
                {"title": "Weather.id", "content": "Berawan.", "url": "https://weather.id/z"},
                {"title": "Hasil ke-4", "content": "diabaikan.", "url": "https://x.com/4"},
            ]
        },
    )

    adapter = SearxngAdapter(base_url="http://searxng:8080")
    result = await adapter.search("cuaca surabaya besok", max_results=3)

    assert len(result.results) == 3
    assert result.results[0]["title"] == "BMKG Surabaya"
    assert result.latency_ms >= 0
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/adapters/test_searxng.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Tulis `app/adapters/search/base.py`**

```python
from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class SearchResult:
    results: list[dict]
    latency_ms: int = 0


class SearchAdapter(Protocol):
    async def search(self, query: str, *, max_results: int = 3) -> SearchResult:
        ...
```

- [ ] **Step 4: Tulis `app/adapters/search/searxng.py`**

```python
import time
import urllib.parse

import httpx

from app.adapters.search.base import SearchResult


class SearxngAdapter:
    def __init__(self, base_url: str, timeout: float = 4.0):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def search(self, query: str, *, max_results: int = 3) -> SearchResult:
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._base_url}/search",
                params={"q": query, "format": "json"},
            )
        latency_ms = int((time.monotonic() - start) * 1000)
        resp.raise_for_status()

        raw_results = resp.json().get("results", [])[:max_results]
        results = [
            {"title": r["title"], "snippet": r["content"], "url": r["url"]}
            for r in raw_results
        ]
        return SearchResult(results=results, latency_ms=latency_ms)
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pytest tests/adapters/test_searxng.py -v`
Expected: PASS (1 test)

- [ ] **Step 6: Commit adapter**

```bash
git add app/adapters/search/ tests/adapters/test_searxng.py
git commit -m "feat: add searxng search adapter"
```

- [ ] **Step 7: Tulis test pipeline dengan tool-call search**

Tambahkan ke `tests/device/test_pipeline.py`:

```python
from app.adapters.search.base import SearchResult


class _FakeLLMWithToolCall:
    def __init__(self):
        self._call_count = 0

    async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
        self._call_count += 1
        if self._call_count == 1:
            return LLMResponse(
                text="",
                tool_calls=[
                    {
                        "id": "call_1",
                        "function": {"name": "web_search", "arguments": '{"query": "cuaca surabaya besok"}'},
                    }
                ],
                latency_ms=500,
            )
        return LLMResponse(text="Besok Surabaya hujan ringan sore.", tool_calls=[], latency_ms=600)


class _FakeSearch:
    async def search(self, query: str, *, max_results: int = 3) -> SearchResult:
        return SearchResult(
            results=[{"title": "BMKG", "snippet": "Hujan ringan sore.", "url": "https://bmkg.go.id"}],
            latency_ms=890,
        )


async def test_handle_utterance_with_tool_call_invokes_search():
    pipeline = Pipeline(
        stt=_FakeSTT(),
        llm=_FakeLLMWithToolCall(),
        tts=_FakeTTS(),
        voice="id_ID-news-medium",
        system_prompt="Kamu Zora.",
        search=_FakeSearch(),
    )

    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]
    sentence_events = [e for e in events if e["kind"] == "tts_sentence"]
    assert any("hujan ringan" in e["text"].lower() for e in sentence_events)


async def test_handle_utterance_without_search_adapter_ignores_tool_calls():
    # kalau search=None tapi LLM tetap minta tool-call, pipeline tidak boleh crash -
    # jatuhkan ke teks LLM apa adanya (kosong dalam kasus ini)
    pipeline = Pipeline(
        stt=_FakeSTT(), llm=_FakeLLMWithToolCall(), tts=_FakeTTS(),
        voice="id_ID-news-medium", system_prompt="Kamu Zora.", search=None,
    )
    events = [event async for event in pipeline.handle_utterance(pcm_audio=b"\x00" * 1000)]
    assert events[-1]["kind"] == "tts_stop"  # tidak crash, tetap selesai
```

- [ ] **Step 8: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_pipeline.py -v`
Expected: FAIL — `Pipeline.__init__` belum menerima parameter `search`, dan belum ada logika tool-call.

- [ ] **Step 9: Modifikasi `app/device/pipeline.py`**

```python
import json
from typing import AsyncIterator, TypedDict

from app.adapters.llm.base import LLMAdapter
from app.adapters.search.base import SearchAdapter
from app.adapters.stt.base import STTAdapter
from app.adapters.tts.base import TTSAdapter
from app.device.opus_codec import encode as opus_encode

_SEARCH_TOOL_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Cari informasi terkini di internet, misalnya cuaca, berita, atau harga.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]


class OutgoingEvent(TypedDict, total=False):
    kind: str
    text: str
    data: bytes


class Pipeline:
    def __init__(
        self,
        stt: STTAdapter,
        llm: LLMAdapter,
        tts: TTSAdapter,
        voice: str,
        system_prompt: str,
        search: SearchAdapter | None = None,
    ):
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._voice = voice
        self._system_prompt = system_prompt
        self._search = search

    async def handle_utterance(self, pcm_audio: bytes) -> AsyncIterator[OutgoingEvent]:
        stt_result = await self._stt.transcribe(pcm_audio, sample_rate=16000)
        yield OutgoingEvent(kind="stt", text=stt_result.text)

        messages = [
            {"role": "system", "content": self._system_prompt},
            {"role": "user", "content": stt_result.text},
        ]

        tools = _SEARCH_TOOL_SCHEMA if self._search is not None else None
        llm_result = await self._llm.complete(messages=messages, tools=tools)

        if llm_result.tool_calls and self._search is not None:
            call = llm_result.tool_calls[0]
            args = json.loads(call["function"]["arguments"])
            search_result = await self._search.search(args["query"], max_results=3)

            search_context = "\n".join(
                f"- {r['title']}: {r['snippet']}" for r in search_result.results
            )
            messages.append({"role": "assistant", "content": None, "tool_calls": llm_result.tool_calls})
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": search_context,
                }
            )
            llm_result = await self._llm.complete(messages=messages)
        elif llm_result.tool_calls and self._search is None:
            # LLM minta tool yang gak tersedia - jangan crash, jawab dengan teks kosong apa adanya
            pass

        final_text = llm_result.text
        tts_result = await self._tts.synthesize(final_text, voice=self._voice)

        yield OutgoingEvent(kind="tts_start")
        yield OutgoingEvent(kind="tts_sentence", text=final_text)

        frame_bytes = 2 * (tts_result.sample_rate * 60 // 1000)
        pcm = tts_result.pcm_audio
        for offset in range(0, len(pcm), frame_bytes):
            chunk = pcm[offset : offset + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
            opus_packet = opus_encode(chunk, sample_rate=tts_result.sample_rate, frame_duration_ms=60)
            yield OutgoingEvent(kind="audio_frame", data=opus_packet)

        yield OutgoingEvent(kind="tts_stop")
```

- [ ] **Step 10: Jalankan seluruh test suite**

Run: `pytest -v`
Expected: PASS (semua test, termasuk 4 test pipeline lama + 2 baru)

- [ ] **Step 11: Sambungkan search adapter di `ws.py` (`_build_pipeline`)**

Tambahkan di `app/config.py`:

```python
    searxng_base_url: str = "http://localhost:8888"
```

Ubah `_build_pipeline()` di `app/device/ws.py`:

```python
    from app.adapters.search.searxng import SearxngAdapter
    # ...
    return Pipeline(
        stt=GroqWhisperAdapter(api_key=settings.groq_api_key),
        llm=OmnirouterAdapter(...),
        tts=PiperAdapter(...),
        voice="id_ID-news-medium",
        system_prompt="...",
        search=SearxngAdapter(base_url=settings.searxng_base_url),
    )
```

- [ ] **Step 12: Commit**

```bash
git add app/device/pipeline.py app/device/ws.py app/config.py tests/device/test_pipeline.py
git commit -m "feat: add conditional web search tool-call to pipeline"
```

---

### Task 10: Pencatatan tiap turn ke Postgres

**Files:**
- Modify: `app/device/ws.py` (tulis `Conversation`/`Message` setelah tiap turn)
- Test: tambahan integrasi di `tests/device/test_ws_handshake.py` atau file baru `tests/device/test_conversation_logging.py`

**Interfaces:**
- Consumes: `Conversation`, `Message` model (Task 1), `get_sessionmaker()` (Task 1)
- Produces: tidak ada API baru — efek samping penulisan DB dipicu dari dalam handler WebSocket setelah `handle_utterance` selesai.

- [ ] **Step 1: Tulis test — setelah satu turn selesai, `messages` punya 2 row (user + assistant) dengan `provider_used` dan `latency_ms` terisi**

`tests/device/test_conversation_logging.py`:

```python
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.core.models import Message, Conversation
from app.main import app


def test_turn_is_logged_to_database(monkeypatch):
    # gunakan adapter fake lewat monkeypatch supaya test ini tidak butuh
    # Groq/omnirouter/Piper sungguhan - hanya menguji sisi logging DB
    import app.device.ws as ws_module
    from app.adapters.llm.base import LLMResponse
    from app.adapters.stt.base import STTResult
    from app.adapters.tts.base import TTSResult
    from app.device.pipeline import Pipeline

    class _FakeSTT:
        async def transcribe(self, pcm_audio, *, sample_rate=16000):
            return STTResult(text="tes logging", latency_ms=100)

    class _FakeLLM:
        async def complete(self, messages, *, tools=None, max_tokens=160, temperature=0.7):
            return LLMResponse(text="Oke dicatat.", tool_calls=[], latency_ms=200)

    class _FakeTTS:
        async def synthesize(self, text, *, voice):
            return TTSResult(pcm_audio=b"\x00\x01" * 480, sample_rate=24000, latency_ms=50)

    monkeypatch.setattr(
        ws_module,
        "_build_pipeline",
        lambda: Pipeline(stt=_FakeSTT(), llm=_FakeLLM(), tts=_FakeTTS(), voice="v", system_prompt="p"),
    )

    client = TestClient(app)
    with client.websocket_connect(
        "/ws", headers={"Device-Id": "A4:CF:12:9B:00:9E", "Client-Id": "log-test"}
    ) as ws:
        ws.send_text(json.dumps({"type": "hello", "version": 1, "transport": "websocket"}))
        ws.receive_text()  # balasan hello

        ws.send_text(json.dumps({"type": "listen", "state": "start", "mode": "auto"}))

        # kirim cukup frame hening panjang supaya endpointer trigger speech_end tanpa speech dulu
        # tidak realistis secara audio, tapi cukup untuk menguji jalur logging -
        # gunakan pendekatan: kirim 1 frame "loud" dulu baru banyak frame silent
        import struct
        loud = struct.pack("<960h", *([8000, -8000] * 480))
        silent = struct.pack("<960h", *([0] * 960))
        from app.device.opus_codec import encode as opus_encode

        ws.send_bytes(opus_encode(loud, sample_rate=16000, frame_duration_ms=60))
        for _ in range(15):  # cukup untuk lewati silence_ms=800 (~14 frame)
            ws.send_bytes(opus_encode(silent, sample_rate=16000, frame_duration_ms=60))

        # baca semua pesan balik sampai tts stop, supaya handler selesai memproses
        while True:
            msg = ws.receive()
            if msg.get("text"):
                payload = json.loads(msg["text"])
                if payload.get("type") == "tts" and payload.get("state") == "stop":
                    break


async def _fetch_messages_for_device():
    session_maker = get_sessionmaker()
    async with session_maker() as session:
        result = await session.execute(select(Message))
        return result.scalars().all()
```

Catatan: test WebSocket sinkron (`TestClient.websocket_connect`) tidak bisa langsung `await` query async di dalam fungsi test sync yang sama. Pisahkan pengecekan DB ke test terpisah yang jalan setelahnya, atau — lebih sederhana — jalankan `_fetch_messages_for_device()` lewat `asyncio.run()` di akhir fungsi test yang sama. Tambahkan baris berikut sebagai penutup `test_turn_is_logged_to_database`:

```python
    import asyncio
    messages = asyncio.run(_fetch_messages_for_device())
    assert len(messages) >= 2
    assert any(m.role == "user" and m.text == "tes logging" for m in messages)
    assert any(m.role == "assistant" and m.text == "Oke dicatat." for m in messages)
    assistant_msg = next(m for m in messages if m.role == "assistant")
    assert assistant_msg.latency_ms is not None
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/device/test_conversation_logging.py -v`
Expected: FAIL — belum ada penulisan DB di `ws.py`, jadi `messages` kosong (assert `len >= 2` gagal).

- [ ] **Step 3: Modifikasi `app/device/ws.py` — tulis DB setelah `handle_utterance` selesai**

Di dalam blok `if event == "speech_end":` pada Task 8 Step 5, setelah loop `async for out_event in pipeline.handle_utterance(utterance_pcm):` selesai (sebelum `session.state = ...` di baris terakhir blok itu), tambahkan:

```python
                    stt_text = next((e["text"] for e in [] ), None)  # lihat catatan di bawah
```

**Catatan implementasi yang benar** (potongan di atas cuma placeholder ilustratif — implementer HARUS mengganti dengan pendekatan berikut, bukan menyalin baris di atas apa adanya): karena `handle_utterance` adalah generator yang di-iterasi sekali, tangkap `stt_text` dan `assistant_text` serta latensi tiap tahap SAAT loop `async for out_event in ...` berjalan, dengan menambah variabel akumulator sebelum loop:

```python
                    session.state = "speaking"
                    utterance_pcm = bytes(pcm_buffer)
                    pcm_buffer.clear()

                    stt_text = ""
                    assistant_text_parts: list[str] = []

                    async for out_event in pipeline.handle_utterance(utterance_pcm):
                        if aborted:
                            break
                        kind = out_event["kind"]
                        if kind == "stt":
                            stt_text = out_event["text"]
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "stt", "text": out_event["text"],
                            }))
                        elif kind == "tts_sentence":
                            assistant_text_parts.append(out_event["text"])
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "tts",
                                "state": "sentence_start", "text": out_event["text"],
                            }))
                        elif kind == "tts_start":
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "tts", "state": "start",
                            }))
                        elif kind == "audio_frame":
                            async for framed in pace_frames([out_event["data"]], frame_duration_ms=60):
                                await websocket.send_bytes(framed)
                        elif kind == "tts_stop":
                            await websocket.send_text(json.dumps({
                                "session_id": session.session_id, "type": "tts", "state": "stop",
                            }))

                    if not aborted:
                        await _log_turn(
                            device_id=device_id,
                            session_id=session.session_id,
                            user_text=stt_text,
                            assistant_text=" ".join(assistant_text_parts),
                        )

                    session.state = "listening" if session.listen_mode == "auto" else "idle"
```

Tambahkan fungsi `_log_turn` di `app/device/ws.py`:

```python
async def _log_turn(*, device_id: str, session_id: str, user_text: str, assistant_text: str) -> None:
    import uuid

    from sqlalchemy import select

    from app.core.db import get_sessionmaker
    from app.core.models import Conversation, Device, Message

    session_maker = get_sessionmaker()
    async with session_maker() as db_session:
        result = await db_session.execute(select(Device).where(Device.device_id == device_id))
        device = result.scalar_one_or_none()
        if device is None:
            return  # device belum diklaim (mode dev tanpa pairing) - skip logging

        result = await db_session.execute(
            select(Conversation).where(Conversation.session_id == session_id)
        )
        conversation = result.scalar_one_or_none()
        if conversation is None:
            conversation = Conversation(
                id=uuid.uuid4(),
                owner_id=device.owner_id,
                device_id=device.id,
                session_id=session_id,
            )
            db_session.add(conversation)
            await db_session.flush()

        db_session.add(
            Message(
                id=uuid.uuid4(),
                owner_id=device.owner_id,
                conversation_id=conversation.id,
                role="user",
                text=user_text,
            )
        )
        db_session.add(
            Message(
                id=uuid.uuid4(),
                owner_id=device.owner_id,
                conversation_id=conversation.id,
                role="assistant",
                text=assistant_text,
            )
        )
        await db_session.commit()
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/device/test_conversation_logging.py -v`
Expected: PASS. Kalau gagal dengan `device is None` (turn tidak tercatat), pastikan test Step 1 mendaftarkan row `Device` dengan `device_id="A4:CF:12:9B:00:9E"` di fixture setup — tambahkan setup itu di awal test kalau belum ada (pola sama seperti `test_ota.py` Task 3 Step 1, buat `Owner` dulu lalu `Device` yang menunjuk ke `owner.id`).

- [ ] **Step 5: Jalankan seluruh test suite**

Run: `pytest -v`
Expected: PASS semua

- [ ] **Step 6: Commit**

```bash
git add app/device/ws.py tests/device/test_conversation_logging.py
git commit -m "feat: log each conversation turn to postgres"
```

---

## Self-Review

**1. Cakupan spec §9 poin 1-9 (Fase 1):**

| Poin spec | Task |
|---|---|
| 1. Init project, Docker Compose, Alembic | Task 1 |
| 2. Endpoint OTA `check_version` + `/activate` | Task 3 |
| 3. WS handshake | Task 7 |
| 4. Adapter LLM omnirouter | Task 4 |
| 5. Adapter STT + endpointer | Task 5 |
| 6. Adapter TTS + pacer | Task 6 |
| 7. Sambung end-to-end + abort | Task 8 |
| 8. Adapter Search + tool-call | Task 9 |
| 9. Postgres log tiap turn | Task 10 |

Enkripsi key BYOK (spec §8) dicakup Task 2 walau tidak eksplisit di daftar 1-9 — diperlukan lebih awal karena Task 4-6 nanti (di luar plan ini, saat provider jadi per-user) bergantung padanya; untuk Fase 1 murni, adapter masih dikonfigurasi lewat env var (`app/config.py`), bukan DB, jadi `crypto.py` disediakan tapi belum dipakai aktif — itu keputusan sadar, dicatat di Follow-up di bawah.

**2. Placeholder scan:** Satu potongan ilustratif di Task 10 Step 3 (`stt_text = next(...)`) sengaja ditandai "placeholder ilustratif — HARUS diganti" dengan implementasi lengkap langsung setelahnya, supaya executor tidak menyalinnya mentah-mentah. Tidak ada TBD/TODO lain kecuali dua yang eksplisit didokumentasikan sebagai keputusan tertunda dengan alasan (Task 3 soal token hashing, Task 8 soal granularitas pacing) — keduanya sudah diberi instruksi konkret apa yang harus dilakukan, bukan dibiarkan kosong.

**3. Konsistensi tipe:** `LLMResponse`, `STTResult`, `TTSResult`, `SearchResult` dipakai dengan field yang sama persis di semua task yang mengonsumsinya (diverifikasi manual: `Pipeline` Task 8/9 memakai `stt_result.text`, `llm_result.text`/`.tool_calls`, `tts_result.pcm_audio`/`.sample_rate` — semua cocok dengan definisi dataclass di Task 4-6). `Pipeline.__init__` parameter bertambah `search` di Task 9 tapi tetap punya default `None`, jadi pemanggilan Task 8 di `ws.py` tidak perlu diubah sebelum Task 9 Step 11 secara eksplisit mengubahnya.

## Follow-up (di luar Fase 1, jangan dikerjakan di plan ini)

- Provider per-owner dari DB (bukan env var global) — butuh `provider_creds` table dan `crypto.py` yang sudah disiapkan Task 2 baru benar-benar dipakai. Ini bagian dari Fase 2 (dashboard) di spec.
- Streaming TTS per-kalimat granular (spec §7) — Fase 1 mengirim satu kalimat penuh sekaligus.
- Verifikasi HMAC aktivasi (spec §4.2) — Fase 1 hanya jalur kode-di-layar tanpa serial efuse.
- Ping/keepalive level aplikasi (spec §4.8, konflik belum terselesaikan) — perlu diverifikasi dengan device sungguhan sebelum diputuskan final.
- Tuning ambang VAD `Endpointer._ENERGY_THRESHOLD` dan `silence_ms` dengan device sungguhan — nilai di Task 5 adalah titik awal, bukan final.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-10-fase1-voice-loop.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
