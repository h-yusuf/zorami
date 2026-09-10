# Zora Bridge — Desain Sistem

Tanggal: 2026-09-10
Status: disepakati lewat sesi brainstorming, belum ada kode
Dokumen pasangan: [desain tampilan](2026-09-10-zora-bridge-ui-design.md)

Referensi firmware: `../xiaozhi-esp32`, branch **`esp32/supermini-hermes`** (bukan `hermes` seperti tertulis di CLAUDE.md lama), board `bread-compact-wifi`. Semua rujukan `file:line` di dokumen ini relatif ke repo firmware itu.

---

## 1. Apa yang dibangun

Backend self-host yang menggantikan cloud `xiaozhi.me` untuk device ESP32 Zora Mini. Device bicara → bridge memproses (STT → LLM → TTS) → device menjawab. Websearch dan otak LLM pakai token milik user sendiri.

Keputusan yang membentuk seluruh desain:

| Keputusan | Pilihan | Konsekuensi utama |
|---|---|---|
| Audiens | **Multi-tenant**, banyak user luar | Isolasi data first-class; `config.yaml` global tidak cukup |
| Model biaya | **BYOK** — user bawa key sendiri | Tidak perlu quota engine/billing; perlu penyimpanan key terenkripsi |
| Realtime di web | **Hanya live monitor** | Tidak ada web chat, voice test browser, atau panel kontrol device manual |
| Kemampuan agent | Dasar + **memori jangka panjang** | Tidak ada RAG, scheduler, atau custom webhook |
| Frontend | React + Vite + Tailwind (SPA) | REST + WebSocket ke FastAPI |
| Database | **Postgres** sejak awal | SQLAlchemy + Alembic, FK sungguhan, FTS bawaan |
| Bentuk service | **Modular monolith** | Satu deployable; batas modul tegas supaya bisa dipecah nanti |

### Definisi "program selesai"

Device ESP32 tipe xiaozhi bisa diklaim ke akun lewat kode di layarnya, voice loop jalan dua arah, websearch kepanggil saat butuh info terkini, dan otaknya pakai token AI milik user — bukan provider cloud xiaozhi.me. RBAC di luar itu, fase terakhir.

---

## 2. Batasan yang mengikat

**Arsitektur inti wajib nol biaya dan berlisensi permisif.** Provider AI berbayar hanya boleh hadir sebagai adapter opsional yang dipilih user dengan key sendiri.

Aman dipakai (MIT/BSD/Apache-2.0): Python, FastAPI, uvicorn, pydantic, SQLAlchemy, Alembic, `cryptography`, `pyjwt`, argon2, opuslib, React, Vite, Tailwind. Postgres berlisensi setara permisif dan bebas komersial.

Yang tidak dipakai, beserta gantinya:

| Ditolak | Alasan | Ganti |
|---|---|---|
| Redis | Sejak 2024 pindah ke SSPL/RSAL, bukan OSI | **Valkey** (Linux Foundation, BSD-3) |
| Auth0 / Clerk / Firebase Auth | Berbayar | argon2 + JWT sendiri |
| Pusher / Ably | Berbayar | WebSocket FastAPI sendiri |
| Algolia / Elastic Cloud | Berbayar | Postgres full-text search |
| Supabase / Neon | Berbayar di skala | Postgres self-host |
| Datadog / New Relic | Berbayar | `structlog` + log terstruktur |
| `pydub` | Menarik ffmpeg (GPL/LGPL) | `numpy` / `soxr` untuk resample |

**Dua temuan lisensi dari riset pembanding yang harus dipatuhi:**

1. **edge-tts berlisensi GPL-3.0** (hanya `srt_composer.py` yang MIT). Kalau di-`import` ke dalam codebase, itu menular ke lisensi kita. Kalau tetap mau dipakai, batasnya harus proses terpisah — panggil CLI-nya lewat subprocess, jangan di-link. Lebih aman: **Piper sebagai default sejak awal**, edge-tts sebagai adapter opsional yang jelas ditandai.
2. **SearXNG berlisensi AGPL** — aman karena dipanggil lewat HTTP sebagai service terpisah, bukan library yang di-link. Jangan pernah menyalin kodenya ke dalam repo.

