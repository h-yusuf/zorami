# Bridge server: Zora Mini ESP32 ↔ AI backend custom (self-host)

> **Catatan (2026-09-10):** dokumen ini catatan brainstorming awal. Sebagian keputusannya **sudah digantikan** setelah proyek diputuskan jadi multi-tenant BYOK dan setelah riset firmware:
>
> - SQLite → **Postgres** (multi-tenant + concurrent write)
> - `config.yaml` global buat provider → **per-pemilik di DB** (YAML global gak jalan buat multi-tenant)
> - "gak perlu OTA server dulu" → **endpoint OTA masuk Fase 1** (itu jalur pairing device)
> - edge-tts sebagai default → **Piper** (edge-tts GPL-3.0)
> - Asumsi device yang deteksi akhir ucapan → **server yang harus deteksi**
> - Branch firmware sebenarnya `esp32/supermini-hermes`, bukan `hermes`
>
> Yang mengikat sekarang: [desain sistem](docs/superpowers/specs/2026-09-10-zora-bridge-system-design.md) dan [desain tampilan](docs/superpowers/specs/2026-09-10-zora-bridge-ui-design.md).

## Context

Firmware Zora Mini (fork xiaozhi-esp32, branch `hermes`) defaultnya connect ke cloud `xiaozhi.me` — locked ke provider mereka, websearch premium-only. Tujuannya: bikin backend sendiri (self-host) yang device connect ke situ, dengan:
- LLM pake API/token sendiri lewat **omnirouter** (`http://localhost:20128/v1`, OpenAI-compatible)
- Websearch multi-provider, switchable
- STT/TTS multi-provider, switchable
- Chat log kesimpen di database

Project ini terpisah dari firmware (`xiaozhi-esp32` repo) — folder baru sendiri sejajar (`AIoT/zora-bridge/`).

## Kesimpulan brainstorming (hasil diskusi, sudah disepakati)

**Kenapa gak bisa langsung connect ke Hermes** (dari eksplorasi `~/.hermes/`): Hermes = agent chat-first/session-based (channel Discord dkk), bukan server voice-native, gak ada API HTTP simpel yang kekonfirmasi buat "kirim teks polos, terima teks balik" dari luar. Ternyata gak perlu juga — omnirouter (`localhost:20128/v1`) yang dipakai Hermes sebagai LLM provider itu sendiri udah OpenAI-compatible endpoint biasa, tinggal dipanggil langsung pakai token sendiri. Jadi gak perlu jembatan ke Hermes — bridge cukup connect ke omnirouter langsung.

**Alur data end-to-end:**
```
1. Device rekam suara → kirim Opus audio via WebSocket ke bridge
2. Bridge: STT modul → audio jadi teks
3. Bridge: (kondisional) LLM minta tool-call search → Search modul dipanggil → hasil disuntik balik ke LLM
4. Bridge: teks (+ hasil search) → POST omnirouter (localhost:20128/v1) → balesan teks
5. Bridge: TTS modul → balesan teks jadi audio
6. Bridge kirim audio balik ke device via WebSocket → device muter di speaker
7. Semua turn (STT text, LLM reply, provider dipakai) dicatat ke database
```

**Prinsip desain:** LLM (omnirouter), Search, STT, TTS masing-masing jadi **adapter/plugin** lewat interface (Protocol/ABC), provider aktif diatur config — ganti provider tanpa ubah kode inti.

**Protokol device (dari analisa `docs/websocket.md`, `main/ota.cc`, `main/application.cc` di repo xiaozhi-esp32):**
- Firmware gak hardcode backend — backend (WS url atau MQTT broker) 100% runtime-provisioned lewat NVS. Buat dev: set NVS `Settings("websocket")` (`url`, `token`, `version`) langsung nunjuk ke bridge lokal (dipakai di `main/protocols/websocket_protocol.cc:80-82`), gak perlu bikin OTA server dulu.
- WebSocket dipilih (bukan MQTT+UDP) karena lebih simpel — gak perlu urus UDP+AES terpisah.
- Handshake: `hello` JSON (audio_params: opus/16kHz/mono/60ms) → bridge balas `hello` + `session_id` dalam 10 detik → lanjut JSON control message + binary Opus frame.
- MCP (kontrol device: LED/servo/GPIO) numpang channel yang sama, JSON-RPC `type: "mcp"` — bisa disusulkan setelah voice+search jalan duluan.

**Tech stack (disepakati):**
- **Python 3.11+**, FastAPI + `websockets` (asyncio) — ekosistem STT/TTS/search/LLM paling lengkap di Python, FastAPI bisa serve WS (device) + REST/dashboard (config UI nanti) dalam satu app
- `pydantic` buat config schema & validasi
- `openai` python client buat panggil omnirouter (udah compatible)
- Opus encode/decode: `pyogg` atau `opuslib`
- Config provider aktif: file YAML

**Database (disepakati): SQLite**
- Single file, zero-setup, cukup buat skala personal/single-server
- Schema kasar:
  ```
  conversations: id, session_id, device_id, created_at
  messages: id, conversation_id, role (user/assistant), text,
            audio_duration_ms, provider_used, created_at
  ```
