# Rig

A dispatch console for the [pi](https://github.com/mariozechner/pi-coding-agent) coding agent. Dispatch work from your phone, watch it happen in real time, check back later.

Rig wraps `pi --mode rpc` as a web interface served over Tailscale — your personal operations dashboard for AI-assisted coding.

## What it looks like

- **The Board** — a flat list of all sessions across all projects, newest first. Active sessions pulse. Tap to open.
- **Session Log** — a work log, not a chatbot. Tool calls are first-class log entries (`read`, `edit`, `bash`, `write`) with markdown-rendered agent prose/thinking interspersed.
- **New Dispatch** — modal for sending work: pick a project, type a prompt, choose a model, choose thinking level (when supported), go. Under 5 seconds.

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org/) 20+, [pi](https://github.com/mariozechner/pi-coding-agent) installed globally (`npm i -g @mariozechner/pi-coding-agent`).

```bash
# Development (two terminals)
cd server && npm install && npm run dev    # Fastify on :3100
cd frontend && npm install && npm run dev  # Vite on :5173

# Production (single process)
./start.sh   # builds both, serves on :3100
```

Open `http://localhost:5173` (dev) or `http://localhost:3100` (production).

## Architecture

```
browser ←→ Vite/static ←→ Fastify ←→ pi --mode rpc (child process)
              :5173          :3100        stdin/stdout JSON-RPC
```

- **Frontend** — React 19, TypeScript, Tailwind CSS 4, Vite. Mobile-first responsive layout.
- **Server** — Fastify 5, WebSocket proxy, reads pi's session files and config directly from `~/.pi/agent/`.
- **No pi imports** — the server always spawns `pi --mode rpc` and talks over stdin/stdout. Whatever version of pi you have installed is what Rig uses.

### Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all sessions (optional `?cwd=` filter) |
| `GET` | `/api/sessions/:id/entries?path=` | Read parsed JSONL entries for a session file |
| `POST` | `/api/dispatch` | Start a new session `{ cwd, message, provider?, model?, thinkingLevel? }` |
| `POST` | `/api/resume` | Resume an existing session `{ sessionFile, cwd }` |
| `POST` | `/api/stop` | Kill an active session `{ bridgeId }` |
| `WS` | `/api/ws/:bridgeId` | Live event stream + command/response channel |
| `GET` | `/api/models` | Enabled models + default from pi settings |
| `GET` | `/api/models/all` | All available models from pi runtime |
| `GET` | `/api/models/capabilities` | Thinking levels for `{ provider, modelId }` |
| `GET` | `/api/projects` | Registered + auto-discovered project directories |
| `GET` | `/api/browse` | Directory browser data for project picker |

## Configuration

Rig stores its config at `~/.pi/agent/rig.json`:

```json
{
  "port": 3100,
  "projects": [
    { "path": "/home/you/projects/my-app", "name": "my-app" }
  ]
}
```

Projects are also auto-discovered from pi's session history — any directory where you've previously run pi will appear automatically.

Model configuration (enabled models, default model, API keys) is read from pi's own `~/.pi/agent/settings.json`.

## Deployment

The `ops/` directory has service configs for running Rig as a daemon:

- **macOS** — `ops/com.lolwierd.rig.plist` (launchd)
- **Linux** — `ops/rig.service` (systemd)

Intended to run on a home server or dev machine accessible over [Tailscale](https://tailscale.com/), so you can dispatch work from anywhere.

## Design

See [DESIGN.md](DESIGN.md) for the full design rationale — typography choices (Bricolage Grotesque + IBM Plex Mono), the warm charcoal + amber color palette, and why this is a work log instead of a chatbot.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite 7 |
| Icons | lucide-react |
| Server | Fastify 5, @fastify/websocket, @fastify/static |
| Agent | pi (`@mariozechner/pi-coding-agent`) via RPC |
| Runtime | Node.js 20+ |

## License

Personal project. Not published.