Cek lisensi setiap kali menambah dependency. Ini bergerak — Redis buktinya.

---

## 3. Arsitektur

Satu proses FastAPI, tiga paket dengan aturan impor tegas.

```
app/
  core/                    # dipakai kedua sisi
    bus.py                 # publish(topic, event) / subscribe(topic)
    crypto.py              # enkripsi API key BYOK
    db/models.py
    db/session.py
  adapters/                # provider, dipilih runtime per-user dari DB
    llm/ stt/ tts/ search/ # tiap folder: base.py (Protocol) + implementasi
  device/                  # hanya device yang menyentuh ini
    ota.py                 # check_version + /activate
    ws.py                  # handshake, listen, abort, mcp
    session.py             # state per sesi device
    endpointer.py          # VAD sisi server — lihat §4.3
    pipeline.py            # STT → memori → LLM → (search) → TTS
    opus.py
    pacer.py               # pengatur irama kirim audio — lihat §4.6
  control/                 # hanya browser yang menyentuh ini
    api/agents.py devices.py providers.py conversations.py auth.py
    monitor.py             # WebSocket browser, subscribe ke bus
  main.py
web/                       # React + Vite + Tailwind
```

**Aturan tunggal yang membuat pemisahan ini berguna:** `control/` tidak boleh mengimpor `device/`, dan sebaliknya. Dashboard tidak menyentuh objek sesi device. Kalau dashboard ingin tahu apa yang terjadi, ia subscribe ke bus. Kalau dashboard ingin mengubah sesuatu, ia menulis ke DB dan sesi device membacanya pada turn berikutnya.

**Event bus.** In-process asyncio dulu. Topik: `turn.stt`, `turn.llm`, `turn.search`, `turn.tts`, `turn.error`, `device.online`, `device.offline`. Setiap event membawa `device_id` + `owner_id` supaya monitor bisa menyaring milik siapa.

Batasnya jujur: pub/sub in-process hanya benar selama **satu worker**. Begitu jalan multi-worker, browser yang tersambung ke worker A tidak mendengar event device di worker B — saat itulah `bus.py` diganti implementasi Valkey. Sampai itu terjadi, jalankan satu worker dan catat ini di README.

---

## 4. Kontrak device — hasil riset firmware

Bagian ini yang paling mahal kalau salah. Semua di bawah sudah diverifikasi langsung ke kode firmware.

### 4.1 Endpoint OTA / provisioning

Device memanggil endpoint `check_version` saat boot. URL-nya dari NVS `ota_url`, jatuh ke `CONFIG_OTA_URL` (`main/ota.cc:46-53`). Metode **POST** kalau board mengirim system info, kalau tidak GET (`ota.cc:94`).

Header yang dikirim (`ota.cc:55-72`): `Activation-Version` (`2` kalau serial ada di efuse, `1` kalau tidak), `Device-Id` (MAC), `Client-Id` (UUID), `Serial-Number` (opsional), `User-Agent`, `Accept-Language`.

Yang boleh dibalas server, semuanya opsional kecuali status 200:

```jsonc
{
  "websocket": { "url": "...", "token": "...", "version": 1 },  // ditulis device ke NVS
  "activation": { "message": "...", "code": "4K9T2X", "challenge": "...", "timeout_ms": 30000 },
  "server_time": { "timestamp": 1757500000000, "timezone_offset": 420 },
  "firmware": { "version": "1.9.2", "url": "https://...", "force": 0 }
}
```

Empat hal penting:

- Objek `websocket` **ditulis langsung ke NVS oleh device** (`ota.cc:168-183`). Ini yang membuat provisioning otomatis: bridge menyuntik url + token per-user, tanpa perlu colok kabel.
- `server_time` **load-bearing** — device tidak punya RTC, dan jamnya dipakai untuk validasi TLS. Selalu kirim.
- `firmware` membuat bridge sekalian jadi OTA host.
- Device tidak brick kalau field kurang; syarat keras hanya **HTTP 200**. Non-200 memicu retry dengan backoff sampai 10 kali.

### 4.2 Alur aktivasi (pairing)

