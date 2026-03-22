#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Mission Control — Application Deployment
# Run after setup-server.sh to install and start the application
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

MC_DIR="/opt/mission-control"
MC_USER="mcadmin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🦞 Deploying Mission Control Application              ║"
echo "╚══════════════════════════════════════════════════════════╝"

# ─── 1. Copy application files ────────────────────────────────────────
echo "→ Copying application files..."
cp -r "${SCRIPT_DIR}/app" "${MC_DIR}/"
chown -R ${MC_USER}:${MC_USER} ${MC_DIR}

# ─── 2. Create data and log directories ───────────────────────────────
echo "→ Creating data directories..."
mkdir -p ${MC_DIR}/app/data
mkdir -p /var/log/mission-control
chown -R ${MC_USER}:${MC_USER} ${MC_DIR}/app/data
chown -R ${MC_USER}:${MC_USER} /var/log/mission-control

# ─── 3. Configure environment ─────────────────────────────────────────
echo "→ Setting up environment configuration..."
if [ ! -f "${MC_DIR}/app/.env" ]; then
  cp "${MC_DIR}/app/.env.example" "${MC_DIR}/app/.env"

  # Generate secure secrets
  JWT_SECRET=$(openssl rand -base64 32)
  ADMIN_PASS=$(openssl rand -base64 16)

  sed -i "s|MC_JWT_SECRET=CHANGE_ME_GENERATE_WITH_OPENSSL_RAND|MC_JWT_SECRET=${JWT_SECRET}|" "${MC_DIR}/app/.env"
  sed -i "s|MC_ADMIN_PASSWORD=CHANGE_ME_NOW|MC_ADMIN_PASSWORD=${ADMIN_PASS}|" "${MC_DIR}/app/.env"

  echo ""
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║ SAVE THESE CREDENTIALS:                   ║"
  echo "  ║ Admin Password: ${ADMIN_PASS}             "
  echo "  ║ JWT Secret: (stored in .env)              ║"
  echo "  ╚═══════════════════════════════════════════╝"
  echo ""
fi

# ─── 4. Install dependencies ──────────────────────────────────────────
echo "→ Installing Node.js dependencies..."
cd ${MC_DIR}/app
sudo -u ${MC_USER} npm install --production 2>/dev/null || sudo -u ${MC_USER} npm install

# ─── 5. Initialize database ───────────────────────────────────────────
echo "→ Initializing database..."
sudo -u ${MC_USER} node scripts/setup-db.js

# ─── 6. Build application ─────────────────────────────────────────────
echo "→ Building application..."
sudo -u ${MC_USER} npm run build 2>/dev/null || echo "  (Build step — Next.js will handle on first run)"

# ─── 7. Install systemd service ───────────────────────────────────────
echo "→ Installing systemd service..."
cp "${SCRIPT_DIR}/mission-control.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable mission-control

# ─── 8. Start the service ─────────────────────────────────────────────
echo "→ Starting Mission Control..."
sudo -u ${MC_USER} pm2 start ${MC_DIR}/app/ecosystem.config.js
sudo -u ${MC_USER} pm2 save

# Generate PM2 startup script
pm2 startup systemd -u ${MC_USER} --hp /home/${MC_USER}

# ─── 9. Verify ────────────────────────────────────────────────────────
echo ""
echo "→ Verifying deployment..."
sleep 3

if curl -sf http://127.0.0.1:3100/api/health > /dev/null 2>&1; then
  echo "  ✓ Application is running"
else
  echo "  ⚠ Application not yet responding (may need a moment to start)"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✓ Deployment Complete                                 ║"
echo "║                                                         ║"
echo "║   Access:  https://$(hostname -I | awk '{print $1}')    "
echo "║   Health:  curl https://localhost/api/health             ║"
echo "║   Logs:    pm2 logs mission-control                     ║"
echo "║   Status:  pm2 status                                   ║"
echo "║                                                         ║"
echo "║   Next steps:                                           ║"
echo "║   1. Edit /opt/mission-control/app/.env                 ║"
echo "║   2. Add your OpenClaw gateway IPs to MC_GATEWAYS       ║"
echo "║   3. Add OpenAI credentials for AI analysis             ║"
echo "║   4. Restart: pm2 restart mission-control               ║"
echo "╚══════════════════════════════════════════════════════════╝"
