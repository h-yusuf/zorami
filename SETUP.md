# Setup — Zora Bridge

Panduan jalanin project ini dari nol. Ada dua cara: **Docker (paling gampang, buat testing/coba dashboard)** atau **dev lokal (buat ngoding, hot-reload)**.

Status saat ini: Fase 1 (voice loop) + Fase 2 (dashboard) selesai dan teruji. Fase 3 (multi-user/RBAC) belum ada — sistem jalan dengan **satu akun** yang kamu buat manual.

---

## 1. Prasyarat

- Docker + Docker Compose (buat cara Docker)
- `uv` (buat cara dev lokal) — https://docs.astral.sh/uv/
- Node.js 20+ (cuma kalau mau ngoding frontend di luar Docker)

---

## 2. Isi `.env`

```bash
cp .env.example .env
```

Isi tiap field — semua provider ini **BYOK** (token/key milikmu sendiri), gak ada yang di-hardcode di kode:

| Variable | Wajib? | Keterangan |
|---|---|---|
| `ZORA_SECRET_KEY` | Ya | Kunci enkripsi provider secrets (Fernet). Ganti dari default kalau bukan dev lokal. |
| `ZORA_JWT_SECRET` | Ya | Kunci JWT dashboard. Ganti dari default kalau bukan dev lokal. |
| `ZORA_OMNIROUTER_BASE_URL` / `_API_KEY` / `_MODEL` | Ya (buat voice loop) | LLM, OpenAI-compatible. |
| `ZORA_GROQ_API_KEY` | Ya (buat voice loop) | STT. Ambil di console.groq.com → **API Keys** (bukan halaman docs). |
| `ZORA_PIPER_BINARY_PATH` / `_MODEL_PATH` | Ya (buat voice loop) | TTS lokal, gratis. Lihat langkah 3 buat cara pasang. |
| `ZORA_LANGSEARCH_API_KEY` | Opsional | Websearch. Tanpa ini, LLM tetap jalan, cuma gak bisa nge-search info terkini. |

Tanpa provider di atas diisi, **server tetap nyala** — cuma turn voice loop yang gagal (device diminta coba lagi, koneksi gak putus). Dashboard dan API tetap bisa dites.

---

## 3. Pasang Piper (TTS lokal, sekali aja)

Sudah jadi dependency project (`piper-tts` di `pyproject.toml`), tinggal download model suaranya:

```bash
uv sync
mkdir -p models
uv run python -m piper.download_voices --download-dir models id_ID-news_tts-medium
```

Ini satu-satunya voice Bahasa Indonesia yang tersedia di Piper saat ini (~60MB, sengaja di-gitignore).

Set di `.env` (dev lokal, path absolut ke folder project ini):

```bash
ZORA_PIPER_BINARY_PATH=/path/ke/project/.venv/bin/piper
ZORA_PIPER_MODEL_PATH=/path/ke/project/models/id_ID-news_tts-medium.onnx
```

Tes cepat tanpa jalanin server:

```bash
echo "Halo, apa kabar?" | uv run piper -m models/id_ID-news_tts-medium.onnx -f /tmp/test.wav
afplay /tmp/test.wav   # macOS. Linux: aplay /tmp/test.wav
```

---

## 4A. Jalanin lewat Docker (paling gampang)

```bash
docker compose --profile app up -d --build
```

Ini jalanin **Postgres + App** dalam satu jaringan compose. `.env` tetap dipakai (lewat `env_file`), tapi `docker-compose.yml` meng-override beberapa value yang beda di dalam container (host Postgres jadi `postgres` bukan `localhost`, path Piper jadi `/app/.venv/bin/piper` dan `/app/models/...` — bukan path host kamu).

Tunggu sampai `docker compose ps` nunjukin `app` status `Up`, lalu buka **http://localhost:8000** — itu dashboard React-nya. Endpoint API di **http://localhost:8000/api/***.

**Migrasi database**: image sudah include kode terbaru, tapi migrasi Alembic **tidak otomatis jalan** saat container start. Jalankan sekali dari host (asal `ZORA_DATABASE_URL` di `.env` masih nunjuk ke `localhost:5432`, bukan yang di-override compose):

```bash
uv run alembic upgrade head
```

Perintah harian:

```bash
docker compose --profile app logs -f app      # lihat log
docker compose --profile app up -d --build    # rebuild abis ganti kode
docker compose --profile app down             # matiin app (postgres ikut mati juga kalau gak dipisah profile-nya)
```

---

## 4B. Jalanin dev lokal (buat ngoding, hot-reload)

```bash
docker compose up -d postgres     # cukup Postgres di Docker
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000    # backend

cd frontend
npm install
npm run dev                        # frontend, port 5173, proxy /api dan /ws ke :8000
```

Buka **http://localhost:5173** buat dashboard (hot-reload). Backend API tetap di **http://localhost:8000**.

