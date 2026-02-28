# Rig Architecture

## System Overview

Rig is a web frontend for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent). It provides a dispatch console UI where users can start, monitor, resume, and manage coding agent sessions across multiple projects.

The system has three components:

1. **Frontend** — React single-page application served by the server or Vite dev server
2. **Server** — Fastify HTTP + WebSocket server that spawns and manages pi RPC child processes
3. **Operator** — Independent process providing a Telegram bot and REST API for remote session control

The server never imports pi directly. Instead, it spawns `pi --mode rpc` as a child process and communicates via JSON lines over stdin/stdout. This means Rig always uses whatever pi version is installed globally — the RPC protocol is the integration boundary.

```
┌─────────────────┐     HTTP/WS      ┌──────────────┐    stdin/stdout    ┌──────────┐
│                 │ ◄──────────────► │              │ ◄────────────────► │          │
│    Frontend     │                  │    Server    │                    │  pi RPC  │
│  (React SPA)    │                  │  (Fastify)   │                    │ (child)  │
│                 │                  │              │                    │          │
└─────────────────┘                  └──────────────┘                    └──────────┘
                                            ▲
                                            │ HTTP
                                     ┌──────┴───────┐    stdin/stdout    ┌──────────┐
                                     │              │ ◄────────────────► │          │
                                     │   Operator   │                    │  pi RPC  │
                                     │  (Telegram)  │                    │ (child)  │
                                     │              │                    │          │
                                     └──────────────┘                    └──────────┘
```

---

## Component Architecture

### Frontend

**Stack:** React 19 + TypeScript + Tailwind CSS 4 + Vite

**Source:** `frontend/src/`

The frontend is a dispatch console, not a chatbot. Sessions are work orders. Tool calls are first-class log entries alongside assistant messages — not hidden behind expandable panels.

#### Components

| Component | File | Purpose |
|-----------|------|---------|
| `Board` | `components/Board.tsx` | Session list — the home screen showing all sessions across all projects |
| `SessionLog` | `components/SessionLog.tsx` | Work log view for a single session — messages, tool calls, streaming content |
| `NewDispatch` | `components/NewDispatch.tsx` | Modal for starting a new session — project picker, model selector, prompt input |
| `ModelPicker` | `components/ModelPicker.tsx` | Model and thinking level selector |
| `FolderPicker` | `components/FolderPicker.tsx` | Directory browser for selecting project working directories |
| `MarkdownMessage` | `components/MarkdownMessage.tsx` | Renders assistant messages as formatted markdown |
| `ToolCallLine` | `components/ToolCallLine.tsx` | Renders individual tool call entries (read, edit, write, bash, etc.) |
| `FilesPanel` | `components/FilesPanel.tsx` | Shows files touched during the active session |
| `ExtensionRequest` | `components/ExtensionRequest.tsx` | Renders extension UI requests from pi (approval prompts, etc.) |
| `ProjectBadge` | `components/ProjectBadge.tsx` | Colored badge showing project name |
| `StatusDot` | `components/StatusDot.tsx` | Animated status indicator for active sessions |
| `EmptyDetail` | `components/EmptyDetail.tsx` | Placeholder when no session is selected |

#### Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useSessionBridge` | `hooks/useSessionBridge.ts` | WebSocket state management — connects to `/api/ws/:bridgeId`, handles event streaming, command dispatch, reconnection |

#### Library

| Module | File | Purpose |
|--------|------|---------|
| `api` | `lib/api.ts` | HTTP client for all server REST endpoints |
| `utils` | `lib/utils.ts` | Shared utility functions |

#### Entry Points

| File | Purpose |
|------|---------|
| `App.tsx` | Root component — fetches sessions, manages routing, auto-selects active session |
| `main.tsx` | React DOM entry point |
| `index.css` | Tailwind CSS 4 config with `@theme` design tokens — custom color palette, fonts |

#### Design Tokens

- **Fonts:** Bricolage Grotesque (`font-ui` for UI/headings), IBM Plex Mono (`font-mono` for code/labels)
- **Colors:** Warm charcoal + amber accent. Dark mode is primary. All colors are custom tokens (amber, green, red, blue, violet).
- **Icons:** `lucide-react` — no other UI library.

### Server

