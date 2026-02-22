/**
 * Rig API client.
 *
 * All requests use relative URLs so they work with both Vite's dev proxy
 * and production same-origin serving.
 */

import type { Session, Project, ModelInfo, ThinkingLevel } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: Record<string, any>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function del<T>(path: string, body: Record<string, any>): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

// ─── Time formatting ────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

// ─── Model display name ─────────────────────────────────────────────────────

/** Shorten a model ID for display. Generic — handles any model name. */
export function modelDisplayName(modelId?: string): string {
  if (!modelId) return "unknown";
  return modelId
    .replace(/-\d{8}$/, "")     // strip date suffixes (e.g. -20250514)
    .replace(/-preview$/, "");   // strip -preview
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Fetch all sessions across all projects */
export async function fetchSessions(): Promise<Session[]> {
  const data = await get<{ sessions: any[] }>("/api/sessions");
  return data.sessions.map((s) => ({
    id: s.id,
    path: s.path,
    cwd: s.cwd,
    projectName: s.projectName,
    name: s.name,
    firstMessage: s.firstMessage,
    status: s.isActive ? "running" : "done",
    model: modelDisplayName(s.lastModel),
    modelId: s.lastModel || "",
    provider: s.lastProvider || "",
    thinkingLevel: s.thinkingLevel,
    timeAgo: timeAgo(s.modified),
    messageCount: s.messageCount,
    isActive: s.isActive,
    bridgeId: s.bridgeId,
    created: s.created,
    modified: s.modified,
    entries: [],
    touchedFiles: [],
  }));
}

/** Fetch available models from pi's settings */
export async function fetchModels(): Promise<{
  models: ModelInfo[];
  defaultModel: ModelInfo | null;
}> {
  const data = await get<{
    models: Array<{ provider: string; modelId: string; displayName: string }>;
    defaultModel: { provider: string; modelId: string; displayName: string } | null;
  }>("/api/models");
  return {
    models: data.models.map((m) => ({
      ...m,
      displayName: modelDisplayName(m.modelId),
    })),
    defaultModel: data.defaultModel
      ? { ...data.defaultModel, displayName: modelDisplayName(data.defaultModel.modelId) }
      : null,
  };
}

/** Fetch registered projects */
export async function fetchProjects(): Promise<Project[]> {
  const data = await get<{ projects: Project[] }>("/api/projects");
  return data.projects;
}

/** Add a project */
export async function addProject(path: string, name: string): Promise<Project[]> {
  const data = await post<{ projects: Project[] }>("/api/projects", { path, name });
  return data.projects;
}

/** Remove a project */
export async function removeProject(path: string): Promise<Project[]> {
  const data = await del<{ projects: Project[] }>("/api/projects", { path });
  return data.projects;
}

/** Dispatch a new session */
export async function dispatch(
  cwd: string,
  message: string,
  provider?: string,
  model?: string,
  thinkingLevel?: ThinkingLevel,
): Promise<{ bridgeId: string; sessionId: string; sessionFile: string }> {
  return post("/api/dispatch", { cwd, message, provider, model, thinkingLevel });
}

/** Resume an existing session */
export async function resume(
  sessionFile: string,
  cwd: string,
): Promise<{ bridgeId: string; alreadyActive?: boolean }> {
  return post("/api/resume", { sessionFile, cwd });
}

/** Stop an active session */
export async function stopSession(bridgeId: string): Promise<{ stopped: boolean }> {
  return post("/api/stop", { bridgeId });
}

/** Fetch ALL available models from pi's model registry */
export async function fetchAllModels(): Promise<
  Array<{ provider: string; modelId: string; name: string; reasoning: boolean }>
> {
  const data = await get<{
    models: Array<{ provider: string; modelId: string; name: string; reasoning: boolean }>;
  }>("/api/models/all");
  return data.models;
}

/** Fetch exact thinking levels supported by a model (resolved via pi runtime) */
export async function fetchModelCapabilities(
  provider: string,
  modelId: string,
): Promise<{ provider: string; modelId: string; thinkingLevels: ThinkingLevel[] }> {
  const params = `?provider=${encodeURIComponent(provider)}&modelId=${encodeURIComponent(modelId)}`;
  return get(`/api/models/capabilities${params}`);
}

/** Browse server filesystem directories */
export async function browseDirectory(
  path?: string,
): Promise<{ path: string; parent: string | null; directories: Array<{ name: string; path: string }> }> {
  const params = path ? `?path=${encodeURIComponent(path)}` : "";
  return get(`/api/browse${params}`);
}

/** Build a WebSocket URL for a bridge */
export function wsUrl(bridgeId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws/${bridgeId}`;
}
