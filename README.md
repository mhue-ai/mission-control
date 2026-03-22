# Mission Control

OpenClaw fleet orchestration dashboard. Self-hosted on Ubuntu.

## Install

**Fresh server (clean install):**
```
curl -fsSL https://raw.githubusercontent.com/mhue-ai/mission-control/main/install.sh | bash
```

**Existing install (interactive — asks clean vs upgrade):**
```
curl -fsSL https://raw.githubusercontent.com/mhue-ai/mission-control/main/install.sh -o /tmp/mc-install.sh && bash /tmp/mc-install.sh
```

**Non-interactive (skip the prompt):**
```
# Clean install — wipes everything
bash /tmp/mc-install.sh --clean

# Upgrade — updates code only, keeps config + data + certs + firewall
bash /tmp/mc-install.sh --upgrade
```

## What each mode does

| | Clean install | Upgrade |
|---|---|---|
| Code (server.js, components, lib) | Replaced | Replaced |
| npm packages | Fresh install | Fresh install |
| Next.js build | Fresh build | Fresh build |
| `.env` (secrets, config) | New secrets generated | **Preserved** |
| `data/` (SQLite database) | New empty DB + demo seed | **Preserved** + migrated |
| TLS certificates | Generated if missing | **Unchanged** |
| Nginx config | Written fresh | **Unchanged** |
| Firewall rules | Reset + configured | **Unchanged** |
| PM2 process | Created | Restarted |
| Credentials file | New `~/mc-credentials.txt` | **Unchanged** |
| Backup | None | Auto-backup to `.backup-*` |

## After install

1. Open `https://YOUR_SERVER_IP` and log in
2. Edit `/opt/mission-control/.env` — set `MC_GATEWAYS`
3. `pm2 restart mission-control`

## Commands

```
pm2 logs mission-control        # view logs
pm2 restart mission-control     # restart
pm2 status                      # check status
nano /opt/mission-control/.env  # edit config
```
