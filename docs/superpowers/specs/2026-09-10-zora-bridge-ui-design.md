# Zora Bridge — Desain Tampilan (Web Dashboard)

Tanggal: 2026-09-10
Status: mockup tujuh layar sudah dibuat dan tersimpan sebagai canvas
Dokumen pasangan: [desain sistem](2026-09-10-zora-bridge-system-design.md)
Sumber mockup: [`design/`](../../../design/) — tujuh berkas `.dc.html` + `canvas.json`

---

## 1. Untuk siapa dan untuk apa

Dashboard ini dipakai pemilik device untuk tiga hal, berurutan sesuai seberapa sering:

1. **Memasang dan mengubah kepribadian agent** — ini yang paling sering disentuh setelah setup awal.
2. **Menjawab "kok begitu?"** — kenapa lambat, kenapa jawabannya salah, kenapa device diam. Ini yang dilayani Live Monitor dan Percakapan.
3. **Setup sekali jalan** — masukkan key provider, klaim device.

Konsekuensi desainnya: Agents mendapat ruang paling besar, halaman diagnostik menampilkan angka bukan status hijau/merah saja, dan halaman setup boleh padat karena hanya dilihat sesekali.

Semua teks antarmuka berbahasa Indonesia. Istilah teknis yang memang tidak punya padanan yang lazim (STT, TTS, token, firmware, MCP) dibiarkan apa adanya.

---

## 2. Arah visual

Tidak ada design system yang sudah ada di proyek ini, jadi arahnya dipilih sengaja: **"instrument panel"** — terasa seperti alat audio atau instrumen lab, karena yang dikendalikan memang perangkat suara fisik.

| Elemen | Nilai | Alasan |
|---|---|---|
| Latar | `#171614` (hitam kehangatan), permukaan `#1F1E1B`, garis `#302D28` | Gelap hangat, bukan abu biru; panel yang dilihat lama tidak melelahkan |
| Teks | utama `#F2EFE8`, sekunder `#A8A29A`, redup `#6E6A63` | Putih bernada hangat, saturasi rendah |
| Aksen | amber `#E8A33D`, mint `#4FC3A1` | Dua aksen berkecerahan setara, beda hue. Amber = perlu perhatian, mint = sehat |
| Bahaya | `#E4674F` | Hanya untuk tindakan merusak |
| Huruf UI | **Archivo** | Grotesk berkarakter, tetap tajam di ukuran kecil. Sengaja bukan Inter/Roboto |
| Huruf data | **IBM Plex Mono** | Semua angka, MAC address, ID, latensi, dan log |
| Sudut | 2–3 px | Tegas, bukan bulat lembut |
| Kepadatan | tinggi | Tabel dan baris rapat; ini alat kerja, bukan halaman marketing |

Aturan yang berlaku di semua layar: **angka selalu monospace**. Latensi, kuota, ID, dan MAC address harus bisa dibandingkan sekilas antar baris, dan itu hanya terjadi kalau lebarnya seragam.

---

## 3. Kerangka bersama

Semua layar memakai kerangka yang sama:

- **Sidebar 224 px** — merek di atas, navigasi berkelompok (INTI / PANTAU / AKUN), identitas pemilik dan versi build di bawah. Item aktif ditandai batang amber di kiri plus latar lebih terang. Item Fase 3 diberi lencana `F3`.
- **Topbar 60 px** — judul halaman, satu baris penjelas di bawahnya, dan status atau aksi utama di kanan.
- **Isi** — padding 20–22 px, grid 12–18 px antar kartu.

Navigasi sengaja hanya satu tingkat. Tujuh halaman tidak butuh menu bersarang, dan bersarang membuat orang kehilangan orientasi.

---

## 4. Tujuh layar dan fiturnya

### 4.1 Overview

Halaman pertama setelah masuk. Menjawab satu pertanyaan: ada yang perlu saya urus?

- Empat angka ringkas: device aktif (dengan total), turn hari ini, respons p50, turn gagal.
- **Strip pipeline adapter** — empat tahap (STT / LLM / TTS / Search) berjejer, masing-masing menampilkan provider aktif, latensi p50, dan kondisi kuota. Ini membuat arsitektur adapter kelihatan, bukan tersembunyi.
- Daftar device dengan status (bicara / idle / offline), kekuatan WiFi, baterai, dan agent yang terpasang.
- **Kolom "Perlu perhatian"** — setiap baris menyebut apa yang harus dilakukan, bukan sekadar memberi tahu ada masalah. "Kuota STT hampir habis — ganti ke faster-whisper lokal, atau perbarui key" lebih berguna daripada lencana merah.

### 4.2 Agents

Layar terbesar, dan memang seharusnya. Satu agent adalah satu kepribadian lengkap.

Kolom kiri: daftar agent dengan ringkasan (jumlah device, memori aktif). Kanan: editor bersekat.

