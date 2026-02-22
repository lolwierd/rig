/**
 * HTTP API routes for Rig.
 *
 * REST endpoints for session listing, project management, and model info.
 * WebSocket endpoint for live session interaction (proxied to pi RPC).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
	loadConfig,
	saveConfig,
	addProject,
	removeProject,
	type RigConfig,
} from "./config.js";
import { readPiSettings, getEnabledModels, getDefaultModel } from "./pi-config.js";
import { listAllSessions, listSessionsForCwd, readSessionEntries, discoverProjects } from "./session-store.js";
import {
	spawnPi,
	sendCommand,
	sendRaw,
	killBridge,
	type PiProcess,
} from "./pi-bridge.js";
import { FileTracker } from "./file-tracker.js";
import type { WebSocket } from "@fastify/websocket";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ActiveSession {
	bridge: PiProcess;
	fileTracker: FileTracker;
	wsClients: Set<WebSocket>;
	/** Buffer events until first WebSocket client connects */
	eventBuffer: any[];
}

const activeSessions = new Map<string, ActiveSession>();

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Wire a bridge's events to WebSocket clients and file tracker.
 * Buffers events until the first WS client connects so nothing is lost
 * between dispatch/resume and the frontend connecting.
 */
function registerSession(bridge: PiProcess): ActiveSession {
	const fileTracker = new FileTracker();
	const wsClients = new Set<WebSocket>();
	const eventBuffer: any[] = [];

	const session: ActiveSession = { bridge, fileTracker, wsClients, eventBuffer };
	activeSessions.set(bridge.id, session);

	bridge.events.on("event", (event: any) => {
		fileTracker.processEvent(event);
		if (wsClients.size === 0) {
			eventBuffer.push(event);
		} else {
			const json = JSON.stringify({ type: "event", event });
			for (const ws of wsClients) {
				if (ws.readyState === 1) ws.send(json);
			}
		}
	});

	bridge.events.on("exit", (info: any) => {
		const json = JSON.stringify({ type: "exit", ...info });
		for (const ws of wsClients) {
			if (ws.readyState === 1) ws.send(json);
		}
		// Clean up after a delay so clients can process the exit
		setTimeout(() => activeSessions.delete(bridge.id), 5000);
	});

	return session;
}

// ─── Route Registration ─────────────────────────────────────────────────────