Firmware sudah punya alur ini, tidak perlu diubah:

1. Device boot, panggil `check_version`.
2. Bridge belum mengenali `Device-Id` → balas `activation.code` (kode pendek) + `message`.
3. Device **menampilkan kode di layarnya** (`main/application.cc:491-499`).
4. Device polling `POST <check_url>/activate` (`ota.cc:458-492`).
5. Selama belum diklaim, bridge balas **202** → device retry (3 detik, maks 10 kali, `application.cc:503-516`).
6. User memasukkan kode di dashboard → bridge mengikat `Device-Id` ke `owner_id`.
7. Polling berikutnya dibalas **200** → aktivasi selesai; `check_version` berikutnya mengembalikan `websocket.url` + `token` milik user itu.

Semantik 202 versus 200 harus tepat. Riset pembanding menemukan ini sumber infinite-loop paling sering.

Jalur HMAC (`algorithm: hmac-sha256`, `serial_number`, `challenge`, `hmac`) hanya hidup kalau serial + kunci HMAC sudah diburn ke efuse. Tanpa itu payload `{}` dan identifikasi bersandar pada header `Device-Id` — cukup untuk alur kode-di-layar. Dukung keduanya: kalau `Serial-Number` ada, verifikasi HMAC-nya; kalau tidak, jangan tolak.

### 4.3 Turn-taking — temuan paling penting

**Server yang harus mendeteksi akhir ucapan, bukan device.**

VAD di firmware ada, tapi keluarannya hanya menyalakan LED — tidak pernah dikirim ke server (`application.cc:82-84`, `:255-260`; sumber VAD di `main/audio/engines/afe_audio_engine.cc:420-427`). Satu-satunya pengiriman `listen stop` adalah pelepasan tombol push-to-talk (`application.cc:864-878`).

Artinya di mode `auto` dan `realtime`, **device tidak pernah memberi tahu bahwa user berhenti bicara.** Bridge wajib punya `endpointer.py` sendiri: buffer stream Opus, jalankan VAD, dan tutup turn dengan mengirim `tts start`.

Mode listen (`main/protocols/protocol.h:37-41`, serialisasi di `protocol.cc:74-86`):

| Mode | Kapan dipakai | Perilaku |
|---|---|---|
| `auto` | default kalau AEC mati (`application.cc:1166-1168`) | Mic mati selama Speaking; `listen start` baru setiap turn |
| `realtime` | default kalau AEC hidup | Mic tetap hidup selama TTS (barge-in); `listen start` **hanya sekali per koneksi** |
| `manual` | hanya dari push-to-talk | Setelah `tts stop` device kembali Idle, bukan Listening |

Konsekuensi praktis: implementasi bridge tidak boleh mengandalkan datangnya `listen start` di setiap turn. Di `realtime` ia datang sekali saja.

Titik awal VAD: ambang 0.5, ambang rendah 0.3, hening minimum **jangan 200ms** — proyek pembanding memakai 200 dan pengguna mengeluh kalimat terpotong di tengah; mulai dari **700–1000ms** dan turunkan kalau terasa lambat.

### 4.4 Wake word

Device mengirim `{"type":"listen","state":"detect","text":"<kata>"}` (`protocol.cc:67-72`), **didahului frame Opus wake-word yang di-cache**, lalu langsung `listen start` (`application.cc:963-976`). Server tidak perlu membalas apa pun; audio sudah mengalir.

**Batasan yang harus diketahui sekarang:** ESP-SR WakeNet hanya menyertakan wake phrase Mandarin dan Inggris terlatih. Wake word Indonesia kustom ("Zora") butuh pelatihan komersial Espressif dengan 500+ pembicara. Jadi untuk sekarang: pakai wake phrase bawaan yang tersedia, atau push-to-talk. Jangan menjanjikan wake word bahasa Indonesia di UI.

### 4.5 Audio dan framing

Handshake device (`main/protocols/websocket_protocol.cc:198-222`) mengirim `audio_params: {format: "opus", sample_rate: 16000, channels: 1, frame_duration: 60}`.

