#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Prepare an OpenClaw gateway for Mission Control access
#
# Run this ON EACH OpenClaw gateway host to:
# 1. Set gateway.bind to "lan" (allows network connections)
# 2. Configure auth token (required for non-loopback)
# 3. Verify connectivity
#
# IMPORTANT: By default, OpenClaw binds to 127.0.0.1 (loopback only).
# Mission Control CANNOT connect to gateways without this preparation.
#
# Usage: bash prepare-gateway.sh <auth-token>
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(openssl rand -hex 24)
  echo "Generated auth token: $TOKEN"
  echo "Save this — you'll need it in Mission Control's MC_GATEWAYS config."
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Preparing OpenClaw Gateway for Mission Control         ║"
echo "╚══════════════════════════════════════════════════════════╝"

# Check openclaw is installed
if ! command -v openclaw &>/dev/null; then
  echo "ERROR: openclaw CLI not found. Install with: npm install -g openclaw@latest"
  exit 1
fi

# Check gateway is running
if ! openclaw gateway status &>/dev/null 2>&1; then
  echo "ERROR: Gateway is not running. Start with: openclaw gateway"
  exit 1
fi

echo "→ Setting gateway.bind to 'lan'..."
openclaw config set gateway.bind '"lan"'

echo "→ Setting auth mode to 'token'..."
openclaw config set gateway.auth.mode '"token"'

echo "→ Setting auth token..."
openclaw config set gateway.auth.token "\"$TOKEN\""

echo "→ Setting reload mode to 'hybrid' (hot-reload most changes)..."
openclaw config set gateway.reload '"hybrid"'

echo "→ Running doctor to validate..."
openclaw doctor

echo ""
echo "→ Verifying gateway is accessible on LAN..."
GATEWAY_IP=$(hostname -I | awk '{print $1}')
GATEWAY_PORT=$(openclaw config get gateway.port 2>/dev/null || echo "18789")
echo "  Gateway address: ${GATEWAY_IP}:${GATEWAY_PORT}"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✓ Gateway prepared for Mission Control                 ║"
echo "║                                                         ║"
echo "║  Add to Mission Control .env:                           ║"
echo "║  MC_GATEWAYS=gw-N:${GATEWAY_IP}:${GATEWAY_PORT}:${TOKEN}"
echo "║                                                         ║"
echo "║  Security notes:                                        ║"
echo "║  • Token is required for all non-loopback connections   ║"
echo "║  • Consider Tailscale for encrypted transit             ║"
echo "║  • UFW: sudo ufw allow from <mc-ip> to any port 18789  ║"
echo "╚══════════════════════════════════════════════════════════╝"
