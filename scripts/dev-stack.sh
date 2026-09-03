#!/usr/bin/env bash
# Launch the full BDAi dev stack — web (Vite), functions API, and the local GPU
# SynthID service — each DETACHED (nohup) so they survive terminal/session exit.
# Idempotent: a service already listening on its port is left alone.
#
# Run via:  npm run dev:full        (from BDAiAgency/)
#       or:  ./dev.sh               (from the BRANDDAI/ parent folder)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$SCRIPT_DIR/.." && pwd)"   # scripts/ lives under BDAiAgency/
cd "$APP"

start() {  # name  port  command  logfile
  local name="$1" port="$2" cmd="$3" log="$4"
  if lsof -ti "tcp:$port" >/dev/null 2>&1; then
    echo "  ✓ $name (:$port) already running — leaving it"
  else
    nohup bash -lc "cd '$APP' && $cmd" > "$log" 2>&1 < /dev/null & disown
    echo "  ▶ $name (:$port) started — log: $log"
  fi
}

echo "Starting BDAi dev stack…"
start "web"          3000 "npm run dev"          /tmp/bdai-web.log
start "API"          3001 "npm run dev:server"   /tmp/bdai-devserver.log
start "GPU SynthID"  8765 "npm run synthid:local" /tmp/synthid-local-server.log

echo ""
echo "Waiting for the API (needed for generation)…"
for _ in $(seq 1 20); do
  if curl -s -m 2 http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "  ✓ API ready"; break
  fi
  sleep 2
done

echo ""
echo "Stack:"
echo "  web   → http://localhost:3000"
echo "  API   → http://localhost:3001   (generation, watermark removal)"
echo "  GPU   → http://127.0.0.1:8765    (invisible removal; ~1 min to load models)"
echo ""
echo "Tail logs:  tail -f /tmp/bdai-web.log /tmp/bdai-devserver.log /tmp/synthid-local-server.log"
echo "Stop all:   pkill -f 'vite|dev-server.ts|local_server.py'"
