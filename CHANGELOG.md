# Changelog

## Unreleased

- Added Markdown + GFM rendering for session directives, assistant prose, and thinking traces to improve readability of rich responses.
- Added model capability resolution (`/api/models/capabilities`) and wired thinking-level UI to real per-model support (`off` through `xhigh` where available).
- Improved active session continuity by synthesizing active rows before session files are flushed, buffering bridge events until WebSocket attach, and matching active sessions by both session path and session ID.
- Hardened the WebSocket command channel with request/response IDs, timeout/error propagation, and extension UI response forwarding.
- Improved session UX with forced auto-scroll after sending steer/follow-up messages and normalized footer/input row sizing for cleaner layout alignment.
- Updated project docs (`README.md`, `AGENTS.md`, `PLAN.md`) to reflect current API surface and shipped behavior.

## 0.2.0

- Fixed newly dispatched sessions not auto-selecting in the UI — pi defers writing session files to disk until the first assistant message, so `loadData()` would miss them. Dispatch now creates a placeholder session immediately and merges it with polled data.
- Removed model name column from the Board list to give more space to task summaries. Model info is still visible on hover and in the session detail header.
- Redesigned the Model Picker with a cleaner popover layout — searchable, two-line entries (display name + model ID), amber selection state with checkmark.
- Updated DESIGN.md with Board layout changes and Model Picker design notes.

## 0.1.0

- Frontend shell: Board, SessionLog, NewDispatch, EmptyDetail, FilesPanel, and all supporting components.
- Fastify server reading pi's session files and settings from `~/.pi/agent/`.
- Live sessions via WebSocket proxy to `pi --mode rpc` child processes.
- Dispatch, resume, and stop controls.
- Session content loading with full message history and tool call parsing.
- Thinking level cycling (low/medium/high) for supported models.
- Extension UI support (confirm, select, input modals).
- File tracking from tool execution events.
- Production build pipeline with `start.sh`, launchd and systemd service configs.
