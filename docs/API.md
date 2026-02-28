# Rig API Reference

The Rig server runs on port **3100** by default (configurable via `~/.pi/agent/rig.json`). All endpoints are under `/api/`.

The server accepts a body limit of 50 MB to accommodate image attachments.

---

## Health

### `GET /api/health`

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

---

## Projects

### `GET /api/projects`

List all known projects. Merges registered projects (from `rig.json`) with auto-discovered projects (from session history). Registered projects take priority for naming.

**Response:**

```json
{
  "projects": [
    { "path": "/home/user/Projects/my-app", "name": "my-app" }
  ]
}
```

### `POST /api/projects`

Register a new project directory.

**Request body:**

```json
{
  "path": "/home/user/Projects/my-app",
  "name": "my-app"
}
```

**Response:** `{ "projects": [...] }` — updated project list.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | `path` or `name` missing |

### `DELETE /api/projects`

Remove a registered project.

**Request body:**

```json
{
  "path": "/home/user/Projects/my-app"
}
```

**Response:** `{ "projects": [...] }` — updated project list.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | `path` missing |

---

## Browse

### `GET /api/browse`

Directory browser for the project/folder picker UI. Lists subdirectories (excluding hidden directories starting with `.`).

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | Home directory | Absolute path to browse |

**Response:**

```json
{
  "path": "/home/user/Projects",
  "parent": "/home/user",
  "directories": [
    { "name": "my-app", "path": "/home/user/Projects/my-app" },
    { "name": "other-project", "path": "/home/user/Projects/other-project" }
  ]
}
```

`parent` is `null` when at the filesystem root.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Directory cannot be read |

---

## Models

### `GET /api/models`

Get enabled models and the current default from pi's `settings.json`.

**Response:**

```json
{
  "models": [
    { "provider": "anthropic", "modelId": "claude-sonnet-4-20250514", "displayName": "claude-sonnet-4-20250514" }
  ],
  "defaultModel": {
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-20250514",
    "displayName": "claude-sonnet-4-20250514"
  }
}
```

`defaultModel` is `null` if no default is configured.

### `GET /api/models/all`

Get all available models from pi's runtime model registry. The result is cached after the first successful fetch.

If an active pi bridge exists, it queries that bridge. Otherwise, it spawns a temporary pi process to fetch the list.

**Response:**

```json
{
  "models": [
    { "provider": "anthropic", "modelId": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4", "reasoning": true }
  ]
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 500 | Failed to spawn pi or fetch models |

### `GET /api/models/capabilities`

Resolve the supported thinking levels for a specific model. Results are cached for 5 minutes.

Spawns a temporary pi process, sets the model, and cycles through thinking levels to discover which are available.

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | Model provider (e.g. `anthropic`) |
| `modelId` | string | Yes | Model identifier |

**Response:**

```json
{
  "provider": "anthropic",
  "modelId": "claude-sonnet-4-20250514",
  "thinkingLevels": ["off", "minimal", "low", "medium", "high"]
}
```

**Thinking level enum values:** `"off"` | `"minimal"` | `"low"` | `"medium"` | `"high"` | `"xhigh"`

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | `provider` or `modelId` missing |
| 500 | Failed to resolve capabilities |

### `GET /api/settings`

Return the raw pi settings object from `~/.pi/agent/settings.json`.

**Response:**

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "enabledModels": ["anthropic/claude-sonnet-4-20250514"],
  "quietStartup": false,
  "theme": "dark"
}
```

All fields are optional and may be absent if not configured.

---

## Sessions

### `GET /api/sessions`

List all sessions across all projects. Sessions are parsed from pi's JSONL session files in `~/.pi/agent/sessions/`. Active sessions that don't yet have a session file on disk are synthesized into the list so they remain accessible.

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | No | Filter to sessions from this working directory |

**Response:**

```json
{
  "sessions": [
    {
      "id": "abc-123-def",
      "path": "/home/user/.pi/agent/sessions/--home-user-Projects-my-app--/abc-123-def.jsonl",
      "cwd": "/home/user/Projects/my-app",
      "projectName": "my-app",
      "name": "Refactor auth module",
      "firstMessage": "Refactor the authentication module to use JWT",
      "created": "2025-01-15T10:00:00.000Z",
      "modified": "2025-01-15T12:30:00.000Z",
      "messageCount": 12,
      "lastModel": "claude-sonnet-4-20250514",
      "lastProvider": "anthropic",
      "thinkingLevel": "medium",
      "isActive": true,
      "bridgeId": "bridge_7"
    }
  ]
}
```

Sessions are sorted newest-modified first. `isActive` is `true` if the session has a running pi bridge. `bridgeId` is present only for active sessions.

### `GET /api/sessions/:id/entries`

Read the parsed JSONL entries for a session file.

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the `.jsonl` session file |

**Response:**

