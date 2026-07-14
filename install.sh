#!/bin/bash
# MEXC P2P Dashboard — one-time setup (macOS / Linux)
set -e
cd "$(dirname "$0")"

echo "===================================="
echo "  MEXC P2P Dashboard — Install"
echo "===================================="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found."
  echo "Install the LTS version from https://nodejs.org (double-click the .pkg),"
  echo "then run this script again:  bash install.sh"
  exit 1
fi
echo "Node.js: $(node -v)"
echo "npm:     $(npm -v)"

echo
echo "[1/2] Installing backend..."
( cd backend && npm install )

echo
echo "[2/2] Installing frontend..."
( cd frontend && npm install )

echo
echo "Done. Start the app with:  bash start.sh"
