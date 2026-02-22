/**
 * Read pi's own configuration files.
 *
 * Pi stores settings at ~/.pi/agent/settings.json and auth at ~/.pi/agent/auth.json.
 * We read (never write) these files so the web UI can show available models, current
 * defaults, etc. Model selection changes go through the pi RPC protocol.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface PiSettings {
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: string;
	enabledModels?: string[]; // "provider/model" format
	quietStartup?: boolean;
	theme?: string;
}

export interface PiModelRef {
	provider: string;
	modelId: string;
	displayName: string;
}

function getAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

export function readPiSettings(): PiSettings {
	const settingsPath = join(getAgentDir(), "settings.json");
	if (!existsSync(settingsPath)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch {
		return {};
	}
}

/**
 * Get the list of enabled models from pi's settings.
 * Returns parsed { provider, modelId, displayName } objects.
 */
export function getEnabledModels(): PiModelRef[] {
	const settings = readPiSettings();
	if (!settings.enabledModels || !Array.isArray(settings.enabledModels)) {
		return [];
	}
	return settings.enabledModels.map((entry) => {
		const slashIdx = entry.indexOf("/");
		if (slashIdx === -1) {
			return { provider: "unknown", modelId: entry, displayName: entry };
		}
		const provider = entry.slice(0, slashIdx);
		const modelId = entry.slice(slashIdx + 1);
		return { provider, modelId, displayName: modelId };
	});
}

/**
 * Get the default model from pi's settings.
 */
export function getDefaultModel(): PiModelRef | null {
	const settings = readPiSettings();
	if (!settings.defaultProvider || !settings.defaultModel) return null;
	return {
		provider: settings.defaultProvider,
		modelId: settings.defaultModel,
		displayName: settings.defaultModel,
	};
}

export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}
