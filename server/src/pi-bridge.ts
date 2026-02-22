/**
 * Pi Bridge: spawn and manage pi RPC child processes.
 *
 * Each active session gets one `pi --mode rpc` process.
 * We proxy JSON-RPC commands/responses between WebSocket clients and pi's stdin/stdout.
 *
 * Protocol:
 * - Commands are JSON lines written to pi's stdin
 * - Responses (type: "response") and events are JSON lines read from pi's stdout
 * - Events are forwarded to all WebSocket subscribers for that session
 */

import { ChildProcess, spawn } from "node:child_process";
import * as readline from "node:readline";
import { EventEmitter } from "node:events";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PiBridgeOptions {
	/** Working directory for the pi process */
	cwd: string;
	/** Optional: resume a specific session file */
	sessionFile?: string;
	/** Optional: provider override */
	provider?: string;
	/** Optional: model override */
	model?: string;
}

export interface PiProcess {
	/** Unique ID for this bridge instance */
	id: string;
	/** The child process */
	process: ChildProcess;
	/** Working directory */
	cwd: string;
	/** Session file path (if resuming) */
	sessionFile?: string;
	/** Event emitter for JSON events from pi's stdout */
	events: EventEmitter;
	/** Collected stderr for debugging */
	stderr: string;
	/** Whether the process is still alive */
	alive: boolean;
	/** Pending request resolvers (keyed by request id) */
	pendingRequests: Map<string, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>;
	/** Request ID counter */
	nextRequestId: number;
}

// ─── Bridge Manager ─────────────────────────────────────────────────────────

const activeBridges = new Map<string, PiProcess>();

let bridgeIdCounter = 0;

/**
 * Find the pi CLI binary path.
 * Uses `which pi` to find the globally installed version.
 */
async function findPiBinary(): Promise<string> {
	return new Promise((resolve, reject) => {
		const which = spawn("which", ["pi"]);
		let stdout = "";
		which.stdout.on("data", (d) => (stdout += d.toString()));
		which.on("close", (code) => {
			if (code === 0 && stdout.trim()) {
				resolve(stdout.trim());
			} else {
				reject(new Error("Could not find 'pi' binary. Is it installed globally?"));
			}
		});
	});
}

/**
 * Spawn a new pi RPC process.
 */
export async function spawnPi(options: PiBridgeOptions): Promise<PiProcess> {
	const piPath = await findPiBinary();
	const id = `bridge_${++bridgeIdCounter}`;

	const args = ["--mode", "rpc"];

	if (options.sessionFile) {
		args.push("--session", options.sessionFile);
	}
	if (options.provider) {
		args.push("--provider", options.provider);
	}
	if (options.model) {
		args.push("--model", options.model);
	}

	const child = spawn(piPath, args, {
		cwd: options.cwd,
		env: { ...process.env },
		stdio: ["pipe", "pipe", "pipe"],
	});

	const bridge: PiProcess = {
		id,
		process: child,
		cwd: options.cwd,
		sessionFile: options.sessionFile,
		events: new EventEmitter(),
		stderr: "",
		alive: true,
		pendingRequests: new Map(),
		nextRequestId: 0,
	};

	// Collect stderr
	child.stderr?.on("data", (data) => {
		bridge.stderr += data.toString();
	});

	// Parse stdout JSON lines
	const rl = readline.createInterface({
		input: child.stdout!,
		terminal: false,
	});

	rl.on("line", (line) => {
		try {
			const data = JSON.parse(line);

			// Check if it's a response to a pending request
			if (data.type === "response" && data.id && bridge.pendingRequests.has(data.id)) {
				const pending = bridge.pendingRequests.get(data.id)!;
				bridge.pendingRequests.delete(data.id);
				clearTimeout(pending.timer);
				pending.resolve(data);
				return;
			}

			// Otherwise it's an event — emit to subscribers
			bridge.events.emit("event", data);
		} catch {
			// Non-JSON line, ignore
		}
	});

	// Handle process exit
	child.on("exit", (code, signal) => {
		bridge.alive = false;
		bridge.events.emit("exit", { code, signal });

		// Reject all pending requests
		for (const [id, pending] of bridge.pendingRequests) {
			clearTimeout(pending.timer);
			pending.reject(new Error(`Pi process exited (code=${code}, signal=${signal})`));
		}
		bridge.pendingRequests.clear();

		activeBridges.delete(bridge.id);
	});

	// Wait a brief moment for startup
	await new Promise((resolve) => setTimeout(resolve, 200));

	if (!bridge.alive) {
		throw new Error(`Pi process exited immediately. Stderr: ${bridge.stderr}`);
	}

	activeBridges.set(bridge.id, bridge);
	return bridge;
}

/**
 * Send a command to pi and wait for its response.
 */
export function sendCommand(bridge: PiProcess, command: Record<string, any>, timeoutMs = 30000): Promise<any> {
	if (!bridge.alive) {
		return Promise.reject(new Error("Pi process is not alive"));
	}

	const id = `req_${++bridge.nextRequestId}`;
	const fullCommand = { ...command, id };

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			bridge.pendingRequests.delete(id);
			reject(new Error(`Timeout waiting for response to ${command.type}`));
		}, timeoutMs);

		bridge.pendingRequests.set(id, { resolve, reject, timer });
		bridge.process.stdin!.write(JSON.stringify(fullCommand) + "\n");
	});
}

/**
 * Send a fire-and-forget command (no response expected, e.g. extension_ui_response).
 */
export function sendRaw(bridge: PiProcess, data: Record<string, any>): void {
	if (!bridge.alive) return;
	bridge.process.stdin!.write(JSON.stringify(data) + "\n");
}

/**
 * Kill a pi process gracefully.
 */
export function killBridge(bridge: PiProcess): void {
	if (!bridge.alive) return;
	bridge.process.kill("SIGTERM");

	// Force kill after 2s
	setTimeout(() => {
		if (bridge.alive) {
			bridge.process.kill("SIGKILL");
		}
	}, 2000);
}

/**
 * Kill all active bridges (for shutdown).
 */
export function killAll(): void {
	for (const bridge of activeBridges.values()) {
		killBridge(bridge);
	}
}
