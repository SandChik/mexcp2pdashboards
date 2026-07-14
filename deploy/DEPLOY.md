# Deploy ke VPS Ubuntu — auto-deploy dari GitHub + akses via Tailscale

Alur kerja setelah setup: **edit kode → `git push` → 2-3 menit kemudian VPS
sudah menjalankan versi baru.** Tidak ada upload manual lagi.

Arsitektur:
- Satu proses Node (port 3001) menyajikan backend + frontend + worker capture 24/7.
- GitHub Actions men-sync kode via rsync/SSH ke user `deployer` (hak terbatas),
  lalu build & restart. VPS TIDAK menyimpan kredensial GitHub apa pun.
- Data runtime (`backend/data/`, berisi API key terenkripsi, FTD, catatan buyer)
  di-gitignore dan DILINDUNGI dari rsync — tidak pernah ikut ke GitHub, tidak
  pernah tertimpa deploy.
- Akses dashboard HANYA lewat Tailscale. Port 3001 tidak pernah terbuka publik.

> **Soal "localhost":** default aplikasi memang bind ke `127.0.0.1` — itu
> pengaman untuk pemakaian di PC lokal. Di VPS, unit systemd meng-override ke
> `HOST=0.0.0.0`, dan firewall membatasi aksesnya ke interface Tailscale saja.
> Anda membuka dashboard lewat `http://<ip-tailscale>:3001`, bukan localhost.

> **PERINGATAN:** repo GitHub **WAJIB Private**. Jangan pernah commit isi
> `backend/data/` (sudah diblokir .gitignore — jangan di-force).

---

## SETUP SEKALI SAJA

### A. Push kode ke GitHub (di laptop)

1. Buat repo **Private** baru di github.com, misal `mexc-dashboard`.
2. Di folder project:
   ```bash
   git init
   git add .
   git commit -m "v34 initial"
   git branch -M main
   git remote add origin git@github.com:USERNAME/mexc-dashboard.git
   git push -u origin main
   ```
   (Deploy pertama akan GAGAL di tahap SSH — wajar, secrets belum diisi. Lanjut.)

### B. Siapkan VPS (SSH sebagai root)

```bash
# upload script setup (hanya sekali; selanjutnya semua via git push):
scp deploy/setup-vps.sh root@IP_VPS:/root/
ssh root@IP_VPS
bash /root/setup-vps.sh
```

Script menyiapkan: Node 20, user `mexc` (servis) + `deployer` (penerima kode,
sudo terbatas hanya restart service), keypair SSH untuk GitHub, systemd unit,
ufw (deny semua kecuali SSH + Tailscale), dan Tailscale.

Lalu aktifkan Tailscale:
```bash
tailscale up          # buka link, login
tailscale ip -4       # catat IP 100.x.x.x
```

### C. Isi GitHub Secrets

Di repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Isi |
|---|---|
| `VPS_HOST` | IP publik VPS |
| `VPS_SSH_KEY` | Seluruh output dari `cat /home/deployer/.ssh/id_deploy` (private key, termasuk baris BEGIN/END) |
| `VPS_PORT` | (opsional) kalau SSH bukan port 22 |

### D. Deploy pertama

Di GitHub → tab **Actions** → workflow "Deploy to VPS" → **Run workflow**
(atau push commit apa pun ke `main`). Tunggu hijau (±2-3 menit; step terakhir
health-check — kalau service tidak sehat, deploy dinyatakan GAGAL dan log
service tercetak di output Actions).

### E. Buka & inisialisasi

Dari laptop/HP dengan Tailscale aktif: `http://<ip-tailscale>:3001`
→ buat password → Settings → tambah merchant (API key & secret diinput di sini,
tersimpan terenkripsi di VPS, tidak pernah menyentuh GitHub).

Uji keamanan: dari device TANPA Tailscale, `http://IP_PUBLIK:3001` harus
gagal/timeout.

---

## RUTINITAS UPDATE (sesudah setup)

```bash
git add .
git commit -m "ubah X"
git push
```
Selesai. Data di server tidak tersentuh. Rollback = `git revert <commit>` lalu
push — Actions men-deploy versi lama.

---

## Operasional

- Log live: `ssh root@IP_VPS journalctl -u mexc-dashboard -f`
- Restart manual: `systemctl restart mexc-dashboard`
- Matikan worker 24/7: tambah `Environment=CAPTURE_WORKER=0` di
  `/etc/systemd/system/mexc-dashboard.service` → `systemctl daemon-reload && systemctl restart mexc-dashboard`
- **Backup (wajib dua-duanya):** `/opt/mexc-dashboard/backend/data/` DAN
  `/home/mexc/.mexc-dashboard/` (kunci enkripsi — tanpa ini backup data tak
  bisa dibaca). Cron harian:
  ```
  0 3 * * * tar czf /root/mexc-backup-$(date +\%F).tar.gz /opt/mexc-dashboard/backend/data /home/mexc/.mexc-dashboard
  ```

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Actions gagal di "Sync code" | `VPS_SSH_KEY` salah/terpotong (harus utuh dengan BEGIN/END), `VPS_HOST` keliru, atau ufw memblokir SSH (`ufw status` → OpenSSH harus ALLOW). |
| Actions gagal di health check | Lihat log yang tercetak di output Actions; biasanya dependency/build error. Perbaiki, push lagi. |
| Halaman kosong setelah deploy | Build frontend gagal — cek step "Build & restart" di Actions. |
| Tidak bisa akses dari HP | Tailscale mati di HP, atau `tailscale status` di VPS offline. |
| Worker log 401/403 | API key merchant salah atau izin P2P belum aktif di akun MEXC. |
| Signature ditolak / order kosong | Jam VPS melenceng: `timedatectl set-ntp true`. |
| Lupa password dashboard | Stop service, edit `backend/data/config.json` → kembalikan `appPassword` ke `"$2a$10$defaultHashedPasswordChangeMe"`, start, setup ulang. |

## Batas yang tetap berlaku

Auto-reply, suara notifikasi, dan tombol aksi (release/confirm/pause) berjalan
di browser yang terbuka. Yang otonom di server: worker capture FTD + Catatan
Buyer. Jangan pernah memasang Nginx/port publik di depan aplikasi ini tanpa
membicarakan proteksinya dulu.
