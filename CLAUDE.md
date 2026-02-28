# Rig — Claude Instructions

> This file is the primary context document for Claude (and other AI agents). For full design
> rationale see `DESIGN.md`. For implementation history see `PLAN.md`. For detailed agent
> guidance (conventions, API reference, file structure) see `AGENTS.md`.

## What Rig Is

Rig is a **personal async coding dispatch console** — a web UI that wraps the `pi` coding agent
and makes it accessible over Tailscale. It is NOT a chatbot. Sessions are work orders; the UI
is a logbook, not a messenger.

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS 4 (`frontend/`)
- **Backend**: Node.js + Fastify 5 + WebSocket (`server/`)
- **Operator**: Notification watcher / Telegram bridge (`operator/`)
- **Pi integration**: The server spawns `pi --mode rpc` child processes and proxies JSON-RPC
  over WebSocket. Pi is **never imported directly**.

## Project Layout

```
rig/
├── deploy.sh              # One-command build + deploy + service restart
├── start.sh               # Dev convenience launcher (builds + runs both services locally)
├── AGENTS.md              # Full agent context (conventions, API, deployment)
├── CLAUDE.md              # This file
├── DESIGN.md              # Design philosophy and visual direction
├── PLAN.md                # Implementation phases and history
├── ops/                   # Systemd service unit files
│   ├── rig-server.service    # Production server service
│   └── rig-operator.service  # Production operator service
├── frontend/              # React SPA
│   └── src/
│       ├── components/    # Board, SessionLog, NewDispatch, FilesPanel, etc.
│       ├── lib/           # api.ts, utils.ts
│       ├── types/         # TypeScript types
│       ├── App.tsx        # Root — fetches real data, auto-selects session
│       └── index.css      # Tailwind @theme tokens + base styles
├── server/                # Fastify API server
│   └── src/
│       ├── index.ts       # Entry point — HTTP + WebSocket, serves frontend dist
│       ├── config.ts      # Rig config at ~/.pi/agent/rig.json
│       ├── pi-config.ts   # Reads pi's settings.json
│       ├── pi-bridge.ts   # Spawn + manage pi --mode rpc processes
│       ├── session-store.ts # Parse JSONL session files
│       ├── file-tracker.ts  # Track files touched per session
│       └── routes.ts      # All REST + WS routes
└── operator/              # Notification watcher / Telegram bridge
    └── src/
        └── index.ts       # Entry point
```

## Development

```bash
# Server (auto-reloads via tsx watch)
cd server && npm run dev        # http://localhost:3100

# Frontend (Vite HMR)
cd frontend && npm run dev      # http://localhost:5173 (proxies /api/* → 3100)
```

## Production Deployment

Rig runs as two separate **systemd user services**. The deploy dir (`~/rig-deploy/`) is
completely separate from source (`~/Projects/personal/rig/`).

### First-time or full deploy

```bash
cd ~/Projects/personal/rig
./deploy.sh
```

`deploy.sh` builds everything, rsyncs compiled output to `~/rig-deploy/`, installs/updates the
service unit files, and restarts both services.

### After making changes

```bash
./deploy.sh                              # build + deploy + restart both
# OR restart manually after a deploy:
systemctl --user restart rig-server      # server + frontend
systemctl --user restart rig-operator    # operator only
```

### Service management

```bash
systemctl --user status  rig-server
systemctl --user status  rig-operator
journalctl --user -fu    rig-server      # follow logs
journalctl --user -fu    rig-operator
```

### Deploy layout

```
~/rig-deploy/
├── server/          # dist/ + node_modules  (node runs dist/index.js)
├── operator/        # dist/ + node_modules  (node runs dist/src/index.js)
└── frontend/        # vite build output     (served by the server automatically)
```

The server resolves the frontend path as `../../frontend/dist` relative to its own `dist/`
directory — so `~/rig-deploy/server/dist` → `~/rig-deploy/frontend/dist`. No config needed.

## Key Rules for Editing

1. **Never import pi** — always `spawn('pi', ['--mode', 'rpc'])` and talk over stdin/stdout.
2. **No class components** — functional React with hooks only.
3. **No extra UI libraries** — `lucide-react` for icons, nothing else.
4. **Tailwind CSS 4** — use `@theme` tokens from `index.css`, not hardcoded colors.
5. **Mobile-first** — every layout works on phone. Use `lg:` prefix for desktop variants.
6. **Port 3100** — server always runs here (configurable via `~/.pi/agent/rig.json`).
7. **Pi config is read-only** — never write `settings.json` directly; send changes through pi RPC.

## Node / nvm

Node is managed via nvm. The active version in production:

```
/home/lolwierd/.nvm/versions/node/v25.6.0/bin/node
```

Both service unit files hardcode this path. If the node version changes, update
`ops/rig-server.service`, `ops/rig-operator.service`, and re-run `./deploy.sh`.