- **Identitas & persona** — nama, wake word (baca-saja, berasal dari firmware), system prompt dengan pencacah karakter. Di bawah kotak prompt ada satu baris penjelas yang penting: jawaban dibacakan TTS, bukan dibaca, jadi prompt harus meminta keluaran pendek tanpa markdown. Itu bedanya terasa alami versus terasa robot.
- **Suara** — pemilih voice, tombol dengar contoh, dan tingkat ekspresi wajah di layar device (datar / sedang / ekspresif) yang memetakan `emotion` yang dikirim bridge.
- **Model** — LLM per agent, temperature, batas token balasan. Batas token diberi penjelas bahwa nilainya rendah demi latensi, bukan demi hemat.
- **Tools** — tiga sakelar: websearch, kontrol device (MCP), kamera. Masing-masing menampilkan jumlah pemakaian atau alasan kenapa belum bisa dipakai.
- **Peringatan tool berbahaya** — kotak khusus yang menyatakan `self.reboot` dan `self.upgrade_firmware` tidak pernah diekspos ke LLM. Ini bukan hiasan: firmware tetap mau mengeksekusinya kalau dipanggil, jadi penyaringnya di bridge, dan pemilik berhak tahu itu.
- **Memori jangka panjang** — sakelar, jumlah fakta dan ringkasan, dan daftar fakta yang **bisa dihapus satu per satu**. Ini data pribadi, bukan cache; menghapusnya harus semudah membacanya.

### 4.3 Providers & Keys

Tempat model BYOK menjadi nyata. Empat kartu: LLM, STT, TTS, Search.

- Pemilih provider per tahap, kolom konfigurasi yang berubah sesuai provider (dirender dari skema field, jadi menambah provider tidak perlu menyentuh frontend).
- **Key hanya ditampilkan empat karakter terakhir**, dengan tautan "Ganti". Setelah tersimpan, key tidak pernah dikirim balik ke browser.
- **Tombol tes koneksi dengan hasil sungguhan** — "14 model terbaca · 180 ms", bukan hanya tanda centang.
- **Fallback per tahap** — provider pengganti kalau yang utama gagal atau habis kuota, plus catatan berapa turn yang sudah jatuh ke fallback hari ini.
- **Lencana GRATIS versus TOKEN SENDIRI** di setiap kartu. Pemilik harus bisa melihat sekilas mana yang menagih. Kartu TTS dan Search sengaja default ke pilihan nol biaya.
- Kartu penutup menjelaskan cara key disimpan, dengan kalimat manusia, bukan jargon kriptografi.

### 4.4 Devices & Pairing

- **Panel klaim device** paling atas, dengan enam kotak kode dan penjelasan alurnya: nyalakan device, kode muncul di layarnya, masukkan di sini. Ditutup baris status yang memberi tahu ada device sedang menunggu diklaim beserta MAC-nya.
- Tabel device: nama, MAC, agent, versi firmware (versi lama diberi warna amber), status.
- Panel detail device terpilih: waktu klaim, Client-Id, ekor token, uptime sesi, dan **daftar tool MCP yang ditemukan otomatis** dari device. Tool berbahaya ditandai "khusus dashboard" supaya jelas kenapa tidak muncul di sisi LLM.
- Tindakan manual: pindah agent, kirim firmware, reboot, lepas dari akun. Yang merusak diberi warna bahaya dan disertai penjelasan konsekuensinya (melepas device menghapus token dan ikatan agent, tapi riwayat percakapan tetap ada).

### 4.5 Live Monitor

Satu-satunya fitur realtime yang masuk scope, dan yang paling menentukan apakah masalah bisa dijawab atau hanya ditebak.

- **Kartu turn berjalan** dengan transkrip yang tumbuh dan kursor di ujung balasan.
- **Waterfall waktu per tahap** — rekam, endpoint VAD, STT, search, LLM, TTS awal — masing-masing dengan batang proporsional dan angka. Ditutup satu angka **mulut-ke-telinga**, dihitung dari akhir bicara bukan awal rekam, karena itu yang dirasakan orang.
- Turn sebelumnya diringkas, termasuk panggilan MCP beserta argumen dan hasilnya.
- Turn gagal menampilkan galat provider apa adanya dan apa yang terjadi setelahnya ("jatuh ke faster-whisper, berhasil pada percobaan ke-2, +1.9 s").
- **Panel status sesi** — mesin state device (Idle → Listening → Speaking), mode listen dan status AEC, session id, **kedalaman antrean audio device (x / 20 frame)**, dan sisa idle timeout. Panel antrean ada karena kelebihan kirim dibuang diam-diam oleh device; tanpa angka ini, gejalanya tampak seperti "audio terpotong" tanpa sebab.
- **Log pesan protokol** dengan arah masuk/keluar, tipe pesan, dan frame biner yang diringkas jumlahnya.

### 4.6 Percakapan

