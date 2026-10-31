#!/usr/bin/env bash
# AutoCast installer for Ubuntu/Debian VPS. Safe to run again.
#   PUBLIC_URL=https://cast.yourdomain.com ./install.sh            # behind your own nginx/Caddy
#   PUBLIC_URL=https://cast.yourdomain.com WITH_CADDY=1 ./install.sh  # use bundled Caddy for HTTPS
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^AUTOCAST_SECRET=.*|AUTOCAST_SECRET=$(openssl rand -hex 32)|" .env
  echo "Made .env with a new secret."
fi
if [ -n "${PUBLIC_URL:-}" ]; then
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=${PUBLIC_URL}|" .env
  host="${PUBLIC_URL#https://}"; host="${host%%/*}"
  sed -i "s|^cast.example.com {|${host} {|" Caddyfile
fi

mkdir -p data/watch
# The container runs as user "node" (uid 1000).
chown -R 1000:1000 data 2>/dev/null || true

if [ "${WITH_CADDY:-0}" = "1" ]; then
  docker compose --profile caddy up -d --build
else
  docker compose up -d --build
fi

echo
echo "AutoCast is running on 127.0.0.1:7676."
echo "Open $(grep ^PUBLIC_URL .env | cut -d= -f2) and make your password."
echo "Videos you drop in $(pwd)/data/watch/<folder> can be picked up by autopilot rules (/data/watch/<folder> inside the app)."
