/**
 * Session store: list and read pi session files.
 *
 * Pi stores sessions as JSONL files in ~/.pi/agent/sessions/<encoded-cwd>/.
 * Each file has a session header (type: "session") followed by entry lines.
 * We parse these to build the session list for the board.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getSessionsDir } from "./pi-config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface SessionInfo {
	/** Absolute path to the .jsonl file */
	path: string;
	/** Session UUID */
	id: string;
	/** Working directory where the session was started */
	cwd: string;
	/** Project name (derived from cwd) */
	projectName: string;
	/** User-defined session name, if any */
	name?: string;
	/** First user message (truncated) */
	firstMessage: string;
	/** Creation timestamp */
	created: Date;
	/** Last modified timestamp */
	modified: Date;
	/** Number of message entries */
	messageCount: number;
	/** Last model used */
	lastModel?: string;
	/** Last provider used */
	lastProvider?: string;
	/** Last thinking level */
	thinkingLevel?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract project name from a cwd path.
 * Takes the last non-empty path segment.
 */
function projectNameFromCwd(cwd: string): string {
	const segments = cwd.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? "unknown";
}

/**
 * Parse session header and key metadata from a JSONL file.
 * Only reads enough to extract the header + scan for messages.
 * Returns null for invalid files.
 */
async function parseSessionFile(filePath: string): Promise<SessionInfo | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		if (lines.length === 0) return null;

		// Parse header
		let header: SessionHeader;
		try {
			header = JSON.parse(lines[0]);
		} catch {
			return null;
		}
		if (header.type !== "session" || !header.id) return null;

		const stats = await stat(filePath);

		let messageCount = 0;
		let firstMessage = "";
		let name: string | undefined;
		let lastModel: string | undefined;
		let lastProvider: string | undefined;
		let thinkingLevel: string | undefined;
		let lastActivityTime: number | undefined;

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);

				// Session info (name)
				if (entry.type === "session_info" && entry.name) {
					name = entry.name.trim();
				}

				// Track model changes
				if (entry.type === "model_change") {
					lastProvider = entry.provider;
					lastModel = entry.modelId;
				}

				// Track thinking level changes
				if (entry.type === "thinking_level_change") {
					thinkingLevel = entry.thinkingLevel;
				}

				// Messages
				if (entry.type === "message") {
					messageCount++;
					const msg = entry.message;
					if (!msg) continue;

					// Extract model from assistant messages
					if (msg.role === "assistant") {
						if (msg.provider) lastProvider = msg.provider;
						if (msg.model) lastModel = msg.model;
					}

					// First user message
					if (!firstMessage && msg.role === "user") {
						const text =
							typeof msg.content === "string"
								? msg.content
								: Array.isArray(msg.content)
									? msg.content
											.filter((b: any) => b.type === "text")
											.map((b: any) => b.text)
											.join(" ")
									: "";
						if (text) {
							firstMessage = text.slice(0, 200);
						}
					}

					// Track last activity time from timestamps
					const ts = msg.timestamp ?? (typeof entry.timestamp === "string" ? new Date(entry.timestamp).getTime() : undefined);
					if (typeof ts === "number" && ts > 0) {
						lastActivityTime = Math.max(lastActivityTime ?? 0, ts);
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		// Determine modified date
		let modified: Date;
		if (lastActivityTime && lastActivityTime > 0) {
			modified = new Date(lastActivityTime);
		} else {
			const headerTime = new Date(header.timestamp).getTime();
			modified = !isNaN(headerTime) ? new Date(headerTime) : stats.mtime;
		}

		return {
			path: filePath,
			id: header.id,
			cwd: header.cwd || "",
			projectName: projectNameFromCwd(header.cwd || ""),
			name,
			firstMessage: firstMessage || "(no messages)",
			created: new Date(header.timestamp),
			modified,
			messageCount,
			lastModel,
			lastProvider,
			thinkingLevel,
		};
	} catch {
		return null;
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * List all sessions across all projects.
 * Returns newest-modified first.
 */
export async function listAllSessions(): Promise<SessionInfo[]> {
	const sessionsDir = getSessionsDir();
	if (!existsSync(sessionsDir)) return [];

	const sessions: SessionInfo[] = [];

	try {
		const projectDirs = await readdir(sessionsDir, { withFileTypes: true });

		for (const dirEntry of projectDirs) {
			if (!dirEntry.isDirectory()) continue;
			const dirPath = join(sessionsDir, dirEntry.name);

			try {
				const files = await readdir(dirPath);
				const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

				const results = await Promise.all(
					jsonlFiles.map((f) => parseSessionFile(join(dirPath, f)))
				);

				for (const info of results) {
					if (info) sessions.push(info);
				}
			} catch {
				// Skip inaccessible directories
			}
		}
	} catch {
		return [];
	}

	// Sort newest first
	sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
	return sessions;
}

/**
 * List sessions for a specific project directory.
 */
export async function listSessionsForCwd(cwd: string): Promise<SessionInfo[]> {
	const sessionsDir = getSessionsDir();
	if (!existsSync(sessionsDir)) return [];

	// Encode cwd the same way pi does
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const dirPath = join(sessionsDir, safePath);

	if (!existsSync(dirPath)) return [];

	const sessions: SessionInfo[] = [];
	try {
		const files = await readdir(dirPath);
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

		const results = await Promise.all(
			jsonlFiles.map((f) => parseSessionFile(join(dirPath, f)))
		);

		for (const info of results) {
			if (info) sessions.push(info);
		}
	} catch {
		return [];
	}

	sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
	return sessions;
}

/**
 * Discover projects from session history.
 * Reads just the header line of one session file per directory — lightweight.
 * Returns unique cwd → projectName pairs.
 */
export async function discoverProjects(): Promise<Array<{ path: string; name: string }>> {
	const sessionsDir = getSessionsDir();
	if (!existsSync(sessionsDir)) return [];

	const seen = new Map<string, string>();

	try {
		const projectDirs = await readdir(sessionsDir, { withFileTypes: true });

		for (const dirEntry of projectDirs) {
			if (!dirEntry.isDirectory()) continue;
			const dirPath = join(sessionsDir, dirEntry.name);

			try {
				const files = await readdir(dirPath);
				const firstJsonl = files.find((f) => f.endsWith(".jsonl"));
				if (!firstJsonl) continue;

				// Read only the first line (session header) — fast
				const content = await readFile(join(dirPath, firstJsonl), "utf-8");
				const newlineIdx = content.indexOf("\n");
				const firstLine = newlineIdx > 0 ? content.slice(0, newlineIdx) : content;
				const header = JSON.parse(firstLine);

				if (header.type === "session" && header.cwd && !seen.has(header.cwd)) {
					seen.set(header.cwd, projectNameFromCwd(header.cwd));
				}
			} catch {
				// Skip unreadable directories
			}
		}
	} catch {
		return [];
	}

	return Array.from(seen.entries())
		.map(([path, name]) => ({ path, name }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read raw session entries from a session file.
 * Returns the full array of parsed JSONL lines.
 */
export async function readSessionEntries(sessionPath: string): Promise<any[]> {
	try {
		const content = await readFile(sessionPath, "utf-8");
		const entries: any[] = [];
		for (const line of content.trim().split("\n")) {
			if (!line.trim()) continue;
			try {
				entries.push(JSON.parse(line));
			} catch {
				// Skip malformed
			}
		}
		return entries;
	} catch {
		return [];
	}
}
