# Mission Control

OpenClaw fleet orchestration dashboard. Self-hosted on Ubuntu.

## Install

```
curl -fsSL https://raw.githubusercontent.com/mhue-ai/mission-control/main/install.sh | bash
```

One command. No prompts. Credentials saved to `~/mc-credentials.txt`.

## After install

1. Open `https://YOUR_SERVER_IP` and log in with the printed password
2. Edit `/opt/mission-control/.env` — set `MC_GATEWAYS` to your OpenClaw hosts
3. Run `pm2 restart mission-control`

## Commands

```
pm2 logs mission-control      # view logs
pm2 restart mission-control   # restart
pm2 status                    # check status
nano /opt/mission-control/.env # edit config
```
