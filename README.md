# Zora Bridge

Backend self-host untuk device voice ESP32 (Zora Mini). Ganti cloud `xiaozhi.me` dengan server sendiri — voice loop dua arah, websearch kondisional, LLM/TTS/STT pakai token milik user sendiri (BYOK).

**Status: desain selesai, belum ada kode.**

---

## Apa ini

Device ESP32 bicara → bridge memproses (STT → LLM → TTS) → device menjawab. Semua AI adapter: provider aktif per-pemilik di database, bukan config global. Multi-tenant dengan isolasi data sejak awal.

```
Device (Opus via WebSocket) → Bridge → VAD sisi server → STT → Search? → LLM → TTS → balik ke device
```

Target: p50 mulut-ke-telinga di bawah 2.5 detik.

---

## Stack

| Komponen | Teknologi |
|---|---|
| Backend | Python 3.11+, FastAPI, websockets (asyncio), Pydantic v2 |
| Database | Postgres + SQLAlchemy 2.0 + Alembic |
| Audio | Opus via opuslib (24kHz, 60ms frame) |
| LLM | OpenAI-compatible → omnirouter (`localhost:20128/v1`) |
| STT | Groq Whisper (adapter) |
| TTS | Piper (default, lisensi permisif — bukan edge-tts yang GPL) |
| Search | Adapter (tool-call kondisional) |
| Cache/Pub-sub | Valkey (bukan Redis — Redis 7.4+ SSPL) |
| Frontend | React + Vite + Tailwind (SPA) |

---

## Batasan keras

- Arsitektur inti wajib **nol biaya** + lisensi permisif (MIT/BSD/Apache-2.0).
- Provider AI berbayar cuma adapter opsional.
- **Valkey, bukan Redis.** **Piper, bukan edge-tts.**
- LLM/Search/STT/TTS masing-masing adapter — provider aktif per-pemilik di DB.
- Allowlist tool MCP, bukan blocklist. `self.reboot` dan `self.upgrade_firmware` bisa dieksekusi device walau tidak dilist — bridge wajib filter.
- Timeout wajib di setiap `tools/call` ke device — firmware tidak punya timeout sendiri.
- Key BYOK tidak pernah dikirim ke browser — hanya `secret_last4`.

---

## Struktur folder (rencana)

```
zora-bridge/
  app/
    device/        # WebSocket handshake, Opus decode/encode, audio frame handling
    control/      # REST API, MCP controller, auth, monitor, event bus
    core/          # Models, config, permissions, DB session
    adapters/      # LLM, STT, TTS, Search adapters
  alembic/         # Migrasi skema
  frontend/        # React + Vite + Tailwind dashboard
  tests/           # pytest, TDD
  docs/superpowers/
    specs/          # System design + UI design
    plans/          # Implementation plans (Fase 1-3)
  design/          # Mockup .dc.html tiap layar
```

Aturan arsitektur: `control/` tidak boleh impor `device/` — lewat event bus + DB saja.

---

## Fase implementasi

### Fase 1 — Voice loop inti (10 task, TDD)
Init project, endpoint OTA `check_version` + `/activate` (pairing via kode), WS handshake, adapter LLM/STT/TTS, VAD sisi server, pacer real-time, end-to-end voice loop, search tool-call, simpan turn ke Postgres.

### Fase 2 — Kontrol device + dashboard (25 task)
MCP controller (initialize → tools/list paginasi 8000 byte → allowlist → tools/call timeout), REST API + auth JWT, dashboard React 7 layar (Overview, Agents, Providers, Devices, LiveMonitor, Conversations, UsersRoles), live monitor WebSocket browser + event bus.

### Fase 3 — RBAC (7 task)
Tabel roles/memberships/invitations, matriks 3 peran (Owner/Operator/Viewer), undangan via kode, penegakan izin di semua endpoint, izin "baca transkrip" dipisah dari "putar audio", sole-owner guard, pendaftaran default off.

---

## Matriks izin (Fase 3)

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

---

## Dokumen

| Dokumen | Isi |
|---|---|
| [System Design](docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md) | Arsitektur, kontrak device, model data, fase kerja. **Baca ini dulu.** |
| [UI Design](docs/superpowers/specs/2026-09-10-zora-bridge-ui-design.md) | Tujuh layar dashboard + fiturnya. |
| [Plan Fase 1](docs/superpowers/plans/2026-09-10-fase1-voice-loop.md) | Voice loop inti, 10 task TDD. |
| [Plan Fase 2](docs/superpowers/plans/2026-09-10-fase2-dashboard-control.md) | Kontrol device + dashboard, 25 task. |
| [Plan Fase 3](docs/superpowers/plans/2026-09-10-fase3-rbac.md) | RBAC multi-user, 7 task. |
| [PLAN.md](PLAN.md) | Catatan brainstorming awal (sebagian sudah digantikan spec). |
| [design/](design/) | Mockup `.dc.html` tiap layar. |

---

## Aturan developmen

- **Jangan tulis kode/config library manual.** Pakai command resmi (`npx tailwindcss init -p`, `npm create vite@latest`, `alembic revision`, `npx tsc --init`, dll). Lebih cepat + akurat.
- TDD: tes dulu, baru kode. RED → GREEN → REFACTOR.
- Satu worker uvicorn (event bus in-process). Multi-worker = ganti ke Valkey pub/sub.
- Timestamp semua UTC.
- Jangan commit `.env` atau credential.

---

## Firmware

Fork xiaozhi-esp32, branch `esp32/supermini-hermes`, board `bread-compact-wifi`. Repo sebelah: `../xiaozhi-esp32`.

Tiga temuan firmware yang mengubah desain:

1. **Server yang harus deteksi akhir ucapan.** VAD device cuma nyalain LED, gak pernah dikirim. Bridge wajib VAD sisi server.
2. **Endpoint OTA `check_version` bisa nyuntik `websocket.url` + `token` langsung ke NVS device.** Pairing lewat kode di layar → polling `/activate` (202=belum diklaim, 200=sukses). Gak perlu ngoprek firmware.
3. **Tool MCP berbahaya (`self.reboot`, `self.upgrade_firmware`) tetap dieksekusi device walau gak dilist.** Bridge wajib pakai allowlist.

---

## Lisensi

MIT (direncanakan). Arsitektur inti wajib lisensi permisif — komponen yang dipakai harus MIT/BSD/Apache-2.0 (Valkey, Piper, FastAPI, dll). Provider AI berbayar hanya sebagai adapter opsional.
