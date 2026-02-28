# Rig — Agent Instructions

## Project Overview

Rig is an async coding platform that wraps the **pi coding agent** (`@mariozechner/pi-coding-agent`) as a web interface accessible over Tailscale. It has a separate server/backend and frontend.

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS 4 — in `frontend/`
- **Backend**: Node.js + Fastify + WebSocket — in `server/`
- **Design doc**: `DESIGN.md` at the project root
- **Implementation plan**: `PLAN.md` at the project root

## Architecture

The server spawns `pi --mode rpc` child processes (one per active session) and proxies the JSON-RPC protocol over WebSocket to the frontend. Pi handles everything — tools, extensions, compaction, model switching, session persistence. The server does NOT re-implement any pi logic.

Pi's config lives at `~/.pi/agent/` — settings.json, auth.json, sessions/, extensions, skills. Rig reads from and writes to these same files so sessions are resumable between terminal `pi --resume` and the web UI.

Pi source code is at `../pi-mono/` for reference. Key packages:
- `packages/coding-agent/` — the CLI agent with RPC mode
- `packages/coding-agent/src/modes/rpc/` — RPC protocol types and handler
- `packages/coding-agent/src/core/session-manager.ts` — session file format (JSONL)
- `packages/coding-agent/src/core/sdk.ts` — `createAgentSession()` API

## Current State

Rig is fully end-to-end functional and in active iteration.

- Frontend shell is complete (board, session log, dispatch flow, responsive layouts).
- Backend is complete (session/config reading, project registry, models/settings endpoints).
- Live sessions are complete (pi RPC bridge, WebSocket streaming, dispatch/resume/stop).
- Polish features are shipped (markdown rendering, model-aware thinking levels, extension UI requests).
- Production setup is in place (build/start flow plus service configs).

See `PLAN.md` for the historical implementation breakdown.

## Frontend Conventions

- **Tailwind CSS 4** with `@theme` tokens in `src/index.css` — all colors are custom design tokens (amber, green, red, blue, violet, etc.)
- **Fonts**: Bricolage Grotesque (UI/headings via `font-ui`), IBM Plex Mono (code/labels via `font-mono`)
- **Color palette**: Warm charcoal + amber accent. Dark mode is primary.
- **Component style**: Functional React components with hooks. No class components.
- **Imports**: Use `lucide-react` for icons. No other UI library.
- **No chat bubbles**: The session view is a work log, not a chatbot. Tool calls are first-class log entries.
- **Mobile-first**: All layouts work on phone/tablet/desktop. Use Tailwind responsive prefixes (`lg:` for desktop).

## Server Conventions

- **Fastify 5** with `@fastify/websocket`, `@fastify/cors`, `@fastify/static`
- **TypeScript** with ESM (`"type": "module"`)
- **Dev:** `tsx watch src/index.ts` — auto-reload on changes
- **Port:** 3100 (configurable in `~/.pi/agent/rig.json`)
- **Never import pi directly** — always spawn `pi --mode rpc` and talk via stdin/stdout JSON lines
- **Pi config is read-only** — we read `settings.json` but never write to it; changes go through pi RPC

## Key Design Decisions

