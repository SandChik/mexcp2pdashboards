# MEXC P2P Dashboard

Aplikasi dashboard untuk mengelola beberapa merchant MEXC P2P dalam satu tampilan.

## Fitur
- Monitor order dari beberapa merchant sekaligus
- Kelola iklan (buat, update, tutup)
- Chat real-time dengan counterpart
- Konfirmasi pembayaran & release coin
- Buka/tutup layanan merchant
- Auto-refresh setiap 30 detik

## Cara Setup (Pertama Kali)

### 1. Pastikan Node.js sudah terinstall
```
node -v
```

### 2. Install dependencies
Double-click **INSTALL.bat** atau jalankan di terminal:
```
cd backend && npm install
cd ../frontend && npm install
```

### 3. Jalankan aplikasi
Double-click **START.bat**

Atau jalankan manual (2 terminal terpisah):
```
# Terminal 1 - Backend
cd backend
npm start

# Terminal 2 - Frontend  
cd frontend
npm run dev
```

### 4. Buka browser
```
http://localhost:3000
```

### 5. Setup pertama kali
- Buat password untuk masuk ke dashboard
- Pergi ke Settings → Add Merchant
- Masukkan nama, API Key, dan API Secret untuk setiap merchant

## Cara Mendapatkan API Key MEXC
1. Login ke https://mexc.com
2. Pergi ke User Center → API Management
3. Buat API Key baru
4. Aktifkan permission untuk P2P/Fiat

## Struktur File
```
mexc-dashboard/
├── backend/          - Node.js Express server
├── frontend/         - React web app
├── INSTALL.bat       - Script instalasi
├── START.bat         - Script menjalankan app
└── README.md
```

## BingX P2P

Sejak v61 dashboard mengenal dua platform. Tiap merchant punya `platform`
(`mexc` untuk semua merchant lama, `bingx` untuk yang ditambah lewat
Settings → pilih BingX). Batas: 5 merchant MEXC + 2 merchant BingX.

- **Dashboard MEXC** (`/`) — tidak berubah.
- **Dashboard BingX** (`/bingx`) — panel per merchant: order (aksi Release /
  Konfirmasi langsung dari baris) + iklan: ubah harga cepat, tayang/turunkan,
  Jeda semua (menu ⋮), edit & buat iklan (v62; v64: saldo fund account
  ditampilkan di panel & form iklan, tombol Max, isian jumlah default = saldo,
  satu rekening per jenis sesuai aturan BingX) + chat per order (v63: BingX
  tidak punya WebSocket, riwayat di-poll tiap 3 detik lewat `im/group/msgList`,
  kirim teks `im/sendMsg`, gambar lewat presigned PUT `file/uploadUrl`).
- **Antrian** (`/queue`) — order kedua platform dalam satu daftar, tiap baris
  berlabel MEXC / BingX. Daftar merchant dibaca ulang tiap menit dan segera
  setelah Settings berubah (v62). v65: poll 5 detik (sama dengan panel), dan
  bukan cuma poll — tiap perubahan yang dilihat panel serta tiap aksi yang
  berhasil (dari panel, modal, atau Antrian) langsung mendorong Antrian
  memperbarui diri; aksi juga diterapkan lokal seketika dan dilindungi 20 detik
  dari snapshot bursa yang masih ketinggalan.
- Auto-reply BingX (v66): worker server yang sama dengan MEXC — aturan &
  ledger klaim sama — mengirim lewat chat REST BingX; sebelum kirim, riwayat
  chat dibaca ulang supaya tidak dobel. v67: Settings → Pesan menampilkan
  status worker per merchant (siklus, order terlihat, aturan, kecocokan
  terakhir & hasilnya, error terakhir) — baca ini dulu sebelum menyimpulkan
  "auto-reply tidak jalan".
- Dashboard BingX v67: filter tanggal sama dengan MEXC (popover/sheet, preset,
  rentang khusus ≤ 8 hari) + preset event Senin→sekarang dan event minggu lalu
  (Senin s/d Minggu). Rentang > 3 hari membaca sampai 2.000 order.
- v68: daftar cepat BingX dibangun dari view "semua order" (`type=0`), bukan
  view "berjalan"/"selesai" yang terlihat tertinggal beberapa menit dari
  aplikasi. Refresh manual di Antrian (tombol / G) memaksa baca ulang tanpa
  cache 3 detik (`fresh=1`). Antrian: navigasi W/S, dialog konfirmasi
  dikendalikan keyboard (Enter = ya, Esc = batal), shortcut halaman tidak
  aktif saat dialog terbuka.
