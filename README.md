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

## Deploy ke VPS
Lihat panduan lengkap di `deploy/DEPLOY.md` (Tailscale + systemd + worker capture 24/7).

## Port yang Digunakan
- Backend: http://localhost:3001
- Frontend: http://localhost:3000
