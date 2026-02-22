# Rig — Implementation Plan

## Status Overview

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Done | Frontend shell — UI components, design system, layout |
| Phase 2 | ✅ Done | Server + real data — Fastify backend, session listing, pi config |
| Phase 3 | ✅ Done | Live sessions — WebSocket proxy, dispatching, streaming events |
| Phase 4 | ✅ Done | Polish — session content rendering, file tracking, error states |
| Phase 5 | ✅ Done | Production — Build pipeline, systemd/launchd configs |

---

## Phase 1 — Frontend Shell ✅

Built the entire UI in React + Tailwind CSS 4.

**What was built:**
- Design system in `index.css` — all color tokens, fonts (Bricolage Grotesque + IBM Plex Mono), animations
- `Board` — session list with search/filter, project badges, status dots, active-first sorting
- `SessionLog` — work log view with directives, tool call lines, prose, streaming cursor
- `ToolCallLine` — compact colored log line per tool call (read=blue, edit=amber, write=green, bash=violet)
- `NewDispatch` — bottom sheet (mobile) / modal (desktop) for dispatching work
- `EmptyDetail` — rich empty state with system status readiness panel, schematic SVG, CTA
- `FilesPanel` — side panel showing files touched in a session
- `ProjectBadge` — deterministic color from project name hash
- `StatusDot` — running (amber pulse), done (green), error (red)
- Responsive layout: master-detail on desktop, push-navigation on mobile
- Auto-select: picks running session or most recent on load

**Files:**
- `frontend/src/components/` — all UI components
- `frontend/src/lib/utils.ts` — project colors, tool colors, path truncation
- `frontend/src/types/index.ts` — TypeScript types
- `frontend/src/index.css` — Tailwind theme + base styles

---

## Phase 2 — Server + Real Data ✅

Built the Fastify backend that reads pi's real session files and config.

**What was built:**
- `server/src/index.ts` — Fastify server entry, CORS, static file serving, graceful shutdown
- `server/src/config.ts` — Rig config (project registry) at `~/.pi/agent/rig.json`
- `server/src/pi-config.ts` — Read pi's `settings.json` for models, defaults, thinking level
- `server/src/session-store.ts` — Parse pi's JSONL session files, list all sessions across all projects
- `server/src/pi-bridge.ts` — Spawn `pi --mode rpc` child processes, manage stdin/stdout JSON-RPC
- `server/src/file-tracker.ts` — Track files touched from `tool_execution_start` events
- `server/src/routes.ts` — REST + WebSocket routes
- `frontend/src/lib/api.ts` — API client with fetch helpers, time formatting, model display names
- Wired `App.tsx` to fetch real data from server

**Features:**
- List all sessions from `~/.pi/agent/sessions/`
- List sessions filtered by project directory
- Get enabled models + default from pi's settings.json
- Project registry management
- Raw pi settings exposure

---

## Phase 3 — Live Sessions ✅

Implemented real-time interaction with the `pi` agent.

**Features:**
- **Dispatch**: Spawns `pi --mode rpc` and tracks the process.
- **WebSocket Bridge**: Streams events from pi stdout to frontend.
- **Session Bridge Hook**: `useSessionBridge` manages socket connection and state updates.
- **Live Updates**: Prose streams character-by-character, tool calls appear instantly.
- **File Tracking**: Files touched by tools (read/edit/write) are tracked live.
- **Control**: Stop (kill process) and Resume (spawn with `--session`) implemented.

---

## Phase 4 — Polish ✅

Refined the experience and added advanced features.

**Features:**
- **Content Loading**: Historical sessions load full message history including past tool calls.
- **Tool Parsing**: Parsed `bash` commands and file operations from history.
- **Markdown**: Improved rendering with code blocks and lists.
- **Thinking Level**: Added UI to view and cycle thinking level (low/medium/high) for supported models (e.g. Claude 3.7).
- **Extension UI**: Added support for interactive extension requests (confirm, select, input) via a modal overlay.

---

## Phase 5 — Production ✅

Prepared for deployment.

**Features:**
- **Build Pipeline**: `tsc` + `vite build` for frontend, `tsc` for server.
- **Startup Script**: `start.sh` to build and run.
- **Process Management**:
  - `ops/rig.service` (Systemd)
  - `ops/com.lolwierd.rig.plist` (Launchd)
- **Static Serving**: Server serves the built frontend from `frontend/dist/`.

---

## Running

```bash
# Development (with HMR)
cd server && npm run dev
cd frontend && npm run dev

# Production
./start.sh
```

Server runs on port 3100 (configurable in `~/.pi/agent/rig.json`).