- Pencarian teks penuh lewat Postgres, dengan potongan hasil yang menyorot kata kunci. Filter device dan rentang tanggal.
- Daftar percakapan berjudul otomatis, dengan device, agent, dan jumlah turn.
- Transkrip per turn menampilkan: teks, tombol putar audio dengan durasinya, **kutipan hasil websearch yang dipakai**, penanda saat memori disimpan, serta baris kecil berisi provider dan latensi tiap tahap plus totalnya.
- **Kontrol tingkat pencatatan per agent**: tidak dicatat / teks saja / teks + audio, ditampilkan sebagai tiga pilihan dengan konsekuensi masing-masing. Ditutup penjelasan retensi.
- Ekspor dan hapus per percakapan.

### 4.7 Users & Roles (Fase 3)

Dirancang sekarang, dikerjakan terakhir. Halaman ini diberi lencana "Fase 3 — dirancang, belum aktif" supaya tidak terlihat rusak.

- Catatan pembuka menjelaskan bahwa sampai fase ini dikerjakan sistem jalan dengan satu pemilik tunggal, dan bahwa bentuk datanya sudah disiapkan sehingga menyalakannya nanti tidak butuh migrasi.
- **Matriks izin** tiga peran (Owner / Operator / Viewer) terhadap delapan kemampuan.
- **Satu keputusan yang bukan detail sepele:** izin "baca transkrip" dipisah dari izin "putar ulang rekaman audio". Mendengar rekaman di dalam rumah orang berbeda tingkat dari membaca ringkasannya, dan Operator mendapat yang pertama tanpa yang kedua.
- Daftar anggota dengan peran, cakupan akses, dan undangan yang masih menunggu.
- Panel pendaftaran: sakelar pendaftaran terbuka (default mati, hanya lewat undangan), masa sesi, algoritma hash, dan status isolasi data.

---

## 5. Pola yang berlaku di semua layar

- **Setiap peringatan menyebutkan tindakannya.** Tidak ada lencana merah tanpa jalan keluar.
- **Setiap angka latensi menyebutkan providernya.** "720 ms" tidak berguna; "720 ms · sonnet-5" bisa ditindaklanjuti.
- **Setiap tindakan merusak menyebutkan apa yang hilang dan apa yang tetap ada.**
- **Nilai bawaan berpihak ke nol biaya.** TTS default Piper lokal, search default SearXNG self-host. Yang menagih harus dipilih sadar.
- **Batasan teknis dijelaskan di tempatnya**, bukan disembunyikan: antrean 20 frame, wake word baca-saja, batas token demi latensi. Pemilik yang paham batasannya tidak akan melaporkannya sebagai bug.

## 6. Status dan kondisi kosong yang harus dibuat

Mockup menampilkan kondisi normal. Sebelum implementasi selesai, tiap layar butuh:

| Layar | Kondisi yang belum digambar |
|---|---|
| Overview | Belum ada device sama sekali (arahkan langsung ke pairing) |
| Agents | Belum ada agent; prompt melewati batas karakter; gagal simpan |
| Providers | Belum ada key sama sekali; tes koneksi gagal dengan galat aslinya; key kedaluwarsa |
| Devices | Kode salah atau kedaluwarsa; device diklaim akun lain; firmware gagal terkirim |
| Live Monitor | Tidak ada device online; koneksi monitor terputus lalu tersambung lagi |
| Percakapan | Pencarian tanpa hasil; percakapan yang audionya sudah kena retensi |
| Users & Roles | Undangan kedaluwarsa; percobaan menurunkan peran diri sendiri |

## 7. Yang sengaja tidak dibuat

Ditawarkan dan ditolak, dicatat supaya tidak diusulkan ulang tanpa alasan baru:

- **Web chat playground** — mengobrol teks dengan agent dari browser.
- **Voice test dari browser** — menguji pipeline penuh lewat mic browser.
- **Panel kontrol device manual dari web** — intercom, kontrol LED, kirim gambar ke layar. Kontrol device tetap ada, tapi lewat suara (MCP), bukan tombol di web.
- **Knowledge base / RAG** per agent.
- **Penjadwal dan pengumuman proaktif** — walaupun firmware mendukungnya lewat pesan `notify`.
- **Custom tool / webhook** buatan user.

## 8. Catatan implementasi frontend

- React + Vite + Tailwind, SPA terpisah, REST + satu WebSocket untuk monitor.
- Dua huruf dari Google Fonts (Archivo, IBM Plex Mono) — sediakan tumpukan fallback yang metriknya dekat.
- Ikon digambar sebagai SVG inline bergaya garis pada grid 16/20 px. **Tidak ada emoji**, tidak ada ikon dari CDN.
- Tabel dan blok lebar harus punya wadah `overflow-x` sendiri; badan halaman tidak boleh menggeser horizontal.
- Warna didefinisikan sebagai token di satu tempat, bukan disebar sebagai nilai literal.
- Mockup dibuat pada lebar desktop 1440 px. Layout ponsel belum dirancang — kalau nanti perlu, sidebar jadi drawer dan grid empat kolom jatuh ke dua.
