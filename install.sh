#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Mission Control — Zero-Prompt Installer
#
# ONE COMMAND:
#   curl -fsSL https://raw.githubusercontent.com/mhue-ai/mission-control/main/install.sh | bash
#
# That's it. No prompts. No git auth. No interaction.
# Credentials are saved to ~/mc-credentials.txt
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

REPO="https://github.com/mhue-ai/mission-control.git"
DIR="/opt/mission-control"
PORT=3100
USER_NAME="$(whoami)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
CRED_FILE="$HOME/mc-credentials.txt"
LOG="/tmp/mc-install.log"

# ─── Logging ────────────────────────────────────────────────────────
exec > >(tee -a "$LOG") 2>&1
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "${G}[✓]${N} $1"; }
warn() { echo -e "${Y}[!]${N} $1"; }
fail() { echo -e "${R}[✗] $1${N}"; echo "Full log: $LOG"; exit 1; }
step() { echo -e "\n${C}═══ $1 ═══${N}"; }

echo ""
echo "  🦞 OpenClaw Mission Control — Installing..."
echo "  Target: $DIR"
echo "  User: $USER_NAME"
echo "  Log: $LOG"
echo ""

# ─── Must not be root ───────────────────────────────────────────────
if [ "$EUID" -eq 0 ]; then
  fail "Run as your normal user, not root. The script uses sudo internally."
fi

# ═════════════════════════════════════════════════════════════════════
step "System packages"
# ═════════════════════════════════════════════════════════════════════
sudo apt-get update -qq -y
sudo apt-get install -y -qq curl wget git build-essential openssl sqlite3 ufw nginx < /dev/null

# Node.js 22
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - < /dev/null
  sudo apt-get install -y -qq nodejs < /dev/null
fi
ok "Node $(node -v), npm $(npm -v)"

# PM2
sudo npm install -g pm2 --loglevel=error 2>/dev/null || true
ok "PM2 $(pm2 -v 2>/dev/null || echo 'installed')"

# ═════════════════════════════════════════════════════════════════════
step "Clone repository"
# ═════════════════════════════════════════════════════════════════════
if [ -d "$DIR/.git" ]; then
  sudo chown -R $USER_NAME:$USER_NAME $DIR
  cd $DIR && git pull --ff-only 2>/dev/null || true
  ok "Updated existing repo"
else
  sudo rm -rf $DIR
  sudo mkdir -p $DIR
  sudo chown $USER_NAME:$USER_NAME $DIR
  git clone --depth 1 $REPO $DIR
  ok "Cloned from $REPO"
fi
cd $DIR

# ═════════════════════════════════════════════════════════════════════
step "Permissions + directories"
# ═════════════════════════════════════════════════════════════════════
sudo chown -R $USER_NAME:$USER_NAME $DIR
mkdir -p $DIR/data
sudo mkdir -p /var/log/mission-control
sudo chown $USER_NAME:$USER_NAME /var/log/mission-control
ok "Permissions set"

# ═════════════════════════════════════════════════════════════════════
step "npm install"
# ═════════════════════════════════════════════════════════════════════
cd $DIR
npm install --no-fund --no-audit --loglevel=error 2>&1 | tail -3
ok "Dependencies installed ($(ls node_modules 2>/dev/null | wc -l) packages)"

# ═════════════════════════════════════════════════════════════════════
step "Generate secrets + .env"
# ═════════════════════════════════════════════════════════════════════
ADMIN_PASS=$(openssl rand -base64 16 | tr -d '=/+' | head -c 20)
JWT_SECRET=$(openssl rand -base64 32)
VAULT_KEY=$(openssl rand -hex 32)
AGENT_TOKEN=$(openssl rand -hex 24)

cat > $DIR/.env << ENVEOF
MC_PORT=$PORT
MC_HOST=127.0.0.1
NODE_ENV=production
MC_ADMIN_PASSWORD=$ADMIN_PASS
MC_JWT_SECRET=$JWT_SECRET
MC_DB_PATH=./data/mission-control.db
MC_GATEWAYS=
MC_DOMAIN=$IP
MC_WATCHDOG_ENABLED=true
MC_HEALTH_POLL_INTERVAL=15000
MC_EVENT_RETENTION_DAYS=30
MC_LOG_LEVEL=info
MC_LOG_FORMAT=text
MC_VAULT_KEY=$VAULT_KEY
MC_AGENT_TOKEN=$AGENT_TOKEN
ENVEOF

