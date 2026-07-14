#!/usr/bin/env bash
# One-shot VPS preparation for MEXC P2P Dashboard (Ubuntu 22.04/24.04, run as root).
# Idempotent — safe to re-run. Supports BOTH flows:
#   • GitHub auto-deploy: run this on a bare VPS, then push to main — the
#     first push delivers the code.
#   • Manual upload: put the project at /opt/mexc-dashboard first, then run this.
set -euo pipefail

APP_DIR=/opt/mexc-dashboard
SERVICE_SRC_URL_NOTE="deploy/mexc-dashboard.service inside the repo"

echo "==> 1/7 Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3 | tr -d .)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y rsync curl >/dev/null
node -v

echo "==> 2/7 Users"
# mexc  = runs the service, owns runtime data + encryption keys (no login shell)
# deployer = receives code from GitHub Actions, limited sudo (restart only)
id mexc     >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin mexc
id deployer >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deployer

echo "==> 3/7 App directory & data ownership"
mkdir -p "$APP_DIR/backend/data"
chown -R deployer:deployer "$APP_DIR"        # code tree belongs to deployer
chown -R mexc:mexc "$APP_DIR/backend/data"   # runtime data belongs to the service
chmod 750 "$APP_DIR/backend/data"

echo "==> 4/7 Deploy SSH key for GitHub Actions"
if [ ! -f /home/deployer/.ssh/id_deploy ]; then
  sudo -u deployer mkdir -p /home/deployer/.ssh
  sudo -u deployer ssh-keygen -t ed25519 -N '' -C 'github-actions-deploy' -f /home/deployer/.ssh/id_deploy
  sudo -u deployer bash -c 'cat /home/deployer/.ssh/id_deploy.pub >> /home/deployer/.ssh/authorized_keys'
  chmod 700 /home/deployer/.ssh; chmod 600 /home/deployer/.ssh/authorized_keys
  chown -R deployer:deployer /home/deployer/.ssh
fi

echo "==> 5/7 Limited sudo for deployer (restart + read logs, nothing else)"
cat > /etc/sudoers.d/mexc-deploy <<'SUDO'
deployer ALL=(root) NOPASSWD: /usr/bin/systemctl restart mexc-dashboard, /usr/bin/journalctl -u mexc-dashboard *
SUDO
chmod 440 /etc/sudoers.d/mexc-deploy

echo "==> 6/7 systemd service"
if [ -f "$APP_DIR/deploy/mexc-dashboard.service" ]; then
  cp "$APP_DIR/deploy/mexc-dashboard.service" /etc/systemd/system/mexc-dashboard.service
else
  # Bare-VPS GitHub flow: code arrives with the first push; install a unit now
  # so the service starts automatically the moment remote-deploy.sh restarts it.
  cat > /etc/systemd/system/mexc-dashboard.service <<'UNIT'
[Unit]
Description=MEXC P2P Dashboard
After=network-online.target tailscaled.service
Wants=network-online.target
[Service]
Type=simple
User=mexc
WorkingDirectory=/opt/mexc-dashboard/backend
Environment=PORT=3001
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
fi
systemctl daemon-reload
systemctl enable mexc-dashboard
# Start only if code is already present (manual-upload flow); in the GitHub
# flow the first deploy will build then restart it.
if [ -f "$APP_DIR/backend/server.js" ] && [ -d "$APP_DIR/backend/node_modules" ]; then
  systemctl restart mexc-dashboard
fi

echo "==> 7/7 Firewall + Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH            # needed by GitHub Actions (rsync/ssh) & you
ufw allow in on tailscale0   # dashboard access ONLY via Tailscale
ufw --force enable
ufw status verbose

echo ""
echo "════════════════════════════════════════════════════════════════"
echo " SETUP SELESAI. Berikutnya:"
echo "  1. tailscale up            → login, lalu: tailscale ip -4"
echo "  2. PRIVATE KEY untuk GitHub secret VPS_SSH_KEY:"
echo "     cat /home/deployer/.ssh/id_deploy"
echo "     (salin SELURUH isinya ke GitHub → Settings → Secrets → Actions)"
echo "  3. Tambah secret VPS_HOST = IP publik VPS ini"
echo "  4. git push ke main → deploy pertama jalan otomatis"
echo "  5. Buka http://<tailscale-ip>:3001 dari device ber-Tailscale"
echo "════════════════════════════════════════════════════════════════"