**Stack:** Fastify 5 + TypeScript + ESM

**Source:** `server/src/`

| Module | File | Purpose |
|--------|------|---------|
| `index` | `src/index.ts` | Entry point — creates Fastify app, registers plugins (`@fastify/websocket`, `@fastify/cors`, `@fastify/static`), serves built frontend, handles graceful shutdown |
| `routes` | `src/routes.ts` | All HTTP and WebSocket route handlers — session management, model queries, dispatch/resume/stop, live WS proxying |
| `config` | `src/config.ts` | Project registry — reads/writes `~/.pi/agent/rig.json` |
| `pi-config` | `src/pi-config.ts` | Reads pi's `~/.pi/agent/settings.json` (read-only) — enabled models, defaults |
| `pi-bridge` | `src/pi-bridge.ts` | Spawns and manages `pi --mode rpc` child processes — JSON-RPC over stdin/stdout |
| `session-store` | `src/session-store.ts` | Parses pi's JSONL session files from `~/.pi/agent/sessions/` for listing |
| `file-tracker` | `src/file-tracker.ts` | Tracks files touched during a session by parsing `tool_execution_start` events |

#### Pi Bridge

The bridge manager (`pi-bridge.ts`) is the core integration layer:

- **`spawnPi(options)`** — spawns `pi --mode rpc` with optional `--session`, `--provider`, `--model` flags
- **`sendCommand(bridge, command)`** — sends a JSON-RPC command to pi's stdin and waits for the matching response (by request ID)
- **`sendRaw(bridge, data)`** — sends fire-and-forget data (e.g., extension UI responses)
- **`killBridge(bridge)`** — sends SIGTERM, then SIGKILL after 2 seconds
- **`killAll()`** — shuts down all bridges (used during server shutdown)

Each bridge has an `EventEmitter` that emits `event` (pi RPC events) and `exit` (process termination). Routes subscribe to these to forward events to WebSocket clients.

#### Active Session Management

The `routes.ts` module maintains an `activeSessions` map keyed by bridge ID. Each active session tracks:

- The `PiProcess` bridge
- A `FileTracker` instance
- Connected WebSocket clients
- An event buffer (for events that arrive before any WS client connects)
- Last known state (session ID, file, model, thinking level)

### Operator

**Stack:** Node.js + TypeScript + ESM

**Source:** `operator/src/`

The operator is an independent process that provides remote control of Rig sessions via Telegram and a REST API. It runs its own pi RPC instance with custom extensions for dispatching work to the main Rig server.

| Module | File | Purpose |
|--------|------|---------|
| `index` | `src/index.ts` | Entry point — starts platforms, watcher |
| `config` | `src/config.ts` | Operator-specific configuration |
| `session-manager` | `src/session-manager.ts` | Conversation lifecycle management |
| `notification-watcher` | `src/notification-watcher.ts` | Watches dispatched sessions for completion/updates |
| `pi-operator` | `src/pi-operator.ts` | Spawns the operator's own pi RPC instance |
| `telegram` | `src/platforms/telegram.ts` | Telegram bot platform adapter |
| `rest` | `src/platforms/rest.ts` | REST API platform adapter |

---

## Data Flow

### New Session

```
Frontend                    Server                     pi RPC
   │                          │                          │
   │  POST /api/dispatch      │                          │
   │  { cwd, message, ... }   │                          │
   │ ─────────────────────►   │                          │
   │                          │  spawn pi --mode rpc     │
   │                          │  --cwd <project>         │
   │                          │ ─────────────────────►   │
   │                          │                          │
   │                          │  get_state (stdin)       │
   │                          │ ─────────────────────►   │
   │                          │  state response (stdout) │
   │                          │ ◄─────────────────────   │
   │                          │                          │
   │                          │  prompt (stdin, fire&forget)
   │                          │ ─────────────────────►   │
   │                          │                          │
   │  { bridgeId, sessionId } │                          │
   │ ◄─────────────────────   │                          │
   │                          │                          │
   │  WS /api/ws/:bridgeId    │                          │
   │ ◄═══════════════════════►│                          │
   │                          │                          │
   │  state, buffered events  │  events (stdout)         │
   │ ◄═══════════════════════ │ ◄─────────────────────   │
   │                          │                          │
   │  streaming events        │  content_delta, etc.     │
   │ ◄═══════════════════════ │ ◄─────────────────────   │
```