```json
{
  "entries": [
    { "type": "session", "id": "abc-123", "timestamp": "...", "cwd": "..." },
    { "type": "message", "message": { "role": "user", "content": "..." } },
    { "type": "message", "message": { "role": "assistant", "content": "..." } }
  ]
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | `path` query parameter missing |

---

## Active Sessions

### `GET /api/active`

List all currently active pi bridges (running pi RPC processes).

**Response:**

```json
{
  "active": [
    {
      "bridgeId": "bridge_7",
      "sessionId": "abc-123-def",
      "cwd": "/home/user/Projects/my-app",
      "sessionFile": "/home/user/.pi/agent/sessions/.../abc-123-def.jsonl",
      "alive": true,
      "wsClients": 1,
      "trackedFiles": [
        { "path": "src/auth.ts", "action": "edit", "timestamp": 1705312200000 }
      ]
    }
  ]
}
```

---

## Dispatch & Control

### `POST /api/dispatch`

Spawn a new pi RPC session. The server starts a `pi --mode rpc` child process in the specified working directory and optionally sends an initial prompt.

Events are buffered until a WebSocket client connects, so nothing is lost between dispatch and the frontend opening the WS connection.

**Request body:**

```json
{
  "cwd": "/home/user/Projects/my-app",
  "message": "Refactor the auth module",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "thinkingLevel": "medium",
  "images": [
    { "url": "data:image/png;base64,...", "mediaType": "image/png" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | Yes | Working directory for the session |
| `message` | string | No | Initial prompt to send |
| `provider` | string | No | Model provider override |
| `model` | string | No | Model ID override |
| `thinkingLevel` | ThinkingLevel | No | Thinking level to set |
| `images` | array | No | Image attachments as data URLs |

**Response:**

```json
{
  "bridgeId": "bridge_7",
  "sessionId": "abc-123-def",
  "sessionFile": "/home/user/.pi/agent/sessions/.../abc-123-def.jsonl"
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | `cwd` missing, or invalid `thinkingLevel` value |
| 500 | Failed to spawn pi process |

### `POST /api/resume`

Resume an existing session by its session file. If the session is already active, returns the existing bridge ID without spawning a new process.

**Request body:**

```json
{
  "sessionFile": "/home/user/.pi/agent/sessions/.../abc-123-def.jsonl",
  "cwd": "/home/user/Projects/my-app"
}
```

**Response:**

```json
{
  "bridgeId": "bridge_7",
  "alreadyActive": true
}
```

`alreadyActive` is only present (and `true`) when the session was already running.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | `sessionFile` or `cwd` missing |
| 500 | Failed to spawn pi process |

### `POST /api/stop`

Kill an active pi session.

**Request body:**

```json
{
  "bridgeId": "bridge_7"
}
```

**Response:**

```json
{
  "stopped": true
}
```

The bridge sends a `SIGTERM` to the pi process, followed by `SIGKILL` after 2 seconds if it hasn't exited.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Bridge ID not found |

---

## WebSocket

### `WS /api/ws/:bridgeId`

Live event stream for an active session. Connect after dispatching or resuming a session using the returned `bridgeId`.

On connect, the server sends:
1. A `state` message with the current pi session state
2. A `files` message with any tracked files (if non-empty)
3. All buffered events that occurred before this client connected

#### Server → Client messages

**State** — current pi session state (sent on connect):
```json
{
  "type": "state",
  "data": {
    "sessionId": "abc-123",
    "sessionFile": "/path/to/session.jsonl",
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-20250514",
    "thinkingLevel": "medium"
  }
}
```

**Files** — tracked files list (sent on connect if non-empty):
```json
{
  "type": "files",
  "files": [
    { "path": "src/auth.ts", "action": "edit", "timestamp": 1705312200000 }
  ]
}
```

**Event** — pi RPC event (streamed continuously):
```json
{
  "type": "event",
  "event": {
    "type": "message_start",
    "message": { "role": "assistant", "content": "..." }
  }
}
```

Common event types from pi: `message_start`, `content_delta`, `message_end`, `tool_execution_start`, `tool_execution_end`, `model_change`, `thinking_level_change`, `extension_ui_request`.

**Exit** — pi process exited:
```json
{
  "type": "exit",
  "code": 0,
  "signal": null
}
```

**Response** — reply to a client command:
```json
{
  "type": "response",
  "requestId": "req_1",
  "data": { "success": true, "data": { ... } }
}
```

Error responses include an `error` field instead of `data`:
```json
{
  "type": "response",
  "requestId": "req_1",
  "error": "Command failed"
}
```

#### Client → Server messages

**Command** — forward a command to the pi RPC process:
```json
{
  "type": "command",
  "requestId": "req_1",
  "command": {
    "type": "prompt",
    "message": "Continue with the next step"
  }
}
```

Pi command types include: `prompt`, `get_state`, `set_model`, `set_thinking_level`, `cycle_thinking_level`, `get_available_models`, and others defined by the pi RPC protocol.

**Extension UI response** — reply to an extension UI request from pi:
```json
{
  "type": "extension_ui_response",
  "data": {
    "id": "ext_req_1",
    "type": "extension_ui_response",
    "approved": true
  }
}
```

#### WebSocket errors

If the `bridgeId` is invalid, the WebSocket is closed with code `4004` and reason `"Session not found"`.

Malformed messages receive an error response:
```json
{
  "type": "response",
  "error": "Malformed WS message"
}
```

---

## Error Response Format

All error responses follow a consistent format:

```json
{
  "error": "Description of what went wrong"
}
```

| Status Code | When |
|-------------|------|
| 400 | Missing required parameters or invalid values |
| 404 | Resource not found (bridge ID, non-API route) |
| 500 | Internal error (pi process failure, model fetch failure) |

Non-API routes return `index.html` for SPA routing when the built frontend is present.