# Save credentials
cat > "$CRED_FILE" << CREDEOF
═══════════════════════════════════════════════════
  Mission Control Credentials — $(date)
═══════════════════════════════════════════════════
  Dashboard:      https://$IP
  Admin password: $ADMIN_PASS
  Agent token:    $AGENT_TOKEN
  Vault key:      (in /opt/mission-control/.env)
  JWT secret:     (in /opt/mission-control/.env)
═══════════════════════════════════════════════════
CREDEOF
chmod 600 "$CRED_FILE"
ok "Secrets generated → saved to $CRED_FILE"

# ═════════════════════════════════════════════════════════════════════
step "Initialize database"
# ═════════════════════════════════════════════════════════════════════
cd $DIR
node scripts/setup-db.js
ok "SQLite ready"

# ═════════════════════════════════════════════════════════════════════
step "Build Next.js"
# ═════════════════════════════════════════════════════════════════════
cd $DIR
npx --yes next build 2>&1 | tail -5
ok "Build complete"

# ═════════════════════════════════════════════════════════════════════
step "TLS certificates"
# ═════════════════════════════════════════════════════════════════════
sudo mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/mc-cert.pem ]; then
  sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/mc-key.pem \
    -out /etc/nginx/ssl/mc-cert.pem \
    -subj "/CN=$IP/O=MissionControl/C=US" 2>/dev/null
fi
ok "TLS cert ready"

# ═════════════════════════════════════════════════════════════════════
step "Nginx"
# ═════════════════════════════════════════════════════════════════════
sudo tee /etc/nginx/sites-available/mission-control > /dev/null << 'NGEOF'
server {
    listen 80 default_server;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2 default_server;
    ssl_certificate /etc/nginx/ssl/mc-cert.pem;
    ssl_certificate_key /etc/nginx/ssl/mc-key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options nosniff;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location /ws {
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
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGEOF

sudo ln -sf /etc/nginx/sites-available/mission-control /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t 2>&1 && sudo systemctl restart nginx
ok "Nginx → HTTPS on 443"

# ═════════════════════════════════════════════════════════════════════
step "Firewall"
# ═════════════════════════════════════════════════════════════════════
sudo ufw --force reset >/dev/null 2>&1
sudo ufw default deny incoming >/dev/null 2>&1
sudo ufw default allow outgoing >/dev/null 2>&1
sudo ufw allow ssh >/dev/null 2>&1
sudo ufw allow 'Nginx Full' >/dev/null 2>&1
sudo ufw allow from 192.168.0.0/16 to any port 18789 proto tcp >/dev/null 2>&1
sudo ufw --force enable >/dev/null 2>&1
ok "Firewall active"

# ═════════════════════════════════════════════════════════════════════
step "Swap (safety net)"
# ═════════════════════════════════════════════════════════════════════
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  ok "2GB swap"
else
  ok "Swap exists"
fi

# ═════════════════════════════════════════════════════════════════════
step "Start application"
# ═════════════════════════════════════════════════════════════════════
cd $DIR
pm2 delete mission-control 2>/dev/null || true
pm2 start server.js --name mission-control --cwd $DIR --max-memory-restart 512M --merge-logs 2>&1 | tail -3
pm2 save --force 2>/dev/null
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER_NAME --hp /home/$USER_NAME 2>/dev/null || true
ok "PM2 running"

# ═════════════════════════════════════════════════════════════════════
step "Health check"
# ═════════════════════════════════════════════════════════════════════
sleep 5
if curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1; then
  ok "Application is live!"
  curl -s http://127.0.0.1:$PORT/api/health | python3 -m json.tool 2>/dev/null || true
else
  warn "App not responding yet. Checking logs..."
  pm2 logs mission-control --nostream --lines 15
  echo ""
  warn "It may need a moment. Check: pm2 logs mission-control"
fi

# ═════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🦞  DONE                                                   ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                             ║"
echo "║  Dashboard:  https://$IP"
echo "║  Password:   $ADMIN_PASS"
echo "║                                                             ║"
echo "║  Credentials saved to: $CRED_FILE"
echo "║                                                             ║"
echo "║  Commands:                                                  ║"
echo "║    pm2 logs mission-control     ← view logs                 ║"
echo "║    pm2 restart mission-control  ← restart                   ║"
echo "║    nano /opt/mission-control/.env  ← config                 ║"
echo "║                                                             ║"
echo "║  Next: edit .env → add MC_GATEWAYS → pm2 restart            ║"
echo "║                                                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
