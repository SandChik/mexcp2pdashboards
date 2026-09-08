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
  Konfirmasi langsung dari baris) + iklan (baca saja).
- **Antrian** (`/queue`) — order kedua platform dalam satu daftar, tiap baris
  berlabel MEXC / BingX.
- Yang **belum** ada untuk BingX: chat di dashboard, auto-reply, kelola iklan,
  Catatan Buyer / FTD / UU. Worker auto-reply & capture sengaja melewati
  merchant BingX sampai jalurnya ada.

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
