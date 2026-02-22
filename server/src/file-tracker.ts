/**
 * File tracker: extract files touched from pi RPC event stream.
 *
 * Parses tool_execution_start events to identify read/edit/write/bash operations
 * and maintains a per-session list of touched files.
 */

export interface TrackedFile {
	path: string;
	action: "read" | "edit" | "new" | "bash";
	/** Last time this file was touched */
	timestamp: number;
}

export class FileTracker {
	private files = new Map<string, TrackedFile>();

	/**
	 * Process an event from the pi event stream.
	 * Returns the tracked file if a new one was added/updated, null otherwise.
	 */
	processEvent(event: any): TrackedFile | null {
		if (event.type !== "tool_execution_start") return null;

		const { toolName, args } = event;
		if (!toolName || !args) return null;

		const now = Date.now();

		switch (toolName) {
			case "read": {
				const path = args.path;
				if (!path) return null;
				const file: TrackedFile = { path, action: "read", timestamp: now };
				this.files.set(path, file);
				return file;
			}
			case "edit": {
				const path = args.path;
				if (!path) return null;
				const file: TrackedFile = { path, action: "edit", timestamp: now };
				this.files.set(path, file);
				return file;
			}
			case "write": {
				const path = args.path;
				if (!path) return null;
				const file: TrackedFile = { path, action: "new", timestamp: now };
				this.files.set(path, file);
				return file;
			}
			case "bash": {
				// Don't track bash commands as files — they're commands, not file operations
				return null;
			}
			default:
				return null;
		}
	}

	/**
	 * Get all tracked files, sorted by most recently touched.
	 */
	getFiles(): TrackedFile[] {
		return Array.from(this.files.values()).sort((a, b) => b.timestamp - a.timestamp);
	}

	/**
	 * Clear all tracked files.
	 */
	clear(): void {
		this.files.clear();
	}
}