Jalankan test suite backend:

```bash
uv run pytest -v
```

**Penting**: test suite otomatis pakai database terpisah (`<nama_db_di_env>_test`, contoh `zora_bridge_test`), dibuat otomatis kalau belum ada — **bukan** database yang sama dengan yang kamu pakai buat dev/Docker manual (`zora_bridge`). Ini sengaja: tiap test menghapus semua baris tabel domain (`_clean_db` di `tests/conftest.py`) supaya state selalu bersih, dan sebelum ada pemisahan ini, menjalankan `pytest` ikut menghapus data yang di-seed manual di dashboard. Data hasil klik-klik manual di dashboard/Docker kamu **aman** dari `pytest` sekarang, gak peduli berapa kali dijalankan.

---

## 5. Bikin akun buat login dashboard

Belum ada halaman/endpoint registrasi (itu bagian Fase 3). Buat satu akun manual lewat Python — jalankan dari host (dev lokal) atau `docker exec` ke container `app` (Docker):

**Dev lokal:**
```bash
uv run python3 -c "
import asyncio, uuid
from app.core.db import get_sessionmaker
from app.core.models import User, Owner
from app.core.security import hash_password

async def main():
    sm = get_sessionmaker()
    async with sm() as s:
        user = User(id=uuid.uuid4(), email='kamu@contoh.com', password_hash=hash_password('password-kamu'))
        s.add(user)
        await s.flush()
        owner = Owner(id=uuid.uuid4(), user_id=user.id)
        s.add(owner)
        await s.commit()
        print('User dibuat:', user.email)

asyncio.run(main())
"
```

**Docker:** sama persis, tinggal ganti `uv run python3` jadi `docker compose --profile app exec app python3`:

```bash
docker compose --profile app exec app python3 -c "
import asyncio, uuid
from app.core.db import get_sessionmaker
from app.core.models import User, Owner
from app.core.security import hash_password

async def main():
    sm = get_sessionmaker()
    async with sm() as s:
        user = User(id=uuid.uuid4(), email='kamu@contoh.com', password_hash=hash_password('password-kamu'))
        s.add(user)
        await s.flush()
        owner = Owner(id=uuid.uuid4(), user_id=user.id)
        s.add(owner)
        await s.commit()
        print('User dibuat:', user.email)

asyncio.run(main())
"
```

Ganti `kamu@contoh.com` / `password-kamu`, lalu login di dashboard pakai itu.

---

## 6. Pasangkan device ESP32 (opsional, kalau ada device fisik)

1. Nyalakan device di WiFi yang sama, biarkan dia boot.
2. Device otomatis manggil endpoint `check_version` bridge, layarnya nampilin **kode 6 karakter**.
3. Buka halaman **Devices** di dashboard, masukkan kode itu di panel klaim.
4. Device otomatis dapet konfigurasi `websocket.url`+`token`, tersambung.

Tanpa device fisik, endpoint OTA/WebSocket tetap bisa dites manual lewat `curl`/skrip Python (`websockets` client) — lihat `docs/superpowers/plans/2026-09-10-fase1-voice-loop.md` bagian smoke test buat contoh.

---

## 7. Kalau ada yang gak jalan

- **Server nyala tapi voice loop gagal**: cek provider mana yang belum diisi di `.env` — cek log server, error-nya nyebut adapter mana yang gagal.
- **`opuslib` error "Could not find Opus library"** (dev lokal, macOS): `brew install opus`. Kode sudah ada fallback path Homebrew, tapi kalau masih gagal, restart shell setelah install.
- **Docker: 404 pas refresh halaman kayak `/agents`**: harusnya gak kejadian (SPA fallback udah di-handle), tapi kalau kejadian, rebuild image (`docker compose --profile app up -d --build`) — kemungkinan image lama.
- **`docker compose --profile app down` ikut matiin Postgres**: itu karena Postgres bukan di belakang profile terpisah. Kalau mau app doang yang mati, `docker compose stop app` (bukan `down`).
- **Perlu reset database dev**: `docker exec zora-bridge-postgres-1 psql -U zora -d zora_bridge -c "TRUNCATE TABLE messages, conversations, activation_codes, devices, owners, users, agents, provider_creds CASCADE"`.

---

## 8. Dokumen lain

| Dokumen | Isi |
|---|---|
| [README.md](README.md) | Ringkasan proyek, stack, batasan desain. |
| [docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md](docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md) | Arsitektur & kontrak device lengkap. |
| [docs/superpowers/specs/2026-09-10-zora-bridge-ui-design.md](docs/superpowers/specs/2026-09-10-zora-bridge-ui-design.md) | Desain 7 halaman dashboard. |
| [docs/superpowers/plans/](docs/superpowers/plans/) | Plan implementasi per fase (1/2/3). |