Events are buffered between dispatch and WebSocket connection to avoid data loss.

### Resume Session

```
Frontend                    Server                     pi RPC
   │                          │                          │
   │  POST /api/resume        │                          │
   │  { sessionFile, cwd }    │                          │
   │ ─────────────────────►   │                          │
   │                          │  (check if already active)
   │                          │                          │
   │                          │  spawn pi --mode rpc     │
   │                          │  --session <file>        │
   │                          │ ─────────────────────►   │
   │                          │                          │
   │  { bridgeId }            │                          │
   │ ◄─────────────────────   │                          │
   │                          │                          │
   │  WS /api/ws/:bridgeId    │                          │
   │ ◄═══════════════════════►│                          │
```

If the session is already active, the existing bridge ID is returned with `alreadyActive: true`.

### Session Listing

```
Server reads:  ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl

Each directory under sessions/ encodes a project cwd:
  --home-user-Projects-my-app--/
    ├── abc-123.jsonl
    └── def-456.jsonl

Each JSONL file starts with a session header:
  {"type":"session","id":"abc-123","timestamp":"...","cwd":"/home/user/Projects/my-app"}

Followed by entry lines:
  {"type":"message","message":{"role":"user","content":"..."}}
  {"type":"message","message":{"role":"assistant","content":"..."}}
  {"type":"model_change","provider":"anthropic","modelId":"..."}
  {"type":"thinking_level_change","thinkingLevel":"medium"}
```

The session store parses just enough from each file to build the board listing: header, first user message, message count, last model, and last activity timestamp.

### Model Information

```
GET /api/models     → reads ~/.pi/agent/settings.json (enabledModels, defaults)
GET /api/models/all → queries pi RPC: get_available_models (cached)
GET /api/models/capabilities → spawns temp pi, cycles thinking levels (cached 5min)
```

---

## Key Design Decisions

### Spawn pi RPC, Don't Import pi

The server never imports pi as a library. It always spawns `pi --mode rpc` as a child process. This means:
- Rig uses whatever pi version is globally installed
- No tight coupling to pi internals
- The RPC protocol is a clean integration boundary
- Pi can be updated independently of Rig

### Dispatch Console, Not Chatbot

Sessions are work orders, not conversations. The UI is a dispatch console:
- The home screen ("The Board") shows all sessions across all projects in one flat list
- Tool calls are first-class log entries, not hidden behind chat bubbles
- The session view is a work log, not a chat thread

### Folder Scoping via Project Registry

Users register project directories. When starting a session, the server spawns pi with `--cwd <project>`. Projects are also auto-discovered from session history.

### File Tracking via Event Stream Parsing

Touched files are tracked by parsing `tool_execution_start` events from the pi RPC stream, specifically `read`, `edit`, and `write` tool calls. No git diffing or filesystem watching.

---

## Configuration

### Rig Config — `~/.pi/agent/rig.json`

```json
{
  "port": 3100,
  "projects": [
    { "path": "/home/user/Projects/my-app", "name": "my-app" }
  ],
  "operator": {
    "telegram": {
      "botToken": "...",
      "allowedChatIds": [12345]
    },
    "defaultModel": {
      "provider": "anthropic",
      "modelId": "claude-sonnet-4-20250514"
    }
  }
}
```

### Pi Settings — `~/.pi/agent/settings.json`

Read-only from Rig's perspective. Contains enabled models, default model/provider, thinking level preferences, and other pi configuration. Changes to model selection go through the pi RPC protocol.

### Pi Sessions — `~/.pi/agent/sessions/`

JSONL session files organized by encoded working directory. Shared between the pi CLI (`pi --resume`) and the Rig web UI — sessions are fully resumable across both interfaces.

---

## Deployment

### Directory Layout

```
~/rig-deploy/
├── server/          # Compiled server JS (dist/) + node_modules
│   ├── dist/
│   ├── node_modules/
│   └── package.json
├── operator/        # Compiled operator JS (dist/) + node_modules
│   ├── dist/
│   ├── node_modules/
│   └── package.json
└── frontend/        # Built frontend static files
    └── dist/
```