- **Uplink terpaku 16 kHz / mono / 60 ms dan tidak bisa ditawar** (`main/audio/audio_service.h:65-76`, `audio_service.cc:69-87`). Mic di-resample ke 16 k di device.
- Balasan hello server hanya dibaca empat fieldnya: `transport` (wajib `"websocket"`, kalau tidak diabaikan → timeout 10 detik), `session_id`, `audio_params.sample_rate`, `audio_params.frame_duration` (`websocket_protocol.cc:224-250`). Keempatnya **berlaku untuk downlink saja**, default 24000/60.
- Jadi TTS boleh 24 kHz walaupun mic 16 kHz — device yang me-resample (`audio_service.cc:522-556`). Pakai **24000/60**: kualitasnya lebih baik dan itu memang default firmware.
- `frame_duration` harus cocok dengan paket sungguhan, karena dipakai menghitung ukuran buffer decoder (`audio_service.cc:540`).
- **Framing versi 1 (default): Opus mentah, satu paket per pesan biner WebSocket, tanpa Ogg, tanpa prefix, tanpa batching** (`websocket_protocol.cc:52`, `:133-139`). Versi 2 dan 3 punya header berukuran tetap, tapi tidak perlu disentuh.
- Selalu kirim `session_id` di hello — device tidak membersihkannya saat koneksi tutup (`websocket_protocol.cc:74-77`).

### 4.6 Mengirim audio balik — dan jebakan iramanya

`tts start` **wajib** dikirim sebelum frame biner apa pun. Biner yang datang di luar state Speaking **dibuang diam-diam** (`application.cc:543-547`).

Antrean decode device hanya **20 paket ≈ 1.2 detik**, dan jalur jaringan mendorong dengan `wait=false` — kelebihan **dibuang, bukan diantrekan** (`audio_service.h:42`, `audio_service.cc:602-614`). Tidak ada ack, tidak ada flow control.

Ini bug yang sudah terjadi di proyek pembanding: konstanta pre-buffer bernilai 5 membuat 5 frame melewati pengatur irama, terukur 6 frame 60 ms terkirim dalam 10 ms, membanjiri RX ESP32-C3 dan memutus playback setelah satu suku kata. **Karena itu ada `pacer.py`: kirim seirama waktu nyata, pre-buffer 0.**

Urutan pesan per turn:

```
OUT  stt   {text}                    # tampilkan transkrip di layar device
OUT  llm   {emotion}                 # ubah ekspresi wajah
OUT  tts   {state: "start"}           # WAJIB sebelum biner
OUT  tts   {state: "sentence_start", text}   # subtitle
OUT  <biner opus, seirama waktu nyata>
OUT  tts   {state: "stop"}
```

### 4.7 Abort

Device mengirim `{"type":"abort"[,"reason":"wake_word_detected"]}` (`protocol.cc:58-65`). Pemicunya: tombol saat Speaking, push-to-talk saat Speaking, atau wake word saat Speaking/Listening.

Server **wajib berhenti mengirim audio dan mengirim `tts stop`**. Untuk kasus tombol, device tidak keluar dari state Speaking dengan sendirinya, dan flag `aborted_` ditulis tapi tidak pernah dibaca (`application.h:150`, `application.cc:615`, `:1155`) — jadi audio yang terlambat masih akan diputar. Kalau server tidak mengirim `tts stop`, device menggantung.

### 4.8 Timeout dan siklus hidup

- Balasan hello: **10 detik** (`websocket_protocol.cc:182-189`).
- Idle: **120 detik** sejak frame masuk terakhir (`protocol.cc:100-109`), tapi hanya diperiksa saat turn dimulai — kanal basi diganti, bukan ditutup proaktif.
- **Firmware tidak punya auto-reconnect maupun backoff.** Terputus → Idle; wake/tombol berikutnya membuka socket baru.
- **Konflik yang belum terselesaikan:** riset firmware menemukan device otomatis membalas Pong terhadap Ping server (`managed_components/78__esp-ml307/src/web_socket.cc:397-399`), tapi riset proyek pembanding menemukan ESP32 mereka mati di ~40 detik dengan `1011 keepalive ping timeout` karena default `ping_interval` 20 detik di library `websockets`, dan solusinya `ping_interval=None` + ping level aplikasi. Kemungkinan ini beda per transport/board. **Sikap aman: setel `ping_interval=None` dan andalkan idle timeout 120 detik.** Verifikasi dengan device sungguhan sebelum diputuskan final.
- Device **polling OTA setiap 60 detik selama idle** — ini penguat badai request. Endpoint `check_version` harus murah: satu query indexed, tanpa kerja berat.