export async function registerRoutes(app: FastifyInstance): Promise<void> {
	// ═══════════════════════════════════════════════════════════════════════
	// Health
	// ═══════════════════════════════════════════════════════════════════════

	app.get("/api/health", async () => {
		return { status: "ok", timestamp: new Date().toISOString() };
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Projects
	// ═══════════════════════════════════════════════════════════════════════

	app.get("/api/projects", async () => {
		const config = loadConfig();
		const discovered = await discoverProjects();

		// Merge: registered projects take priority (user-defined name), then discovered
		const seen = new Set<string>();
		const merged: Array<{ path: string; name: string }> = [];

		for (const p of config.projects) {
			seen.add(p.path);
			merged.push(p);
		}
		for (const p of discovered) {
			if (!seen.has(p.path)) {
				merged.push(p);
			}
		}

		return { projects: merged };
	});

	app.post("/api/projects", async (req: FastifyRequest<{ Body: { path: string; name: string } }>, reply: FastifyReply) => {
		const { path, name } = req.body;
		if (!path || !name) {
			return reply.code(400).send({ error: "path and name are required" });
		}
		let config = loadConfig();
		config = addProject(config, path, name);
		saveConfig(config);
		return { projects: config.projects };
	});

	app.delete("/api/projects", async (req: FastifyRequest<{ Body: { path: string } }>, reply: FastifyReply) => {
		const { path } = req.body;
		if (!path) {
			return reply.code(400).send({ error: "path is required" });
		}
		let config = loadConfig();
		config = removeProject(config, path);
		saveConfig(config);
		return { projects: config.projects };
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Browse filesystem (for folder picker)
	// ═══════════════════════════════════════════════════════════════════════

	app.get("/api/browse", async (req: FastifyRequest<{ Querystring: { path?: string } }>, reply: FastifyReply) => {
		const { readdir: readdirFs } = await import("node:fs/promises");
		const { homedir } = await import("node:os");
		const { dirname, join: joinPath, resolve: resolvePath } = await import("node:path");

		const targetPath = req.query.path ? resolvePath(req.query.path) : homedir();

		try {
			const entries = await readdirFs(targetPath, { withFileTypes: true });
			const directories = entries
				.filter((e) => e.isDirectory() && !e.name.startsWith("."))
				.map((e) => ({ name: e.name, path: joinPath(targetPath, e.name) }))
				.sort((a, b) => a.name.localeCompare(b.name));

			return {
				path: targetPath,
				parent: dirname(targetPath) !== targetPath ? dirname(targetPath) : null,
				directories,
			};
		} catch {
			return reply.code(400).send({ error: "Cannot read directory" });
		}
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Models
	// ═══════════════════════════════════════════════════════════════════════

	app.get("/api/models", async () => {
		const models = getEnabledModels();
		const defaultModel = getDefaultModel();
		return { models, defaultModel };
	});

	app.get("/api/settings", async () => {
		return readPiSettings();
	});

	// All available models (from pi's model registry — cached after first fetch)
	let allModelsCache: Array<{ provider: string; modelId: string; name: string; reasoning: boolean }> | null = null;

	app.get("/api/models/all", async (_req: FastifyRequest, reply: FastifyReply) => {
		if (allModelsCache) {
			return { models: allModelsCache };
		}

		// Try to get from an active bridge first
		for (const [, session] of activeSessions) {
			if (session.bridge.alive) {
				try {
					const resp = await sendCommand(session.bridge, { type: "get_available_models" }, 10000);
					if (resp.success && resp.data?.models) {
						allModelsCache = resp.data.models.map((m: any) => ({
							provider: m.provider,
							modelId: m.id,
							name: m.name,
							reasoning: !!m.reasoning,
						}));
						return { models: allModelsCache };
					}
				} catch {
					// Fall through
				}
			}
		}

		// No active bridge — spawn a temporary pi process
		let bridge: PiProcess | null = null;
		try {
			bridge = await spawnPi({ cwd: process.cwd() });
			const resp = await sendCommand(bridge, { type: "get_available_models" }, 10000);
			if (resp.success && resp.data?.models) {
				allModelsCache = resp.data.models.map((m: any) => ({
					provider: m.provider,
					modelId: m.id,
					name: m.name,
					reasoning: !!m.reasoning,
				}));
			}
			return { models: allModelsCache || [] };
		} catch (err: any) {
			return reply.code(500).send({ error: "Failed to fetch models: " + err.message });
		} finally {
			if (bridge) killBridge(bridge);
		}
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Sessions (read from pi's session files)
	// ═══════════════════════════════════════════════════════════════════════

	app.get("/api/sessions", async (req: FastifyRequest<{ Querystring: { cwd?: string } }>) => {
		const { cwd } = req.query;
		const sessions = cwd
			? await listSessionsForCwd(cwd)
			: await listAllSessions();

		// Build a map of sessionFile → bridgeId for active sessions
		const activeMap = new Map<string, string>();
		for (const [, active] of activeSessions) {
			if (active.bridge.sessionFile) {
				activeMap.set(active.bridge.sessionFile, active.bridge.id);
			}
		}

		return {
			sessions: sessions.map((s) => ({
				...s,
				isActive: activeMap.has(s.path),
				bridgeId: activeMap.get(s.path),
			})),
		};
	});

	app.get("/api/sessions/:id/entries", async (req: FastifyRequest<{ Params: { id: string }; Querystring: { path: string } }>, reply: FastifyReply) => {
		const { path } = req.query;
		if (!path) {
			return reply.code(400).send({ error: "path query parameter is required" });
		}
		const entries = await readSessionEntries(path);
		return { entries };
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Active sessions (bridges)
	// ═══════════════════════════════════════════════════════════════════════

	app.get("/api/active", async () => {
		const active: any[] = [];
		for (const [id, session] of activeSessions) {
			active.push({
				bridgeId: id,
				cwd: session.bridge.cwd,
				sessionFile: session.bridge.sessionFile,
				alive: session.bridge.alive,
				wsClients: session.wsClients.size,
				trackedFiles: session.fileTracker.getFiles(),
			});
		}
		return { active };
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Dispatch (spawn a new pi session)
	// ═══════════════════════════════════════════════════════════════════════

	app.post(
		"/api/dispatch",
		async (
			req: FastifyRequest<{
				Body: {
					cwd: string;
					message: string;
					provider?: string;
					model?: string;
				};
			}>,
			reply: FastifyReply,
		) => {
			const { cwd, message, provider, model } = req.body;
			if (!cwd) {
				return reply.code(400).send({ error: "cwd is required" });
			}

			try {
				const bridge = await spawnPi({ cwd, provider, model });
				registerSession(bridge);

				// Get session state (includes session file path)
				const stateResp = await sendCommand(bridge, { type: "get_state" });
				const sessionState = stateResp.success ? stateResp.data : null;

				if (sessionState?.sessionFile) {
					bridge.sessionFile = sessionState.sessionFile;
				}

				// Send the initial prompt — events are buffered until WS connects
				if (message) {
					await sendCommand(bridge, { type: "prompt", message });
				}

				return {
					bridgeId: bridge.id,
					sessionId: sessionState?.sessionId,
					sessionFile: sessionState?.sessionFile,
				};
			} catch (err: any) {
				return reply.code(500).send({ error: err.message });
			}
		},
	);

	// ═══════════════════════════════════════════════════════════════════════
	// Resume (attach to an existing session file)
	// ═══════════════════════════════════════════════════════════════════════

	app.post(
		"/api/resume",
		async (
			req: FastifyRequest<{
				Body: { sessionFile: string; cwd: string };
			}>,
			reply: FastifyReply,
		) => {
			const { sessionFile, cwd } = req.body;
			if (!sessionFile || !cwd) {
				return reply.code(400).send({ error: "sessionFile and cwd are required" });
			}

			// Check if already active
			for (const [, session] of activeSessions) {
				if (session.bridge.sessionFile === sessionFile) {
					return { bridgeId: session.bridge.id, alreadyActive: true };
				}
			}

			try {
				const bridge = await spawnPi({ cwd, sessionFile });
				registerSession(bridge);
				return { bridgeId: bridge.id };
			} catch (err: any) {
				return reply.code(500).send({ error: err.message });
			}
		},
	);

	// ═══════════════════════════════════════════════════════════════════════
	// Stop (kill an active session)
	// ═══════════════════════════════════════════════════════════════════════

	app.post(
		"/api/stop",
		async (req: FastifyRequest<{ Body: { bridgeId: string } }>, reply: FastifyReply) => {
			const { bridgeId } = req.body;
			const session = activeSessions.get(bridgeId);
			if (!session) {
				return reply.code(404).send({ error: "session not found" });
			}
			killBridge(session.bridge);
			return { stopped: true };
		},
	);

	// ═══════════════════════════════════════════════════════════════════════
	// WebSocket: live session interaction
	// ═══════════════════════════════════════════════════════════════════════

	app.get<{ Params: { bridgeId: string } }>(
		"/api/ws/:bridgeId",
		{ websocket: true },
		function (socket, req) {
			const { bridgeId } = req.params;
			const session = activeSessions.get(bridgeId);

			if (!session) {
				socket.close(4004, "Session not found");
				return;
			}

			// Send current state on connect
			sendCommand(session.bridge, { type: "get_state" })
				.then((state) => {
					if (socket.readyState === 1) {
						socket.send(JSON.stringify({ type: "state", data: state.data }));
					}
				})
				.catch(() => {});

			// Send tracked files on connect
			const files = session.fileTracker.getFiles();
			if (files.length > 0 && socket.readyState === 1) {
				socket.send(JSON.stringify({ type: "files", files }));
			}

			// Replay any buffered events (from before this client connected)
			for (const event of session.eventBuffer) {
				if (socket.readyState === 1) {
					socket.send(JSON.stringify({ type: "event", event }));
				}
			}
			session.eventBuffer = [];

			// Now add client — future events go directly via the event handler
			session.wsClients.add(socket);

			// Handle incoming commands from the client
			socket.on("message", async (raw: Buffer | string) => {
				try {
					const msg = JSON.parse(raw.toString());

					if (msg.type === "command") {
						// Forward command to pi and send response back
						try {
							const response = await sendCommand(session.bridge, msg.command);
							if (socket.readyState === 1) {
								socket.send(
									JSON.stringify({
										type: "response",
										requestId: msg.requestId,
										data: response,
									}),
								);
							}
						} catch (err: any) {
							if (socket.readyState === 1) {
								socket.send(
									JSON.stringify({
										type: "response",
										requestId: msg.requestId,
										error: err.message,
									}),
								);
							}
						}
					} else if (msg.type === "extension_ui_response") {
						// Forward extension UI responses directly
						sendRaw(session.bridge, msg.data);
					}
				} catch {
					// Ignore malformed messages
				}
			});

			// Handle disconnect
			socket.on("close", () => {
				session.wsClients.delete(socket);
			});
		},
	);
}