The server resolves `../../frontend/dist` relative to its own `dist/` directory, so it automatically finds the frontend build at `~/rig-deploy/frontend/dist`.

### Services

Both components run as **systemd user services** (no root required). Lingering is enabled so they survive reboots.

| Service | Unit File | Description |
|---------|-----------|-------------|
| `rig-server` | `ops/rig-server.service` | Fastify API + WebSocket bridge + frontend static files |
| `rig-operator` | `ops/rig-operator.service` | Telegram bot + REST API notification bridge |

Service unit files use a `__NODE_BIN_DIR__` placeholder that `deploy.sh` substitutes with the current node binary path.

### Deploy Script

`deploy.sh` at the project root:

1. Builds frontend (`npm run build` → Vite)
2. Builds server (`npm run build` → TypeScript)
3. Builds operator (`npm run build` → TypeScript)
4. `rsync`s compiled output + `node_modules` into `~/rig-deploy/`
5. Installs systemd unit files from `ops/` into `~/.config/systemd/user/`
6. Reloads systemd and restarts both services

```bash
cd ~/Projects/personal/rig
./deploy.sh              # full deploy + restart
./deploy.sh --no-restart # deploy without restarting services
```

### Development

```bash
# Terminal 1: Server (auto-reloads via tsx watch)
cd server && npm run dev

# Terminal 2: Frontend (Vite HMR)
cd frontend && npm run dev

# Frontend dev server: http://localhost:5173 (proxies /api/* to :3100)
# Server API: http://localhost:3100
```

---

## File Structure

```
rig/
├── frontend/                    # React SPA
│   ├── src/
│   │   ├── components/          # React components
│   │   │   ├── Board.tsx        # Session list (home screen)
│   │   │   ├── SessionLog.tsx   # Work log view
│   │   │   ├── NewDispatch.tsx  # New session modal
│   │   │   ├── ModelPicker.tsx  # Model + thinking level selector
│   │   │   ├── FolderPicker.tsx # Directory browser
│   │   │   ├── MarkdownMessage.tsx
│   │   │   ├── ToolCallLine.tsx
│   │   │   ├── FilesPanel.tsx
│   │   │   ├── ExtensionRequest.tsx
│   │   │   ├── ProjectBadge.tsx
│   │   │   ├── StatusDot.tsx
│   │   │   └── EmptyDetail.tsx
│   │   ├── hooks/
│   │   │   └── useSessionBridge.ts  # WebSocket state management
│   │   ├── lib/
│   │   │   ├── api.ts           # Server HTTP client
│   │   │   └── utils.ts         # Shared utilities
│   │   ├── types/               # TypeScript type definitions
│   │   ├── App.tsx              # Root component
│   │   ├── main.tsx             # Entry point
│   │   └── index.css            # Tailwind config + design tokens
│   └── vite.config.ts           # Proxies /api/* to server:3100
├── server/                      # Fastify backend
│   └── src/
│       ├── index.ts             # HTTP + WS server entry
│       ├── routes.ts            # REST + WebSocket route handlers
│       ├── config.ts            # Project registry (rig.json)
│       ├── pi-config.ts         # Read pi settings (settings.json)
│       ├── pi-bridge.ts         # Spawn & manage pi RPC processes
│       ├── session-store.ts     # Parse JSONL session files
│       └── file-tracker.ts      # Track files from tool events
├── operator/                    # Telegram/REST bridge
│   └── src/
│       ├── index.ts             # Entry point
│       ├── config.ts            # Operator configuration
│       ├── session-manager.ts   # Conversation lifecycle
│       ├── notification-watcher.ts # Watch dispatched sessions
│       ├── pi-operator.ts       # Operator's pi RPC instance
│       └── platforms/
│           ├── telegram.ts      # Telegram bot adapter
│           └── rest.ts          # REST API adapter
├── ops/                         # Deployment configs
│   ├── rig-server.service       # systemd unit for server
│   └── rig-operator.service     # systemd unit for operator
├── docs/                        # Documentation
│   ├── API.md                   # API reference
│   └── ARCHITECTURE.md          # This file
├── deploy.sh                    # Build + deploy script
├── DESIGN.md                    # Design philosophy + visual direction
├── PLAN.md                      # Implementation plan
└── AGENTS.md                    # Agent instructions
```
