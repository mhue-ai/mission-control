#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Mission Control — Ubuntu Server Setup Script
# Self-hosted HTTPS deployment with multi-gateway fleet orchestration
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="${MC_DOMAIN:-mc.local}"
EMAIL="${MC_EMAIL:-admin@example.com}"
MC_DIR="/opt/mission-control"
MC_USER="mcadmin"
NODE_VERSION="22"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🦞 OpenClaw Mission Control — Server Setup            ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Domain: ${DOMAIN}"
echo "║  Install Dir: ${MC_DIR}"
echo "╚══════════════════════════════════════════════════════════╝"

# ─── 1. System packages ────────────────────────────────────────────────
echo "→ Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
  curl wget gnupg2 ca-certificates lsb-release \
  nginx certbot python3-certbot-nginx \
  sqlite3 ufw git build-essential

# ─── 2. Node.js ────────────────────────────────────────────────────────
echo "→ Installing Node.js ${NODE_VERSION}..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm pm2

# ─── 3. Create service user ───────────────────────────────────────────
echo "→ Setting up service user..."
id -u $MC_USER &>/dev/null || useradd -r -m -s /bin/bash $MC_USER

# ─── 4. Application directory ─────────────────────────────────────────
echo "→ Creating application directory..."
mkdir -p ${MC_DIR}
chown ${MC_USER}:${MC_USER} ${MC_DIR}

# ─── 5. Firewall ──────────────────────────────────────────────────────
echo "→ Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 'Nginx Full'
# Allow WebSocket connections from local network to OpenClaw gateways
ufw allow from 192.168.0.0/16 to any port 18789 proto tcp
ufw --force enable

# ─── 6. HTTPS via Nginx ───────────────────────────────────────────────
echo "→ Configuring Nginx with HTTPS..."
cat > /etc/nginx/sites-available/mission-control <<'NGINX'
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name MC_DOMAIN_PLACEHOLDER;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name MC_DOMAIN_PLACEHOLDER;

    # TLS — managed by certbot or self-signed
    ssl_certificate     /etc/nginx/ssl/mc-cert.pem;
    ssl_certificate_key /etc/nginx/ssl/mc-key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header X-XSS-Protection "1; mode=block";

    # Application
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # WebSocket endpoint for real-time updates
    location /ws {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

# Replace domain placeholder
sed -i "s/MC_DOMAIN_PLACEHOLDER/${DOMAIN}/g" /etc/nginx/sites-available/mission-control

# Generate self-signed cert (replace with certbot for production domains)
mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/mc-cert.pem ]; then
    echo "→ Generating self-signed TLS certificate..."
    openssl req -x509 -nodes -days 365 \
        -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/mc-key.pem \
        -out /etc/nginx/ssl/mc-cert.pem \
        -subj "/CN=${DOMAIN}/O=Mission Control/C=US"
fi

ln -sf /etc/nginx/sites-available/mission-control /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# ─── 7. Let's Encrypt (optional — uncomment for real domains) ─────────
# echo "→ Obtaining Let's Encrypt certificate..."
# certbot --nginx -d ${DOMAIN} --email ${EMAIL} --agree-tos --non-interactive
# systemctl reload nginx

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✓ Server infrastructure ready                         ║"
echo "║                                                         ║"
echo "║   Next: Run deploy-app.sh to install the application    ║"
echo "║   Access: https://${DOMAIN}                             ║"
echo "╚══════════════════════════════════════════════════════════╝"