---

## 5. Integrasi MCP (kontrol device oleh LLM)

Semua sudah diverifikasi ke `main/mcp_server.cc` / `.h`.

**Inisialisasi.** Tidak ada gerbang — `tools/list` dan `tools/call` bekerja tanpa `initialize` sama sekali (`mcp_server.cc:384-432`). Tapi tetap kirim `initialize` sekali per koneksi, karena satu-satunya hal yang dibawanya adalah **URL + token vision** (`mcp_server.cc:385-390`, `:331-347`) — `protocolVersion` dan `clientInfo` tidak pernah dibaca.

**`tools/list`.** Parameternya `cursor` dan `withUserTools` (harus boolean JSON sungguhan). **`cursor` itu nama tool, bukan indeks** (`:452-469`). Ada batas keras **8000 byte** pada JSON hasil; `nextCursor` berisi nama tool pertama yang tidak kebagian tempat, dan **kuncinya hilang sama sekali kalau sudah habis** (`:499-503`) — selesai berarti kunci tidak ada, bukan bernilai kosong.

**Pemetaan schema ke function-calling.** Device memancarkan `{"name", "description", "inputSchema": {"type": "object", "properties": {...}}}`, dengan `"required"` hanya muncul kalau tidak kosong (`mcp_server.h:245-251`). Per properti: bool → `{"type":"boolean"}`, int → `{"type":"integer"[,"minimum","maximum"]}`, string → `{"type":"string"}`, masing-masing bisa punya `default`. **Tidak pernah ada `description` per properti dan tidak pernah ada `enum`** — dokumentasi argumen hidup di `description` tool. Bisa dipakai langsung sebagai `parameters` OpenAI; tambahkan `additionalProperties: false` sendiri.

**`tools/call`.** Sukses: `{"content":[{"type":"text","text":"..."}],"isError":false}` — bool jadi `"true"`/`"false"`, int jadi string desimal. **Error datang sebagai objek `error` JSON-RPC yang hanya berisi `message`, tanpa `code`** — dokumentasi firmware yang menyebut `-32601` itu salah (`mcp_server.cc:443-450`). Pesannya juga tidak di-escape, jadi tanda kutip di nama tool merusak frame.

**Dua hal keamanan yang wajib dikerjakan bridge:**

1. **Tool berbahaya tetap bisa dieksekusi walau tidak dilist.** `DoToolCall` mencari di seluruh daftar tool tanpa memeriksa `withUserTools` (`:509-518`). Jadi `self.reboot` dan `self.upgrade_firmware` **bisa dipanggil** meski tidak muncul di `tools/list` biasa. Filternya harus di bridge: buat allowlist eksplisit tool yang boleh diekspos ke LLM, dan tolak sisanya di sisi server sebelum sampai ke device.
2. **Ada kondisi di mana device tidak membalas sama sekali** — `jsonrpc` salah, `method` tidak ada, `params` bukan objek, atau `id` hilang/bukan angka (`:352-381`). Panggilan menggantung tanpa error. Karena firmware juga tidak punya timeout per panggilan, **bridge wajib memasang timeout sendiri** per `tools/call`. `id` harus **integer**.

**Kamera.** `take_photo` = ambil gambar lalu POST `multipart/form-data` ke URL vision dengan field `question` dan `file`, header `Device-Id`/`Client-Id`/`Authorization` (`main/boards/common/esp32_camera.cc:253-325`). **Badan respons dikembalikan apa adanya sebagai teks hasil tool** (`:332-338`) — jadi bridge-lah yang menjalankan model vision dan menjawab pertanyaannya. URL itu hanya bisa masuk lewat `initialize`.