- v70: salin (rekening, nominal, no. order) bekerja juga saat dashboard dibuka
  lewat http:// (Tailscale/LAN) — `navigator.clipboard` hanya ada di HTTPS/
  localhost, jadi tombol salin dulu gagal diam-diam; sekarang ada jalur cadangan
  dan selalu ada notif berhasil/gagal. Nominal disalin sebagai angka bulat.
  ID metode MEXC 740 = Bank Mandiri.
- v69: **bug auto-reply yang sebenarnya.** Layar Settings menampilkan 5 aturan
  bawaan untuk merchant yang belum pernah menekan "Save rules", tapi worker
  membaca berkas mentah dan mendapat 0 aturan — jadi merchant baru (BingX)
  terlihat aktif tapi tidak pernah membalas. Defaults sekarang satu sumber
  (`utils/merchantSettings.js`) dan worker menjalankan persis yang ditampilkan.
- Yang **belum** ada untuk BingX: Catatan Buyer / FTD / UU. Worker capture
  sengaja melewati merchant BingX sampai jalurnya ada.
- Logo (v66): `frontend/public/brand/` — BingX & MEXC di panel, nav, dan judul;
  emblem SandChik di sidebar & judul dashboard.
- Antrian v66: panel MEXC dan BingX **mendorong** daftar ordernya langsung ke
  Antrian setiap kali memuat (tanpa permintaan kedua), dan order yang sudah
  pernah dilaporkan selesai tidak akan muncul lagi sebagai berjalan selama 10
  menit walau snapshot bursa sempat ketinggalan.

Cara kerja di belakang: `backend/utils/bingxApi.js` (tanda tangan + parser
aman angka 19 digit + gerbang 2 req/detik per merchant),
`backend/utils/bingxAdapter.js` (penerjemah ke bentuk order MEXC yang sudah
dipahami UI), `backend/utils/bingxOrders.js` (operasi). Route `/api/...`
tetap sama — yang membelokkan adalah `merchant.platform`.

Status order BingX → status dashboard: 1 → Belum bayar, 4 → Sudah bayar,
5 → Selesai, 2 → Dibatalkan, 3 → Timeout, 6 → **Banding** (status baru,
tidak pernah punya tombol aksi).

Env opsional:
- `BINGX_POST_MODE` = `json` (bawaan: semua parameter + timestamp + signature
  di dalam body JSON, sesuai pedoman resmi BingX) | `query` | `form`. Uji lewat
  Settings → merchant BingX → "+ uji POST (no-op)" atau
  `npm run bingx:probe -- --post-noop`.

Sebelum mengandalkan merchant BingX baru: Settings → **Tes koneksi**.
Skrip pemeriksa mandiri: `backend/scripts/bingx-probe.js`
(`BINGX_KEY=xxx BINGX_SECRET=yyy npm run bingx:probe` dari folder `backend`).
Key & secret hanya lewat environment — jangan ditulis ke file di repo.

## Notifikasi (v71)

Pemantau di server (`backend/utils/orderWatcher.js`, tiap 10 detik, memakai
cache yang sama dengan browser) mengubah perubahan order menjadi notifikasi:
order baru, buyer sudah bayar, pesan chat masuk, batal/timeout, banding /
status tak dikenal, selesai (mati bawaan). Diatur di Settings → Notifikasi.

Dua jalur:
- **Telegram bot** — tidak butuh HTTPS. Panduan bikin bot ada di layar
  Settings (BotFather → token → tekan Start di bot → "Deteksi" chat id).
- **Web Push (browser)** — notifikasi sistem di desktop & Android, iPhone hanya
  lewat Home Screen (Bagikan → Add to Home Screen, iOS 16.4+). **Wajib HTTPS.**
  Kunci VAPID dibuat otomatis di `~/.mexc-dashboard/vapid.json` (di luar repo),
  langganan perangkat di `backend/data/push-subscriptions.json`.

HTTPS termudah (tanpa domain), sekali saja di VPS:

```bash
# 1. di admin Tailscale: DNS → MagicDNS ON, HTTPS Certificates → Enable
# 2. di VPS:
sudo tailscale serve --bg 3001
tailscale serve status        # menampilkan https://<nama-mesin>.<tailnet>.ts.net
```

Buka dashboard lewat alamat `https://…ts.net` itu, lalu Settings → Notifikasi →
"Aktifkan di perangkat ini" (dari klik, browser akan minta izin). Alamat
`http://` lama tetap jalan untuk yang lain. Env: `NOTIFY_WATCHER=0` mematikan
pemantau, `NOTIFY_INTERVAL_MS` mengubah jaraknya (min 5000).

Status BingX yang tidak dikenal adapter (bukan 1/4/5/2/3/6) kini tampil
sebagai "Status ?" (state 10) dengan angka mentahnya, bukan hilang — supaya
banding yang dilaporkan BingX dengan kode lain tetap terlihat.

