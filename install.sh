#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

REPO="https://github.com/mhue-ai/mission-control.git"
DIR="/opt/mission-control"
PORT=3100
ME="$(whoami)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; B='\033[1m'; N='\033[0m'
ok()   { echo -e "${G}[ok]${N} $1"; }
skip() { echo -e "${Y}[skip]${N} $1"; }
die()  { echo -e "${R}[FAIL] $1${N}"; exit 1; }
step() { echo -e "\n${C}--- $1${N}"; }

[ "$EUID" -eq 0 ] && die "Run as normal user, not root."

# ═══════════════════════════════════════════════════════════════════════
# Mode selection
# ═══════════════════════════════════════════════════════════════════════
MODE=""

# Allow passing mode as argument: install.sh --clean or install.sh --upgrade
if [[ "${1:-}" == "--clean" ]]; then
  MODE="clean"
elif [[ "${1:-}" == "--upgrade" ]]; then
  MODE="upgrade"
fi

# Auto-detect if existing install is present
EXISTING=false
if [ -f "$DIR/server.js" ] && [ -f "$DIR/.env" ]; then
  EXISTING=true
fi

if [ -z "$MODE" ]; then
  echo ""
  echo "  🦞 Mission Control installer"
  echo ""

  if $EXISTING; then
    printf "  \033[1;33mExisting installation detected at $DIR\033[0m\n"
    echo ""
    printf "  \033[1m1)\033[0m Clean install   — wipes everything, fresh start\n"
    printf "  \033[1m2)\033[0m Upgrade         — updates code only, keeps config + data\n"
    echo ""
    printf "  Select [1/2]: "
    read -r choice < /dev/tty
    case "$choice" in
      1) MODE="clean" ;;
      2) MODE="upgrade" ;;
      *) die "Invalid selection. Run again and pick 1 or 2." ;;
    esac
  else
    echo "  No existing installation found. Performing clean install."
    MODE="clean"
  fi
fi

echo ""
echo -e "  Mode: ${B}${MODE}${N}   Target: $DIR   User: $ME"
echo ""

# ═══════════════════════════════════════════════════════════════════════
# UPGRADE PATH — preserve .env, data/, certs, firewall, credentials
# ═══════════════════════════════════════════════════════════════════════
if [ "$MODE" = "upgrade" ]; then

  if ! $EXISTING; then
    die "No existing installation at $DIR. Run a clean install first."
  fi

  # ── 1. Stop the running app ────────────────────────────────────
  step "Stop application"
  pm2 stop mission-control 2>/dev/null && ok "stopped" || skip "not running"

  # ── 2. Backup config and data ──────────────────────────────────
  step "Backup config + data"
  BACKUP="$DIR/.backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP"
  cp "$DIR/.env" "$BACKUP/.env"
  [ -d "$DIR/data" ] && cp -r "$DIR/data" "$BACKUP/data"
  ok "backed up to $BACKUP"

  # ── 3. Update system packages (non-destructive) ────────────────
  step "System packages"
  sudo apt-get update -qq -y < /dev/null
  sudo apt-get install -y -qq curl wget git build-essential openssl sqlite3 nginx < /dev/null
  if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - < /dev/null
    sudo apt-get install -y -qq nodejs < /dev/null
  fi
  ok "node $(node -v)"
  sudo npm install -g pm2 --loglevel=error 2>/dev/null || true

  # ── 4. Pull latest code ────────────────────────────────────────
  step "Update code"
  cd "$DIR"
  # Save protected files
  cp .env /tmp/.mc-env-save
  [ -d data ] && cp -r data /tmp/.mc-data-save || true

  # Fetch latest from repo
  if [ -d .git ]; then
    git fetch --depth 1 origin main
    git reset --hard origin/main
    ok "git updated"
  else
    # Not a git repo — re-clone into temp and overlay
    TMPDIR=$(mktemp -d)
    git clone --depth 1 "$REPO" "$TMPDIR"
    # Remove old code files but NOT .env, data, node_modules, .next, .backup*
    find "$DIR" -maxdepth 1 -type f ! -name '.env' -delete
    rm -rf "$DIR/components" "$DIR/lib" "$DIR/pages" "$DIR/scripts" "$DIR/skills" "$DIR/nginx"
    # Copy new code in
    cp -r "$TMPDIR"/* "$DIR/"
    cp "$TMPDIR/.gitignore" "$DIR/" 2>/dev/null || true
    cp "$TMPDIR/.env.example" "$DIR/" 2>/dev/null || true
    rm -rf "$TMPDIR"
    ok "code replaced from repo"
  fi

  # Restore protected files
  cp /tmp/.mc-env-save "$DIR/.env"
  [ -d /tmp/.mc-data-save ] && cp -r /tmp/.mc-data-save "$DIR/data" || true
  rm -f /tmp/.mc-env-save
  rm -rf /tmp/.mc-data-save
  ok "config + data preserved"

  # ── 5. Install deps ────────────────────────────────────────────
  step "npm install"
  cd "$DIR"
  sudo chown -R "$ME:$ME" "$DIR"
  rm -rf node_modules .next
  npm install --no-fund --no-audit --loglevel=error 2>&1 | tail -3
  ok "$(ls node_modules | wc -l) packages"

  # ── 6. Migrate database (additive only) ────────────────────────
  step "Database migration"
  node scripts/setup-db.js
  ok "schema up to date"

  # ── 7. Rebuild ─────────────────────────────────────────────────
  step "Build Next.js"
  npx --yes next build 2>&1 | tail -5
  ok "built"

  # ── 8. Restart ─────────────────────────────────────────────────
  step "Restart application"
  pm2 delete mission-control 2>/dev/null || true
  pm2 start server.js --name mission-control --cwd "$DIR" --max-memory-restart 512M --merge-logs
  pm2 save --force 2>/dev/null
  ok "pm2 restarted"

  # ── 9. Health check ────────────────────────────────────────────
  step "Health check"
  sleep 5
  if curl -sf http://127.0.0.1:$PORT/api/health >/dev/null 2>&1; then
    ok "RUNNING"
    curl -s http://127.0.0.1:$PORT/api/health | python3 -m json.tool 2>/dev/null || true
  else
    echo "  Not responding yet. Check: pm2 logs mission-control"
  fi

  echo ""
  echo "══════════════════════════════════════════════════════"
  echo "  🦞 Upgrade complete"
  echo ""
  echo "  Config preserved:   $DIR/.env"
  echo "  Database preserved: $DIR/data/"
  echo "  Backup at:          $BACKUP"
  echo "  TLS certs:          unchanged"
  echo "  Firewall:           unchanged"
  echo ""
  echo "  Dashboard: https://$IP"
  echo "══════════════════════════════════════════════════════"
  echo ""
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════
# CLEAN INSTALL PATH — wipes everything, fresh start
# ═══════════════════════════════════════════════════════════════════════

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
pm2 delete mission-control 2>/dev/null || true
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
  echo "  Not responding yet. Check: pm2 logs mission-control"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  🦞 Clean install complete"
echo ""
echo "  Dashboard:  https://$IP"
echo "  Password:   $AP"
echo "  Creds file: ~/mc-credentials.txt"
echo ""
echo "  Next: edit $DIR/.env → set MC_GATEWAYS"
echo "        pm2 restart mission-control"
echo "══════════════════════════════════════════════════════"
echo ""