**Arah sebaliknya kosong.** Device hanya membalas; tidak ada notifikasi `tools/list_changed` yang benar-benar dikirim. Jangan menunggu apa pun dari device selain balasan.

---

## 6. Model data

Prinsip yang tidak bisa dinegosiasikan: **setiap baris membawa `owner_id`.** Riset pembanding menemukan tabel riwayat percakapan mereka tidak punya kolom pemilik dan kepemilikan disimpulkan lewat relasi — itu kebocoran multi-tenant yang menunggu terjadi. Pakai FK sungguhan (kita punya Alembic) dan scoped session yang selalu memfilter `owner_id`.

```
users              id, email, password_hash (argon2id), created_at
owners             id, user_id            -- pemisahan akun vs tenant, biar RBAC nanti gampang

agents             id, owner_id, name, system_prompt, llm_model, temperature,
                   max_tokens, tts_provider, tts_voice, emotion_level,
                   tools_enabled (jsonb), memory_enabled,
                   chat_log_level (0=off, 1=teks, 2=teks+audio),
                   created_at, updated_at
agent_snapshots    id, agent_id, owner_id, config (jsonb), created_at

devices            id, owner_id, agent_id, device_id (MAC, unik), client_id,
                   alias, board, firmware_version, token_hash,
                   last_seen_at, created_at
activation_codes   id, code (unik), device_id, client_id, expires_at, claimed_at

provider_creds     id, owner_id, kind (llm|stt|tts|search|vision),
                   provider_code, config (jsonb), secret_encrypted,
                   secret_last4, fallback_of, created_at

conversations      id, owner_id, device_id, agent_id, session_id, title, started_at
messages           id, owner_id, conversation_id, role, text,
                   provider_used (jsonb), latency_ms (jsonb),
                   audio_path, created_at
memories           id, owner_id, agent_id, kind (fact|summary), content,
                   source_message_id, created_at
```

Catatan desain, masing-masing punya alasan:

- **`chat_log_level` per agent** (0/1/2) — dipinjam dari proyek pembanding. Satu kolom menyelesaikan privasi dan konsumsi storage sekaligus.
- **`agent_snapshots`** — versi konfigurasi agent. Murah, dan menyelamatkan saat prompt yang tadinya bagus jadi rusak.
- **Audio di filesystem (`audio_path`), bukan BLOB di database.** Proyek pembanding menyimpan Opus sebagai LONGBLOB dan menyesalinya.
- **`activation_codes` di Postgres dengan `expires_at`**, bukan di cache. Proyek pembanding menaruhnya di Redis saja; Valkey nanti untuk cache dan pub/sub, bukan sumber kebenaran.
- **`secret_last4`** disimpan terpisah supaya UI bisa menampilkan ekor key tanpa pernah mendekripsi.
- **`provider_creds.config` jsonb + skema form per provider.** Ini pola terbaik yang layak dicontek: definisi field provider disimpan sebagai skema, UI merender formnya otomatis. Menambah provider tidak perlu menyentuh frontend.
- **Semua timestamp UTC**, konversi di UI. Proyek pembanding kena bug device tampak selamanya offline gara-gara campur timezone.

---

## 7. Anggaran latensi

Target mulut-ke-telinga di bawah 2.5 detik. Patokan dari proyek pembanding: 100 device di 8 core / 8 GB, rata-rata 1.837 detik, puncak CPU 80%.

| Tahap | Anggaran | Catatan |
|---|---|---|
| Endpoint VAD | 500–700 ms | Ini pajak yang tidak bisa dihindari karena device tidak mengabari akhir bicara |
| STT | 400–600 ms | Groq turbo cepat; faster-whisper lokal tergantung mesin |
| Search (kondisional) | 800–1000 ms | Batasi 3 hasil, potong pendek |
| LLM | 600–900 ms | Batas token rendah bukan pelit, itu demi latensi |
| TTS frame pertama | 200–300 ms | Streaming, jangan tunggu kalimat selesai |

Dua hal yang paling berpengaruh: **stream TTS per kalimat** (kirim `sentence_start` lalu audionya sambil LLM masih menulis sisanya), dan **hening VAD jangan terlalu longgar**.

---