- Config provider (search/stt/tts pilihan) tetap di YAML, bukan di DB — DB cuma buat data runtime (chat log, session)
- Upgrade ke Postgres nanti kalau butuh multi-device skala besar/concurrent query berat — belum sekarang

**Provider default yang diusulkan (semua switchable via config):**
- STT: Groq Whisper-large-v3-turbo (API, cepat+murah+akurasi ID bagus) — alternatif lokal: faster-whisper
- TTS: edge-tts (gratis, suara ID Ardi/Gadis) — alternatif lokal: Piper
- Search: multi-provider (belum final provider mana, tinggal tambah adapter tiap kali mau nambah)
- LLM: omnirouter `localhost:20128/v1`, token user sendiri

## Struktur folder project (rencana)

```
zora-bridge/
  PLAN.md                  # file ini
  pyproject.toml
  config.yaml              # provider aktif (llm/search/stt/tts) + token
  app/
    main.py                # FastAPI app, WS endpoint device
    protocol/
      websocket_handler.py # implement hello/handshake sesuai docs/websocket.md
      opus_codec.py
    adapters/
      llm/omnirouter.py
      search/base.py        # interface, provider konkret nyusul
      stt/groq_whisper.py
      tts/edge_tts.py
    db/
      models.py             # SQLAlchemy models: conversations, messages
      session.py
  README.md
```

## Langkah kerja (urutan implementasi, belum dimulai)

### Fase 1 — Voice loop inti (target utama)

1. Init project (`pyproject.toml`, struktur folder di atas)
2. Implement WS handshake sesuai `docs/websocket.md` (hello/hello, session_id) — test pakai device Zora Mini asli, cek log `idf.py monitor`
3. Implement adapter LLM → omnirouter (paling gampang, langsung `openai` client)
4. Implement STT adapter (Groq Whisper dulu) — audio Opus in → text out
5. Implement TTS adapter (edge-tts) — text in → Opus out, stream balik ke device
6. Sambungin end-to-end: device ngomong → bridge proses → device denger balesan (loop dasar jalan tanpa search dulu)
7. Tambah Search adapter + logic kondisional (LLM minta search via tool-call) — connect ke LLM step
8. Setup SQLite + simpen tiap turn percakapan (conversations/messages)

**Definisi "program selesai" (exit criteria Fase 1+2):** device ESP tipe xiaozhi bisa connect ke bridge, voice loop jalan dua arah, websearch kepanggil pas butuh info terkini, dan otaknya pakai token AI sendiri (omnirouter) — bukan provider cloud xiaozhi.me.

### Fase 2 — Kontrol device + dashboard (masuk scope, bukan opsional)

9. MCP tool-calling buat kontrol device fisik (LED/servo/GPIO) — numpang channel WS yang sama, JSON-RPC `type: "mcp"`
10. Web dashboard config — ganti provider/token/model dari browser (baca-tulis `config.yaml`), plus lihat chat log dari SQLite. Serve dari FastAPI app yang sama (REST + static UI)

### Fase 3 — RBAC (paling akhir, setelah Fase 1+2 kelar & stabil)

11. Role-based access control buat dashboard & API. Baru dikerjakan setelah program inti jalan — jangan dicampur ke fase awal biar gak nambah kompleksitas duluan.

    Yang perlu diputusin nanti (belum final, jangan diasumsikan sekarang):
    - **Role apa aja** — kandidat: `admin` (edit config/token, kelola user), `operator` (lihat + kontrol device, gak boleh ganti token), `viewer` (read-only chat log)
    - **Auth mechanism** — session cookie vs JWT; login form di dashboard
    - **Scope yang dikontrol** — edit provider config, lihat/rotate token API, akses chat log, klaim/pairing device
    - **Skema DB tambahan** — tabel `users`, `roles`, dan kemungkinan `device_owner` (device kepunyaan user mana)
    - **Auth device** — device sekarang cuma bawa token statis via NVS; kalau multi-user, perlu mapping token → owner

## Verifikasi (buat nanti pas implementasi jalan)

1. Set NVS device (`websocket.url`/`token`) nunjuk ke bridge lokal, `idf.py monitor` — cek handshake `hello`/`hello` sukses
2. Ngomong ke device → cek log bridge: STT text bener → LLM reply masuk akal → TTS audio balik → device ngomong
3. Test 1 pertanyaan yang butuh info terkini → cek search adapter kepanggil, hasil nyambung ke jawaban
4. Cek SQLite — tiap turn percakapan kesimpen (`conversations`/`messages` table keisi bener)
5. (Fase 2) Suruh device nyalain LED/gerak servo lewat suara → cek MCP call kekirim, device beneran gerak
6. (Fase 2) Buka dashboard di browser → ganti provider STT/TTS → cek `config.yaml` keupdate & provider baru kepake tanpa restart manual
7. (Fase 3) Login pakai role non-admin → cek endpoint edit config/token ketolak (403), chat log tetep kebaca sesuai role

## Status

Baru tahap plan/dokumentasi. Belum ada kode ditulis — nunggu konfirmasi lanjut ke implementasi.
