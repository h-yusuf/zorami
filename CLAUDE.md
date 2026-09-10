# Zora Bridge — project context

Bridge server buat firmware **Zora Mini ESP32** (fork xiaozhi-esp32, repo sebelah: `../xiaozhi-esp32`, branch `esp32/supermini-hermes`). Ganti backend device dari cloud `xiaozhi.me` (locked provider, websearch premium) ke server self-host sendiri.

Status: **desain selesai, belum ada kode.** Dokumen yang mengikat:

- [docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md](docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md) — arsitektur, kontrak device hasil riset firmware, model data, fase kerja. **Baca ini dulu sebelum nulis kode.**
- [docs/superpowers/specs/2026-09-10-zora-bridge-ui-design.md](docs/superpowers/specs/2026-09-10-zora-bridge-ui-design.md) — tujuh layar dashboard + fiturnya.
- [design/](design/) — mockup `.dc.html` tiap layar.
- [PLAN.md](PLAN.md) — catatan brainstorming awal; sebagian keputusannya sudah digantikan dokumen di atas.

## Ringkasan keputusan

- **Bentuk produk**: multi-tenant (banyak user luar, data terisolasi per pemilik) dengan model **BYOK** — user masukin API key sendiri, biaya AI di akun mereka. Tiap row DB bawa `owner_id` sejak awal; auth/RBAC tetap fase terakhir, fase awal jalan pakai satu owner yang di-seed.
- **Batasan keras**: arsitektur inti wajib nol biaya + lisensi permisif (MIT/BSD/Apache-2.0). Provider AI berbayar cuma boleh jadi adapter opsional. **Valkey, bukan Redis** (Redis 7.4+ pindah SSPL). edge-tts itu GPL-3.0 — Piper jadi default.
- **Kenapa bukan connect ke Hermes langsung**: Hermes (`~/.hermes/`) itu agent chat-first/session-based, bukan server voice-native. Cukup connect ke **omnirouter** (`http://localhost:20128/v1`, OpenAI-compatible) pakai token sendiri.
- **Alur**: device (Opus via WebSocket) → bridge → **VAD sisi server** → STT → (opsional) search tool-call → LLM → TTS → balik ke device seirama waktu nyata.
- **Prinsip**: LLM/Search/STT/TTS masing-masing adapter, provider aktif per-pemilik di DB (bukan `config.yaml` global — itu gak jalan buat multi-tenant).
- **Stack**: Python 3.11+, FastAPI + `websockets` (asyncio), pydantic, `openai` client, Opus via `opuslib`. Frontend React + Vite + Tailwind.
- **DB**: **Postgres** + SQLAlchemy + Alembic sejak awal.
- **Arsitektur**: modular monolith — paket `device/`, `control/`, `core/`, `adapters/`. `control/` gak boleh impor `device/`; ketemunya lewat event bus + DB.
- **Tiga temuan firmware yang mengubah rencana** (detail + `file:line` di dokumen sistem):
  1. **Server yang harus deteksi akhir ucapan.** VAD device cuma nyalain LED, gak pernah dikirim. Di mode auto/realtime device gak pernah kirim `listen stop`.
  2. **Endpoint OTA `check_version` bisa nyuntik `websocket.url`+`token` langsung ke NVS device**, dan firmware udah punya alur activation-code (kode di layar → polling `/activate`, 202=belum diklaim, 200=sukses). Jadi pairing gak perlu ngoprek firmware — endpoint OTA masuk Fase 1, bukan opsional.
  3. **Tool MCP berbahaya (`self.reboot`, `self.upgrade_firmware`) tetap dieksekusi device walau gak dilist.** Bridge wajib pakai allowlist buat nyaring apa yang diekspos ke LLM.

## Urutan implementasi (belum dimulai)

**Fase 1 — voice loop inti**
1. Init project (pyproject, struktur folder, Docker Compose app+Postgres, Alembic)
2. Endpoint OTA `check_version` + `/activate` (semantik 202/200, `websocket` config, `server_time`)
3. WS handshake (balas hello dalam 10 detik, `audio_params` downlink 24000/60)
4. Adapter LLM → omnirouter
5. Adapter STT (Groq Whisper) + `endpointer.py` (VAD sisi server)
6. Adapter TTS (Piper) + `pacer.py` (kirim seirama waktu nyata, pre-buffer 0)
7. Sambungin end-to-end termasuk penanganan `abort`
8. Adapter Search + tool-call kondisional
9. Postgres: simpan tiap turn, hormati `chat_log_level` per agent

**Fase 2 — kontrol device + dashboard**
10. MCP: `initialize` → `tools/list` (paginasi berbasis nama tool, batas 8000 byte) → ekspos ke LLM lewat allowlist → `tools/call` dengan timeout sendiri
11. REST API + auth dasar (satu owner di-seed)
12. Dashboard React: tujuh layar sesuai dokumen tampilan
13. Live monitor (WebSocket browser + event bus)

**Fase 3 — RBAC (paling akhir)**
14. Tabel `roles`/`memberships`, undangan, penegakan izin, matriks tiga peran (Owner/Operator/Viewer)

Target "program selesai" = device ESP tipe xiaozhi bisa diklaim lewat kode di layarnya, voice loop dua arah jalan, websearch kepanggil pas butuh info terkini, otak pakai token AI sendiri, p50 mulut-ke-telinga di bawah 2.5 detik.

Detail struktur folder & langkah verifikasi lengkap: [PLAN.md](PLAN.md).
