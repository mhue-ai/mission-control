#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

REPO="https://github.com/mhue-ai/mission-control.git"
DIR="/opt/mission-control"
PORT=3100
ME="$(whoami)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

G='\033[0;32m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "${G}[ok]${N} $1"; }
die()  { echo -e "${R}[FAIL] $1${N}"; exit 1; }
step() { echo -e "\n${C}--- $1${N}"; }

[ "$EUID" -eq 0 ] && die "Run as normal user, not root."

echo ""
echo "  🦞 Mission Control installer"
echo "  Target: $DIR   User: $ME"
echo ""

# ── 1. System packages ─────────────────────────────────────────
step "System packages"
sudo apt-get update -qq -y < /dev/null
sudo apt-get install -y -qq curl wget git build-essential openssl sqlite3 ufw nginx < /dev/null
ok "apt packages"

if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - < /dev/null
  sudo apt-get install -y -qq nodejs < /dev/null
fi
ok "node $(node -v)"

sudo npm install -g pm2 --loglevel=error 2>/dev/null
ok "pm2"

# ── 2. Clone ───────────────────────────────────────────────────
step "Clone repo"
sudo rm -rf $DIR
sudo mkdir -p $DIR
sudo chown $ME:$ME $DIR
git clone --depth 1 $REPO $DIR
cd $DIR
ok "cloned"

# ── 3. npm install ─────────────────────────────────────────────
step "npm install"
mkdir -p $DIR/data
npm install --no-fund --no-audit --loglevel=error 2>&1 | tail -3
ok "$(ls node_modules | wc -l) packages"

# ── 4. Secrets ─────────────────────────────────────────────────
step "Generate secrets"
AP=$(openssl rand -base64 16 | tr -d '=/+' | head -c 20)
JS=$(openssl rand -base64 32)
VK=$(openssl rand -hex 32)
AT=$(openssl rand -hex 24)

cat > $DIR/.env << EOF
MC_PORT=$PORT
MC_HOST=127.0.0.1
NODE_ENV=production
MC_ADMIN_PASSWORD=$AP
MC_JWT_SECRET=$JS
MC_DB_PATH=./data/mission-control.db
MC_GATEWAYS=
MC_DOMAIN=$IP
MC_WATCHDOG_ENABLED=true
MC_HEALTH_POLL_INTERVAL=15000
MC_EVENT_RETENTION_DAYS=30
MC_LOG_LEVEL=info
MC_LOG_FORMAT=text
MC_VAULT_KEY=$VK
MC_AGENT_TOKEN=$AT
EOF

cat > ~/mc-credentials.txt << EOF
Mission Control — $(date)
Dashboard:      https://$IP
Admin password: $AP
Agent token:    $AT
EOF
chmod 600 ~/mc-credentials.txt
ok "secrets → ~/mc-credentials.txt"

# ── 5. Database ────────────────────────────────────────────────
step "Database"
node scripts/setup-db.js
ok "sqlite"

# ── 6. Build ───────────────────────────────────────────────────
step "Build Next.js"
npx --yes next build 2>&1 | tail -5
ok "built"

# ── 7. TLS ─────────────────────────────────────────────────────
step "TLS cert"
sudo mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/mc-cert.pem ]; then
  sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/mc-key.pem \
    -out /etc/nginx/ssl/mc-cert.pem \
    -subj "/CN=$IP/O=MC/C=US" 2>/dev/null
fi
ok "cert"

# ── 8. Nginx ───────────────────────────────────────────────────
step "Nginx"
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
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    location /ws {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
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
ok "nginx"

# ── 9. Firewall ────────────────────────────────────────────────
step "Firewall"
sudo ufw --force reset >/dev/null 2>&1
sudo ufw default deny incoming >/dev/null 2>&1
sudo ufw default allow outgoing >/dev/null 2>&1
sudo ufw allow ssh >/dev/null 2>&1
sudo ufw allow 'Nginx Full' >/dev/null 2>&1
sudo ufw allow from 192.168.0.0/16 to any port 18789 proto tcp >/dev/null 2>&1
sudo ufw --force enable >/dev/null 2>&1
ok "ufw"

# ── 10. Swap ───────────────────────────────────────────────────
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
ok "swap"

# ── 11. Start ──────────────────────────────────────────────────
step "Start"
pm2 delete mission-control 2>/dev/null || true
pm2 start server.js --name mission-control --cwd $DIR --max-memory-restart 512M --merge-logs
pm2 save --force 2>/dev/null
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $ME --hp /home/$ME 2>/dev/null || true
ok "pm2"

# ── 12. Health check ──────────────────────────────────────────
step "Health check"
sleep 5
if curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1; then
  ok "RUNNING"
  curl -s http://127.0.0.1:$PORT/api/health | python3 -m json.tool 2>/dev/null || true
else
  echo "Not responding yet. Check: pm2 logs mission-control"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  Dashboard:  https://$IP"
echo "  Password:   $AP"
echo "  Creds file: ~/mc-credentials.txt"
echo "══════════════════════════════════════════"
echo ""