v72: Apple (iPhone) menolak JWT VAPID dengan `403 BadJwtToken` bila `sub`-nya
alamat mailto rekaan — sekarang tiap perangkat dikirimi `sub` = origin HTTPS
tempat ia mendaftar (mis. `https://vm-0-9-ubuntu.tail32cc17.ts.net`).
Perangkat yang mendaftar sebelum v72: Matikan lalu Aktifkan lagi sekali.
Env `NOTIFY_VAPID_SUBJECT` untuk memaksa nilai lain.

v73: pemantau notifikasi sempat buta terhadap MEXC — MEXC mengirim status
sebagai teks (`PAID`), BingX sebagai angka; `Number("PAID")` = NaN, jadi tidak
ada peristiwa MEXC yang terdeteksi. Diperbaiki dengan normalisasi yang sama
seperti worker lain. Isi notif diperkaya dari detail order (satu panggilan per
order, cache 15 menit): nama KYC, JUAL/BELI, nominal Rp + USDT, bank & nomor
rekening penerima (tap-to-copy di Telegram), nomor order.

## v74 — dari dokumentasi resmi MEXC (api-docs/p2p)

- **Banding MEXC** bukan status, tapi bendera: `complaining` (daftar) /
  `complained` (detail). Sekarang tampil sebagai lencana "⚠ Banding" di
  Antrian, panel, modal; bunyi + toast saat pertama terlihat; dialog Release
  memberi peringatan; notifikasi jenis "banding" ikut terpicu.
- Daftar cepat MEXC memakai endpoint **V2** (`…/order/paginationV2`, scroll
  pagination, membawa `complaining`); V1 hanya cadangan 10 menit bila V2 gagal.
- **Verifikasi tambahan** (`overVerify`): order yang menunggu persetujuan lo
  (`WAIT_PROCESS`) kini berlabel "Verifikasi" dengan teks "setujui/tolak di app
  MEXC", plus notifikasi jenis "verify". API MEXC belum punya aksi
  setuju/tolak — permintaan sudah dikirim ke MEXC.
- Form edit iklan MEXC punya bagian "Verifikasi tambahan buyer" (jenis dokumen,
  maks 3). MEXC tidak mengembalikan setelan ini lewat API, jadi dashboard
  mengingatnya per iklan (`backend/data/ad-verify.json`) dan mengirimnya ulang
  di setiap simpan — edit harga tidak lagi berisiko mematikan verifikasi.
- iPhone "Add to Home Screen": judul halaman tidak lagi tertutup status bar /
  Dynamic Island (safe-area di mode standalone).

v75 — riwayat BingX seminggu lalu tidak muncul. Dua sebab, dua perbaikan:
- Penelusuran halaman berhenti begitu satu halaman berisi kurang dari 100
  baris. Dokumen bilang pageSize maks 100, tapi kalau BingX diam-diam
  membatasi (mis. 20), penelusuran berhenti di halaman pertama dan riwayat
  lama tidak pernah terbaca. Sekarang dipandu `total` dari BingX, ukuran
  halaman menyesuaikan yang benar-benar dikembalikan, dedupe, batas 50 halaman.
- Panel bisa membuang permintaan "muat rentang" bila polling 5 detik sedang
  berjalan (`busyRef`), sehingga ganti tanggal kadang tidak memuat apa pun.
  Sekarang diantrekan, bukan dibuang (BingX dan MEXC).
Panel BingX menampilkan baris diagnostik: berapa order dibaca dari total,
order tertua yang dicapai, dan apakah batas halaman tercapai.

## v76 — akses publik (Funnel), username, satu panel untuk dua platform

- **Login pakai username + password.** Instalasi lama otomatis bernama
  `admin`; ganti di Settings → Akun (butuh password). Setup pertama kali
  meminta username. Password minimal 8 karakter.
- **Rem brute-force di login** (`utils/loginGuard.js`): 5 kali salah dari satu
  alamat IP → terkunci 15 menit; 30 kali salah dari mana pun → semua terkunci
  15 menit. Percobaan gagal dicatat di `backend/data/audit.log`
  (`auth_login_failed`, dengan IP). Server memakai `trust proxy = loopback`,
  jadi IP asli terbaca lewat `tailscale funnel`/`serve`/nginx di mesin yang sama,
  tanpa bisa dipalsukan dari luar. Env: `LOGIN_FAILS_PER_IP`, `LOGIN_FAILS_GLOBAL`,
  `LOGIN_WINDOW_MS`.
- **Tanpa VPN di HP:** `sudo tailscale serve --bg off && sudo tailscale funnel --bg 3001`
  membuat alamat `https://…ts.net` yang sama bisa diakses dari internet biasa —
  langganan push dan PWA tidak perlu dibuat ulang, Tailscale di HP boleh mati
  (app bank tidak terganggu). Konsekuensinya halaman login terbuka untuk
  publik: pakai password yang panjang, dan rem di atas yang menjaga.
