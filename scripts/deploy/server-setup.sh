#!/usr/bin/env bash
# One-time setup on the VPS for the Docker deploy. Run as root:
#   sudo bash server-setup.sh "ssh-ed25519 AAAA... deploy"
# The argument is the PUBLIC deploy key. It creates the deploy user (member of the docker group),
# the deploy folder and its .env. Docker itself and the Cloudflare Tunnel are set up separately:
# see docs/deploy-vps.md.
set -euo pipefail

APP_USER="bida"
APP_ROOT="/srv/bida"
PUBKEY="${1:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi
if [ -z "$PUBKEY" ]; then
  echo "Usage: sudo bash server-setup.sh \"<public deploy key>\"" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with the compose plugin is required. Install it first, see docs/deploy-vps.md." >&2
  exit 1
fi

# deploy user. Membership of the docker group is root-equivalent on this host: keep its SSH key private.
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
fi
usermod -aG docker "$APP_USER"

install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$APP_ROOT"

# deploy key
SSH_DIR="$(getent passwd "$APP_USER" | cut -d: -f6)/.ssh"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$SSH_DIR"
touch "$SSH_DIR/authorized_keys"
grep -qxF "$PUBKEY" "$SSH_DIR/authorized_keys" || echo "$PUBKEY" >> "$SSH_DIR/authorized_keys"
chown "$APP_USER:$APP_USER" "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"

# environment file read by docker compose (edit ALLOWED_ORIGINS / TUNNEL_TOKEN afterwards)
if [ ! -f "$APP_ROOT/.env" ]; then
  cat > "$APP_ROOT/.env" <<'EOF'
PORT=28787
ALLOWED_ORIGINS=
GA_MEASUREMENT_ID=
TUNNEL_TOKEN=
EOF
  chown "$APP_USER:$APP_USER" "$APP_ROOT/.env"
  chmod 600 "$APP_ROOT/.env"
fi

echo "Done. Next: edit $APP_ROOT/.env, point the Cloudflare Tunnel at the app, then run the first deploy."
