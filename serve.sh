#!/usr/bin/env bash
# Local preview for UNCmap. Serves docs/ on the given port (default 8765).
# Binds 0.0.0.0 so it is reachable over your local network / VPN.
# Usage: ./serve.sh [port]      (BIND=127.0.0.1 ./serve.sh for localhost only)
set -e
PORT="${1:-8765}"
BIND="${BIND:-0.0.0.0}"
DIR="$(cd "$(dirname "$0")/docs" && pwd)"
echo "UNCmap preview → http://127.0.0.1:${PORT}/   (serving ${DIR}, bound ${BIND}:${PORT})"
echo "Ctrl-C to stop."
exec python3 -m http.server "$PORT" --bind "$BIND" --directory "$DIR"
