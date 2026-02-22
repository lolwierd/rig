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
	startedAt: number;
	initialMessage?: string;
	thinkingLevel?: ThinkingLevel;
	lastKnownState?: {
		sessionId?: string;
		sessionFile?: string;
		provider?: string;
		modelId?: string;
		thinkingLevel?: ThinkingLevel;
	};
}

const activeSessions = new Map<string, ActiveSession>();

const THINKING_LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof THINKING_LEVEL_ORDER)[number];

// ─── Helpers ────────────────────────────────────────────────────────────────

function projectNameFromCwd(cwd: string): string {
	const parts = cwd.split("/").filter(Boolean);
	return parts[parts.length - 1] || "unknown";
}

function extractText(content: any): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((b) => b?.type === "text")
			.map((b) => b.text || "")
			.join("");
	}
	return "";
}

async function resolveThinkingLevelsForModel(provider: string, modelId: string): Promise<ThinkingLevel[]> {
	let bridge: PiProcess | null = null;
	const seen = new Set<ThinkingLevel>();
	try {
		bridge = await spawnPi({ cwd: process.cwd() });

		const setResp = await sendCommand(bridge, { type: "set_model", provider, modelId }, 10000);
		if (!setResp?.success) {
			throw new Error(setResp?.error || `Model not found: ${provider}/${modelId}`);
		}

		const stateResp = await sendCommand(bridge, { type: "get_state" }, 10000);
		if (!stateResp?.success) throw new Error(stateResp?.error || "Failed to fetch state");

		const model = stateResp.data?.model;
		const reasoning = !!model?.reasoning;
		const startLevel = (stateResp.data?.thinkingLevel || "off") as ThinkingLevel;

		if (!reasoning) {
			return ["off"];
		}

		seen.add(startLevel);
		for (let i = 0; i < THINKING_LEVEL_ORDER.length + 2; i++) {
			const cycleResp = await sendCommand(bridge, { type: "cycle_thinking_level" }, 10000);
			if (!cycleResp?.success || !cycleResp?.data?.level) break;
			const level = cycleResp.data.level as ThinkingLevel;
			if (seen.has(level)) break;
			seen.add(level);
		}

		await sendCommand(bridge, { type: "set_thinking_level", level: startLevel }, 5000).catch(() => {});
		const levels = THINKING_LEVEL_ORDER.filter((l) => seen.has(l));
		return levels.length > 0 ? levels : ["off", "minimal", "low", "medium", "high"];
	} finally {
		if (bridge) killBridge(bridge);
	}
}

/**
 * Wire a bridge's events to WebSocket clients and file tracker.
 * Buffers events until the first WS client connects so nothing is lost
 * between dispatch/resume and the frontend connecting.
 */
