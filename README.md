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

## Deploy ke VPS
Lihat panduan lengkap di `deploy/DEPLOY.md` (Tailscale + systemd + worker capture 24/7).

## Port yang Digunakan
- Backend: http://localhost:3001
- Frontend: http://localhost:3000