1. **Dispatch console, not chatbot** — Sessions are work orders. The home screen ("The Board") shows all sessions across all projects in one flat list.
2. **Spawn pi RPC, don't import pi** — Always uses whatever pi version is installed globally. The RPC protocol is the integration boundary.
3. **Folder scoping via project registry** — Users register project directories. When starting a session, the server spawns pi with `--cwd <project>`.
4. **Model selection persists to settings.json** — Matches pi's behavior where last-selected model becomes default.
5. **File tracking via event stream parsing** — Parse write/edit/bash tool calls from the RPC event stream, not git diff.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/sessions` | List all sessions (with `?cwd=` filter) |
| GET | `/api/sessions/:id/entries?path=` | Read session JSONL entries |
| GET | `/api/models` | Enabled models + default from pi settings |
| GET | `/api/models/all` | All available models from pi runtime |
| GET | `/api/models/capabilities?provider=&modelId=` | Resolve supported thinking levels for a model |
| GET | `/api/settings` | Raw pi settings |
| GET | `/api/projects` | Registered + auto-discovered projects |
| POST | `/api/projects` | Add project `{ path, name }` |
| DELETE | `/api/projects` | Remove project `{ path }` |
| GET | `/api/browse` | Directory browser for project picker |
| POST | `/api/dispatch` | Spawn pi for new session `{ cwd, message, provider?, model?, thinkingLevel? }` |
| POST | `/api/resume` | Resume existing session `{ sessionFile, cwd }` |
| POST | `/api/stop` | Kill active session `{ bridgeId }` |
| GET | `/api/active` | List active pi bridges |
| WS | `/api/ws/:bridgeId` | WebSocket for live events + command/response forwarding |

## File Structure

```
rig/
├── DESIGN.md              # Design philosophy, rationale, visual direction
├── AGENTS.md              # This file
├── PLAN.md                # Implementation plan with phases and status
├── frontend/              # React SPA
│   ├── src/
│   │   ├── components/    # React components (Board, SessionLog, EmptyDetail, etc.)
│   │   ├── lib/           # api.ts (server client), utils.ts, mock-data.ts (legacy)
│   │   ├── types/         # TypeScript type definitions
│   │   ├── App.tsx        # Root component — fetches real data, auto-selects session
│   │   ├── main.tsx       # Entry point
│   │   └── index.css      # Tailwind config + design tokens
│   ├── vite.config.ts     # Proxies /api/* to server:3100
│   └── package.json
└── server/                # Node.js + Fastify backend
    └── src/
        ├── index.ts       # HTTP + WS server entry (port 3100)
        ├── config.ts      # Rig config — project registry (~/.pi/agent/rig.json)
        ├── pi-config.ts   # Read pi's settings.json — models, defaults
        ├── pi-bridge.ts   # Spawn & manage pi --mode rpc child processes
        ├── session-store.ts # Parse pi's JSONL session files for listing
        ├── file-tracker.ts  # Track files touched from tool_execution_start events
        └── routes.ts      # REST + WebSocket routes
```

## Running

```bash
# Terminal 1: Server (auto-reloads)
cd server && npm run dev

# Terminal 2: Frontend (Vite HMR)
cd frontend && npm run dev

# Open: http://localhost:5173
# Server API: http://localhost:3100
```

## Deployment

Rig runs as two separate **systemd user services** on the host machine. The deployment directory is `~/rig-deploy/` — completely separate from the source tree at `~/Projects/personal/rig/`.

### Deploy directory layout

```
~/rig-deploy/
├── server/          # compiled server JS (dist/) + node_modules
├── operator/        # compiled operator JS (dist/) + node_modules
└── frontend/        # built frontend static files (served by the server at runtime)
```

The server resolves `../../frontend/dist` relative to its own `dist/` dir, so it automatically finds `~/rig-deploy/frontend/dist` when running from `~/rig-deploy/server/`.

### Services

| Service | Unit file | What it runs |
|---------|-----------|--------------|
| `rig-server` | `ops/rig-server.service` | Fastify API + WebSocket bridge + serves frontend static files |
| `rig-operator` | `ops/rig-operator.service` | Notification watcher / Telegram bridge |

Both services are **systemd user units** (no root required), installed in `~/.config/systemd/user/`. Lingering is enabled so they survive reboots without a login session.

### Deploying changes

Run `./deploy.sh` from the project root. It:
1. Builds frontend (`tsc -b && vite build`)
2. Builds server (`tsc`)
3. Builds operator (`tsc`)
4. `rsync`s compiled output + `node_modules` into `~/rig-deploy/`
5. Copies service unit files from `ops/` into `~/.config/systemd/user/`
6. Reloads systemd and restarts both services

```bash
cd ~/Projects/personal/rig
./deploy.sh
```

### Day-to-day service management

```bash
# Restart after a deploy
systemctl --user restart rig-server
systemctl --user restart rig-operator

# Check status
systemctl --user status rig-server
systemctl --user status rig-operator

# Follow logs
journalctl --user -fu rig-server
journalctl --user -fu rig-operator
```

### Service unit files

- `ops/rig-server.service` — server service definition
- `ops/rig-operator.service` — operator service definition
- `ops/rig.service` — legacy combined service (replaced; kept for reference)

The service template files in `ops/` use a `__NODE_BIN_DIR__` placeholder. `deploy.sh` resolves the current node binary path via `$(which node)` and substitutes it automatically — no manual updates needed when the node version changes.
