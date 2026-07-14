#!/usr/bin/env bash
# Runs ON the VPS as user `deployer` (invoked by GitHub Actions after rsync,
# or manually: bash /opt/mexc-dashboard/deploy/remote-deploy.sh).
set -euo pipefail
APP=/opt/mexc-dashboard

echo "==> deps (backend, prod only)"
cd "$APP/backend" && npm ci --omit=dev

echo "==> build frontend"
cd "$APP/frontend" && npm ci && npm run build

echo "==> restart service"
sudo /usr/bin/systemctl restart mexc-dashboard
sleep 3

echo "==> health check"
if curl -fsS http://127.0.0.1:3001/health >/dev/null; then
  echo "DEPLOY OK — $(date)"
else
  echo "DEPLOY FAILED: service unhealthy. Logs:"
  sudo /usr/bin/journalctl -u mexc-dashboard -n 30 --no-pager || true
  exit 1
fi
