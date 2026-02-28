/**
 * Rig server configuration.
 *
 * Manages the project registry and server settings.
 * Stored in ~/.pi/agent/rig.json alongside pi's own config.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface RigProject {
	path: string;
	name: string;
}

export interface RigOperatorConfig {
	telegram?: {
		botToken?: string;
		allowedChatIds?: number[];
	};
	defaultModel?: {
		provider?: string;
		modelId?: string;
	};
}

export interface RigConfig {
	port: number;
	projects: RigProject[];
	operator?: RigOperatorConfig;
}

const DEFAULT_CONFIG: RigConfig = {
	port: 3100,
	projects: [],
};

function getAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

function getConfigPath(): string {
	return join(getAgentDir(), "rig.json");
}

export function loadConfig(): RigConfig {
	const configPath = getConfigPath();
	if (!existsSync(configPath)) {
		return { ...DEFAULT_CONFIG };
	}
	try {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw);
		return {
			port: parsed.port ?? DEFAULT_CONFIG.port,
			projects: Array.isArray(parsed.projects) ? parsed.projects : [],
			operator: typeof parsed.operator === "object" && parsed.operator !== null ? parsed.operator : undefined,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function saveConfig(config: RigConfig): void {
	const agentDir = getAgentDir();
	if (!existsSync(agentDir)) {
		mkdirSync(agentDir, { recursive: true });
	}
	writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

export function addProject(config: RigConfig, path: string, name: string): RigConfig {
	// Deduplicate by path
	const filtered = config.projects.filter((p) => p.path !== path);
	return { ...config, projects: [...filtered, { path, name }] };
}

export function removeProject(config: RigConfig, path: string): RigConfig {
	return { ...config, projects: config.projects.filter((p) => p.path !== path) };
}