function registerSession(bridge: PiProcess): ActiveSession {
	const fileTracker = new FileTracker();
	const wsClients = new Set<WebSocket>();
	const eventBuffer: any[] = [];

	const session: ActiveSession = {
		bridge,
		fileTracker,
		wsClients,
		eventBuffer,
		startedAt: Date.now(),
	};
	activeSessions.set(bridge.id, session);

	bridge.events.on("event", (event: any) => {
		fileTracker.processEvent(event);

		if (event?.type === "thinking_level_change" && event.thinkingLevel) {
			session.thinkingLevel = event.thinkingLevel;
		}
		if (event?.type === "model_change") {
			session.lastKnownState = {
				...session.lastKnownState,
				provider: event.provider,
				modelId: event.modelId,
			};
		}
		if (event?.type === "message_start" && event.message?.role === "user" && !session.initialMessage) {
			const text = extractText(event.message.content).trim();
			if (text) session.initialMessage = text.slice(0, 200);
		}

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

	const modelThinkingCache = new Map<string, { levels: ThinkingLevel[]; at: number }>();

	app.get(
		"/api/models/capabilities",
		async (
			req: FastifyRequest<{ Querystring: { provider?: string; modelId?: string } }>,
			reply: FastifyReply,
		) => {
			const { provider, modelId } = req.query;
			if (!provider || !modelId) {
				return reply.code(400).send({ error: "provider and modelId are required" });
			}

			const key = `${provider}/${modelId}`;
			const cached = modelThinkingCache.get(key);
			if (cached && Date.now() - cached.at < 5 * 60_000) {
				return { provider, modelId, thinkingLevels: cached.levels };
			}

			try {
				const levels = await resolveThinkingLevelsForModel(provider, modelId);
				modelThinkingCache.set(key, { levels, at: Date.now() });
				return { provider, modelId, thinkingLevels: levels };
			} catch (err: any) {
				return reply.code(500).send({ error: err?.message || "Failed to resolve model capabilities" });
			}
		},
	);

	// ═══════════════════════════════════════════════════════════════════════
	// Sessions (read from pi's session files)
	// ═══════════════════════════════════════════════════════════════════════

	app.get("/api/sessions", async (req: FastifyRequest<{ Querystring: { cwd?: string } }>) => {
		const { cwd } = req.query;
		const fileSessions = cwd
			? await listSessionsForCwd(cwd)
			: await listAllSessions();

		// Build lookup maps for active sessions by both path and session ID.
		const activeByPath = new Map<string, string>();
		const activeById = new Map<string, string>();
		for (const [, active] of activeSessions) {
			if (active.bridge.sessionFile) activeByPath.set(active.bridge.sessionFile, active.bridge.id);
			if (active.bridge.sessionId) activeById.set(active.bridge.sessionId, active.bridge.id);
			if (active.lastKnownState?.sessionFile) activeByPath.set(active.lastKnownState.sessionFile, active.bridge.id);
			if (active.lastKnownState?.sessionId) activeById.set(active.lastKnownState.sessionId, active.bridge.id);
		}

		const merged = fileSessions.map((s) => {
			const bridgeId = activeByPath.get(s.path) || activeById.get(s.id);
			return {
				...s,
				isActive: !!bridgeId,
				bridgeId,
			};
		});

		// If a bridge is active but its session file isn't on disk yet, synthesize
		// a temporary row so users can reconnect after closing/reopening tabs.
		const knownIds = new Set(merged.map((s) => s.id));
		for (const [bridgeId, active] of activeSessions) {
			if (!active.bridge.alive) continue;
			if (cwd && active.bridge.cwd !== cwd) continue;

			const syntheticId =
				active.bridge.sessionId || active.lastKnownState?.sessionId || bridgeId;
			if (knownIds.has(syntheticId)) continue;

			merged.push({
				id: syntheticId,
				path: active.bridge.sessionFile || active.lastKnownState?.sessionFile || `active://${bridgeId}`,
				cwd: active.bridge.cwd,
				projectName: projectNameFromCwd(active.bridge.cwd),
				name: undefined,
				firstMessage: active.initialMessage || "(starting...)",
				created: new Date(active.startedAt),
				modified: new Date(),
				messageCount: active.initialMessage ? 1 : 0,
				lastModel: active.lastKnownState?.modelId,
				lastProvider: active.lastKnownState?.provider,
				thinkingLevel: active.thinkingLevel || active.lastKnownState?.thinkingLevel,
				isActive: true,
				bridgeId,
			});
			knownIds.add(syntheticId);
		}

		merged.sort((a: any, b: any) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
		return { sessions: merged };
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
				sessionId: session.bridge.sessionId,
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
					thinkingLevel?: ThinkingLevel;
				};
			}>,
			reply: FastifyReply,
		) => {
			const { cwd, message, provider, model, thinkingLevel } = req.body;
			if (!cwd) {
				return reply.code(400).send({ error: "cwd is required" });
			}
			if (thinkingLevel && !(THINKING_LEVEL_ORDER as readonly string[]).includes(thinkingLevel)) {
				return reply.code(400).send({ error: "thinkingLevel must be one of off, minimal, low, medium, high, xhigh" });
			}

			try {
				const bridge = await spawnPi({ cwd, provider, model });
				const active = registerSession(bridge);
				active.initialMessage = message?.trim() ? message.trim().slice(0, 200) : undefined;
				active.thinkingLevel = thinkingLevel;

				// Get session state (includes session file path)
				const stateResp = await sendCommand(bridge, { type: "get_state" });
				const sessionState = stateResp.success ? stateResp.data : null;

				if (sessionState?.sessionFile) {
					bridge.sessionFile = sessionState.sessionFile;
				}
				if (sessionState?.sessionId) {
					bridge.sessionId = sessionState.sessionId;
				}
				active.lastKnownState = {
					sessionId: sessionState?.sessionId,
					sessionFile: sessionState?.sessionFile,
					provider: sessionState?.provider || sessionState?.model?.provider,
					modelId: sessionState?.modelId || sessionState?.model?.id,
					thinkingLevel: sessionState?.thinkingLevel,
				};

				if (thinkingLevel) {
					await sendCommand(bridge, { type: "set_thinking_level", level: thinkingLevel });
				}

				// Send the initial prompt fire-and-forget — events are buffered until WS connects.
				// We intentionally don't await a prompt response here to avoid blocking dispatch
				// when the model starts streaming immediately.
				if (message) {
					sendRaw(bridge, { type: "prompt", message });
				}

				return {
					bridgeId: bridge.id,
					sessionId: bridge.sessionId || sessionState?.sessionId || bridge.id,
					sessionFile: bridge.sessionFile || sessionState?.sessionFile,
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
				const active = registerSession(bridge);
				const stateResp = await sendCommand(bridge, { type: "get_state" });
				const sessionState = stateResp.success ? stateResp.data : null;
				if (sessionState?.sessionFile) bridge.sessionFile = sessionState.sessionFile;
				if (sessionState?.sessionId) bridge.sessionId = sessionState.sessionId;
				active.lastKnownState = {
					sessionId: sessionState?.sessionId,
					sessionFile: sessionState?.sessionFile,
					provider: sessionState?.provider || sessionState?.model?.provider,
					modelId: sessionState?.modelId || sessionState?.model?.id,
					thinkingLevel: sessionState?.thinkingLevel,
				};
				active.thinkingLevel = sessionState?.thinkingLevel;
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
					const data = state?.data;
					if (data?.sessionFile) session.bridge.sessionFile = data.sessionFile;
					if (data?.sessionId) session.bridge.sessionId = data.sessionId;
					session.lastKnownState = {
						...session.lastKnownState,
						sessionId: data?.sessionId,
						sessionFile: data?.sessionFile,
						provider: data?.provider || data?.model?.provider,
						modelId: data?.modelId || data?.model?.id,
						thinkingLevel: data?.thinkingLevel,
					};
					if (data?.thinkingLevel) session.thinkingLevel = data.thinkingLevel;
					if (socket.readyState === 1) {
						socket.send(JSON.stringify({ type: "state", data }));
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
				const sendWsError = (requestId: string | undefined, message: string) => {
					if (socket.readyState !== 1) return;
					socket.send(
						JSON.stringify({
							type: "response",
							requestId,
							error: message,
						}),
					);
				};

				try {
					const msg = JSON.parse(raw.toString());

					if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
						sendWsError(undefined, "Malformed WS message");
						return;
					}

					if (msg.type === "command") {
						if (!msg.command || typeof msg.command !== "object" || typeof msg.command.type !== "string") {
							sendWsError(msg.requestId, "Invalid command payload");
							return;
						}

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
							sendWsError(msg.requestId, err.message || "Command failed");
						}
					} else if (msg.type === "extension_ui_response") {
						// Forward extension UI responses directly (must include type for pi RPC mode)
						const payload =
							msg.data && typeof msg.data === "object"
								? msg.data.type === "extension_ui_response"
									? msg.data
									: { type: "extension_ui_response", ...msg.data }
								: null;
						if (!payload || typeof (payload as any).id !== "string") {
							sendWsError(undefined, "Invalid extension_ui_response payload");
							return;
						}
						sendRaw(session.bridge, payload);
					} else {
						sendWsError(msg.requestId, `Unknown WS message type: ${msg.type}`);
					}
				} catch {
					sendWsError(undefined, "Failed to parse WS message");
				}
			});

			// Handle disconnect
			socket.on("close", () => {
				session.wsClients.delete(socket);
			});
		},
	);
}