## 8. Keamanan

- **Key BYOK** dienkripsi sebelum masuk DB, kunci utama disimpan di luar DB (env/file, bukan tabel). Setelah tersimpan tidak pernah dikirim balik ke browser — hanya `secret_last4`.
- **Token device** disimpan sebagai hash, bukan plaintext. Dikirim ke device sekali lewat `websocket.token` di respons OTA.
- **Filter tool MCP** — allowlist, bukan blocklist. Lihat §5.
- **Scoping tenant** di lapisan session/repository, bukan diserahkan ke pemanggil. Satu tempat yang salah = kebocoran lintas akun.
- **Timeout di setiap panggilan keluar** — LLM, STT, TTS, search, dan `tools/call` ke device.
- **Audio percakapan rumah** adalah data paling sensitif di sistem ini. Retensi audio berbatas (usul: 30 hari), dan izin memutar audio dipisah dari izin membaca transkrip.

---

## 9. Fase dan urutan kerja

### Fase 1 — voice loop inti

1. Init project: `pyproject.toml`, struktur folder, Docker Compose (app + Postgres), Alembic.
2. Endpoint OTA `check_version` + `/activate`: semantik 202/200, `websocket` config, `server_time`. Uji dengan device sungguhan lewat `idf.py monitor`.
3. Handshake WebSocket: balas hello dengan `transport`, `session_id`, `audio_params` 24000/60 dalam 10 detik.
4. Adapter LLM → omnirouter (paling mudah, `openai` client).
5. Adapter STT (Groq Whisper) + **`endpointer.py`** — audio Opus masuk, teks keluar.
6. Adapter TTS (Piper) + **`pacer.py`** — teks masuk, Opus keluar seirama waktu nyata.
7. Sambung end-to-end: device bicara → bridge → device menjawab. Termasuk penanganan `abort`.
8. Adapter Search + tool-call kondisional.
9. Postgres: simpan setiap turn, hormati `chat_log_level`.

**Kriteria lulus Fase 1:** device baru bisa diklaim dengan kode di layarnya, voice loop dua arah jalan, pertanyaan info terkini memicu search, dan p50 mulut-ke-telinga di bawah 2.5 detik.

### Fase 2 — kontrol device + dashboard

10. MCP: `initialize` → `tools/list` (dengan paginasi berbasis nama) → ekspos ke LLM lewat allowlist → `tools/call` dengan timeout.
11. REST API + auth dasar (satu owner yang di-seed).
12. Dashboard React: tujuh layar sesuai [dokumen tampilan](2026-09-10-zora-bridge-ui-design.md).
13. Live monitor: WebSocket browser + bus.

### Fase 3 — RBAC

14. Tabel `roles`, `memberships`, undangan, penegakan izin, matriks tiga peran.

---

## 10. Risiko dan yang belum diputuskan

| Hal | Status | Rencana |
|---|---|---|
| Wake word Indonesia | **Terhalang** — WakeNet hanya punya frasa Mandarin/Inggris terlatih; kustom butuh pelatihan komersial | Pakai frasa bawaan atau push-to-talk. Jangan janjikan di UI |
| Ping/keepalive | **Konflik antar sumber** (§4.8) | `ping_interval=None`, verifikasi dengan device sungguhan |
| Lisensi edge-tts | GPL-3.0 | Piper jadi default; edge-tts hanya lewat subprocess kalau memang mau |
| Suara Indonesia Piper | Hanya satu (`id_ID-news_tts-medium`) | Terima dulu; evaluasi opsi lain kalau kualitasnya kurang |
| Ambang VAD | Belum disetel | Mulai 700–1000 ms hening, tuning dengan device sungguhan |
| Provider search final | Belum diputuskan | SearXNG self-host sebagai default nol biaya; Tavily/Brave sebagai adapter BYOK |
| Batas satu worker | Diketahui | Catat di README; ganti `bus.py` ke Valkey saat perlu multi-worker |
| STT Indonesia | Pilihan sempit | SenseVoice/FunASR tidak mendukung Indonesia, Vosk tidak punya model Indonesia. Realistis: Whisper (lokal) atau Groq (API) |
