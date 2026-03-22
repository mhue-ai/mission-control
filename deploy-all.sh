#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Mission Control — One-Shot Deploy
# 
# Run as your normal user (not root). It will sudo when needed.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mhue-ai/mission-control/main/deploy-all.sh | bash
#   OR
#   bash deploy-all.sh
#
# What it does:
#   1. Installs system packages (Node 22, Nginx, SQLite, PM2)
#   2. Clones the repo (or uses existing checkout)
#   3. Fixes permissions
#   4. Installs npm dependencies
#   5. Generates all secrets (.env)
#   6. Initializes the SQLite database
#   7. Builds the Next.js app
#   8. Configures Nginx with self-signed TLS
#   9. Sets up PM2 with auto-start on boot
#  10. Configures UFW firewall
#  11. Starts the application
#  12. Runs health check
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────
REPO_URL="https://github.com/mhue-ai/mission-control.git"
INSTALL_DIR="/opt/mission-control"
MC_PORT=3100
DOMAIN="${MC_DOMAIN:-$(hostname -I | awk '{print $1}')}"
DEPLOY_USER="$(whoami)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
step() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ─── Preflight ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🦞  OpenClaw Mission Control — One-Shot Deploy             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Target:  ${INSTALL_DIR}"
echo "║  User:    ${DEPLOY_USER}"
echo "║  Domain:  ${DOMAIN}"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [ "$EUID" -eq 0 ]; then
  err "Do not run this script as root. Run as your normal user — it will sudo when needed."
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════
step "1/11 — Installing system packages"
# ═══════════════════════════════════════════════════════════════════

sudo apt-get update -qq

# Node.js 22
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  log "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Node.js $(node -v) already installed"
fi

# System packages
sudo apt-get install -y -qq nginx sqlite3 openssl ufw curl git build-essential
log "System packages installed"

# PM2
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
  log "PM2 installed"
else
  log "PM2 already installed"
fi

# ═══════════════════════════════════════════════════════════════════
step "2/11 — Getting the code"
# ═══════════════════════════════════════════════════════════════════

if [ -d "${INSTALL_DIR}/.git" ]; then
  log "Repo already exists at ${INSTALL_DIR}, pulling latest..."
  sudo chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${INSTALL_DIR}
  cd ${INSTALL_DIR}
  git pull --ff-only || warn "Pull failed — using existing code"
elif [ -d "${INSTALL_DIR}/server.js" ] || [ -f "${INSTALL_DIR}/server.js" ]; then
  log "Code exists at ${INSTALL_DIR} (not a git repo)"
  sudo chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${INSTALL_DIR}
  cd ${INSTALL_DIR}
else
  log "Cloning from ${REPO_URL}..."
  sudo mkdir -p ${INSTALL_DIR}
  sudo chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${INSTALL_DIR}
  git clone ${REPO_URL} ${INSTALL_DIR}
  cd ${INSTALL_DIR}
fi

# ═══════════════════════════════════════════════════════════════════
step "3/11 — Fixing permissions"
# ═══════════════════════════════════════════════════════════════════

sudo chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${INSTALL_DIR}
mkdir -p ${INSTALL_DIR}/data
chmod +x ${INSTALL_DIR}/setup-server.sh ${INSTALL_DIR}/deploy-app.sh 2>/dev/null || true
chmod +x ${INSTALL_DIR}/scripts/prepare-gateway.sh 2>/dev/null || true
log "Permissions set for ${DEPLOY_USER}"

# ═══════════════════════════════════════════════════════════════════
step "4/11 — Installing npm dependencies"
# ═══════════════════════════════════════════════════════════════════

cd ${INSTALL_DIR}
npm install 2>&1 | tail -5
log "npm install complete ($(ls node_modules | wc -l) packages)"

# ═══════════════════════════════════════════════════════════════════
step "5/11 — Generating secrets and .env"
# ═══════════════════════════════════════════════════════════════════

if [ -f "${INSTALL_DIR}/.env" ]; then
  warn ".env already exists — skipping secret generation (delete .env to regenerate)"
else
  ADMIN_PASS=$(openssl rand -base64 16)
  JWT_SECRET=$(openssl rand -base64 32)
  VAULT_KEY=$(openssl rand -hex 32)
  AGENT_TOKEN=$(openssl rand -hex 24)

  cp ${INSTALL_DIR}/.env.example ${INSTALL_DIR}/.env

  # Inject secrets
  sed -i "s|MC_ADMIN_PASSWORD=CHANGE_ME_NOW|MC_ADMIN_PASSWORD=${ADMIN_PASS}|" .env
  sed -i "s|MC_JWT_SECRET=CHANGE_ME_GENERATE_WITH_OPENSSL_RAND|MC_JWT_SECRET=${JWT_SECRET}|" .env
  sed -i "s|MC_VAULT_KEY=CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32|MC_VAULT_KEY=${VAULT_KEY}|" .env
  sed -i "s|MC_AGENT_TOKEN=CHANGE_ME_GENERATE_AGENT_TOKEN|MC_AGENT_TOKEN=${AGENT_TOKEN}|" .env
  sed -i "s|MC_DOMAIN=mc.local|MC_DOMAIN=${DOMAIN}|" .env

  echo ""
  echo "  ╔═══════════════════════════════════════════════════════╗"
  echo "  ║  SAVE THESE CREDENTIALS — you won't see them again   ║"
  echo "  ╠═══════════════════════════════════════════════════════╣"
  echo "  ║  Admin password:  ${ADMIN_PASS}"
  echo "  ║  JWT secret:      (stored in .env)"
  echo "  ║  Vault key:       (stored in .env)"
  echo "  ║  Agent token:     ${AGENT_TOKEN}"
  echo "  ╚═══════════════════════════════════════════════════════╝"
  echo ""

  log ".env created with generated secrets"
