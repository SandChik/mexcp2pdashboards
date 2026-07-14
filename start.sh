#!/bin/bash
# MEXC P2P Dashboard — start backend + frontend (macOS / Linux)
cd "$(dirname "$0")"

if [ ! -d backend/node_modules ] || [ ! -d frontend/node_modules ]; then
  echo "Not installed yet. Run:  bash install.sh"
  exit 1
fi

echo "Starting backend on http://127.0.0.1:3001 ..."
( cd backend && npm start ) &
BACKEND_PID=$!

# Stop the backend whenever this script exits (e.g. Ctrl+C on the frontend)
trap 'echo; echo "Stopping..."; kill $BACKEND_PID 2>/dev/null; exit 0' INT TERM EXIT

sleep 3
( sleep 3 && open http://localhost:3000 >/dev/null 2>&1 ) &

echo "Starting frontend on http://localhost:3000 ..."
echo "Press Ctrl+C here to stop BOTH backend and frontend."
( cd frontend && npm run dev )