- **Satu `MerchantPanel` untuk MEXC dan BingX** (`BingxPanel.jsx` dihapus).
  Tata letak, statistik, filter sisi/status, kartu order, tombol release, menu
  ⋮ (catat buyer, auto-reply, pause/resume) kini identik. Yang khusus BingX:
  sel "Saldo USDT", tombol "Iklan baru", ubah harga cepat di kartu iklan, baris
  diagnostik rentang. Yang khusus MEXC: "Close merchant (freeze API)" dan
  snapshot FTD. Setiap panel punya tombol refresh sendiri.
- **Metode bank di kartu order** (kedua platform): rekening penerima yang
  dipakai order — SELL = rekening kita yang dibayar buyer, BUY = rekening
  penjual. Diambil dari detail order dan di-cache bersama nama KYC
  (`uu-cache.json`, field `bank`); cache lama tanpa `bank` dibaca ulang sekali.
- **Catatan Buyer:** kolom "Metode" (nama bank) ikut dicatat, diekspor ke CSV,
  bisa diisi di entri manual dan impor (header `Metode`/`Bank`). Catat buyer
  kini **jalan juga untuk BingX** (worker 24/7 + panel), sehingga alert "nama
  sama" menangkap 1 KTP yang dipakai di MEXC dan BingX sekaligus.
- **Auto-reply "Verifikasi diterima"** — pilihan baru di dropdown status.
  Bukan status MEXC (enum `OrderDealState` tidak punya "verified"), melainkan
  perpindahan: order keluar dari `WAIT_PROCESS` ke status apa pun yang bukan
  gagal (biasanya `NOT_PAID`). Saat aturan ini kena, aturan "Belum bayar" untuk
  lompatan yang sama tidak ikut dikirim (tidak dobel). Panel status worker
  menampilkan 6 perpindahan status terakhir sebagai bukti alur sebenarnya.
- Notifikasi jenis baru **"Verifikasi diterima"** (`verified`, 2→0/3),
  default ON.
- Form login/Settings: 401 dari form (password salah) tidak lagi memuat ulang
  halaman — pesannya tampil.

## v77 — verifikasi tambahan MEXC ternyata hidup di chat, bukan di status

Diamati langsung (8 Okt 2026): order dengan verifikasi tambahan **tetap
NOT_PAID** sepanjang proses. MEXC menandai tahapannya lewat pesan sistem di
chat (`{"ext":{"operatorMsgKey":…}}`): `OVER_VERIFY_SEND_FILE_TIP` (buyer
mengunggah dokumen), `OVER_VERIFY_PASS_TIP` (disetujui), `OVER_VERIFY_FAIL_TIP`
(ditolak — order lalu menjadi CANCEL, bukan REFUSE). Pilihan "Verifikasi
diterima (keluar dari WAIT_PROCESS)" dari v76 karena itu tidak pernah kena.

- Worker auto-reply membaca riwayat chat order SELL yang masih berjalan
  (maks 10 per merchant per siklus, `conversationId` di-cache) dan mengenali
  pesan sistem itu (`utils/verifyChat.js`). Tiga pemicu di dropdown aturan:
  **"Verifikasi: buyer mengirim dokumen"**, **"Verifikasi diterima"**,
  **"Verifikasi ditolak"**. Dipicu oleh pesan chat, jadi jalan juga untuk order
  yang sudah ada saat server restart. Event yang sudah dipakai disimpan di
  `backend/data/verify-seen.json` (dipangkas 3 hari) supaya restart tidak
  mengulang.
- Notifikasi: "Buyer mengirim dokumen verifikasi" (`verify`, dulu menunggu
  status 2 yang tidak pernah datang), "Verifikasi diterima" (`verified`), dan
  baru **"Verifikasi ditolak"** (`verifyFailed`, default OFF) — dikirim dari
  worker begitu pesan sistemnya terlihat.
- Chat di dashboard: pesan sistem JSON itu kini tampil sebagai baris sistem
  yang terbaca ("📎 Buyer mengirim dokumen verifikasi", "✅ Verifikasi
  diterima", "⛔ Verifikasi ditolak"); kunci `OVER_VERIFY_*` lain tampil apa
  adanya agar varian baru langsung kelihatan.
- Panel status worker menampilkan "verifikasi terakhir: …" (order + jenis/kunci).
- Versi tampilan (`frontend/src/version.js`) ikut dinaikkan — v76 pertama
  lupa, sehingga panel Versi menampilkan v75/v76.

## Deploy ke VPS
Lihat panduan lengkap di `deploy/DEPLOY.md` (Tailscale + systemd + worker capture 24/7).

## Port yang Digunakan
- Backend: http://localhost:3001
- Frontend: http://localhost:3000