fi

# ═══════════════════════════════════════════════════════════════════
step "6/11 — Initializing database"
# ═══════════════════════════════════════════════════════════════════

cd ${INSTALL_DIR}
node scripts/setup-db.js
log "SQLite database initialized"

# ═══════════════════════════════════════════════════════════════════
step "7/11 — Building Next.js"
# ═══════════════════════════════════════════════════════════════════

cd ${INSTALL_DIR}
npx --yes next build 2>&1 | tail -10
log "Next.js build complete"

# ═══════════════════════════════════════════════════════════════════
step "8/11 — Configuring Nginx + TLS"
# ═══════════════════════════════════════════════════════════════════

# Generate self-signed cert if none exists
sudo mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/mc-cert.pem ]; then
  sudo openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/mc-key.pem \
    -out /etc/nginx/ssl/mc-cert.pem \
    -subj "/CN=${DOMAIN}/O=Mission Control/C=US" 2>/dev/null
  log "Self-signed TLS certificate generated"
else
  log "TLS certificate already exists"
fi

# Write Nginx config
sudo tee /etc/nginx/sites-available/mission-control > /dev/null << NGINX_EOF
server {
    listen 80;
    server_name ${DOMAIN} _;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN} _;

    ssl_certificate     /etc/nginx/ssl/mc-cert.pem;
    ssl_certificate_key /etc/nginx/ssl/mc-key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:${MC_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:${MC_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Next.js static assets
    location /_next/static/ {
        proxy_pass http://127.0.0.1:${MC_PORT};
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Everything else → Next.js
    location / {
        proxy_pass http://127.0.0.1:${MC_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_EOF

sudo ln -sf /etc/nginx/sites-available/mission-control /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and restart
sudo nginx -t 2>&1 && sudo systemctl restart nginx
log "Nginx configured with HTTPS on port 443"

# ═══════════════════════════════════════════════════════════════════
step "9/11 — Configuring firewall"
# ═══════════════════════════════════════════════════════════════════

sudo ufw --force reset > /dev/null 2>&1
sudo ufw default deny incoming > /dev/null 2>&1
sudo ufw default allow outgoing > /dev/null 2>&1
sudo ufw allow ssh > /dev/null 2>&1
sudo ufw allow 'Nginx Full' > /dev/null 2>&1
# Allow WebSocket from LAN to OpenClaw gateways
sudo ufw allow from 192.168.0.0/16 to any port 18789 proto tcp > /dev/null 2>&1
sudo ufw --force enable > /dev/null 2>&1
log "Firewall configured (SSH + HTTPS + LAN:18789)"

# ═══════════════════════════════════════════════════════════════════
step "10/11 — Creating swap (safety net for 4GB server)"
# ═══════════════════════════════════════════════════════════════════

if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  log "2GB swap created"
else
  log "Swap already exists"
fi

# ═══════════════════════════════════════════════════════════════════
step "11/11 — Starting Mission Control"
# ═══════════════════════════════════════════════════════════════════

cd ${INSTALL_DIR}

# Stop existing instance if running
pm2 delete mission-control 2>/dev/null || true

# Create PM2-compatible start config (ecosystem.config.js references wrong paths)
# Use direct start for reliability
pm2 start server.js \
  --name mission-control \
  --cwd ${INSTALL_DIR} \
  --max-memory-restart 512M \
  --log-date-format "YYYY-MM-DD HH:mm:ss" \
  --merge-logs \
  --env production

pm2 save

# Auto-start on boot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ${DEPLOY_USER} --hp /home/${DEPLOY_USER} 2>/dev/null || true

log "PM2 started mission-control"

# ═══════════════════════════════════════════════════════════════════
step "Health check"
# ═══════════════════════════════════════════════════════════════════

sleep 4

if curl -sf http://127.0.0.1:${MC_PORT}/api/health > /dev/null 2>&1; then
  HEALTH=$(curl -s http://127.0.0.1:${MC_PORT}/api/health)
  log "Application is running!"
  echo "  ${HEALTH}" | python3 -m json.tool 2>/dev/null || echo "  ${HEALTH}"
else
  warn "Health check failed — checking PM2 logs..."
  pm2 logs mission-control --nostream --lines 20
  echo ""
  err "Application may not be running. Check: pm2 logs mission-control"
fi

# ═══════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🦞  Deployment Complete                                    ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                             ║"
echo "║  Dashboard:  https://${DOMAIN}                              "
echo "║  Health:     https://${DOMAIN}/api/health                   "
echo "║  Metrics:    https://${DOMAIN}/api/metrics                  "
echo "║                                                             ║"
echo "║  Commands:                                                  ║"
echo "║    pm2 logs mission-control     View live logs              ║"
echo "║    pm2 restart mission-control  Restart the app             ║"
echo "║    pm2 status                   Check process status        ║"
echo "║    nano ${INSTALL_DIR}/.env     Edit configuration          "
echo "║                                                             ║"
echo "║  Next steps:                                                ║"
echo "║    1. Open https://${DOMAIN} and login                      "
echo "║    2. Edit .env → set MC_GATEWAYS to your OpenClaw hosts    ║"
echo "║    3. On each gateway host, run:                            ║"
echo "║       bash scripts/prepare-gateway.sh                       ║"
echo "║    4. pm2 restart mission-control                           ║"
echo "║                                                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
