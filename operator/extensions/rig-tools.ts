import { Type } from "@sinclair/typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

type ExtensionAPI = {
  on(event: "before_agent_start", handler: () => Promise<{ message: { customType: string; display: boolean; content: string } }>): void;
  registerTool(definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (toolCallId: string, params: any) => Promise<ToolResult>;
  }): void;
};

const rigUrl = process.env.RIG_URL || "http://localhost:3100";
const DUPLICATE_DISPATCH_WINDOW_MS = 45_000;
const recentDispatches = new Map<string, { at: number; details: any }>();
const AWAITING_MODEL_WINDOW_MS = 10 * 60_000;
const awaitingModelSelection = new Map<string, number>();

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type RigProject = { path: string; name: string };

function titleFromPrompt(prompt: string): string {
  return prompt
    .trim()
    .split(/\s+/)
    .slice(0, 7)
    .join(" ")
    .replace(/[\r\n]+/g, " ");
}

async function getJson(pathname: string): Promise<any> {
  const resp = await fetch(`${rigUrl}${pathname}`);
  if (!resp.ok) {
    throw new Error(`Rig API ${pathname} failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

async function postJson(pathname: string, body: unknown): Promise<any> {
  const resp = await fetch(`${rigUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Rig API ${pathname} failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  return resp.json();
}

function compactToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]+/g, "").trim();
}

const GENERIC_FOLDER_HINTS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "here",
  "current",
  "my",
  "your",
  "default",
  "project",
  "folder",
  "repo",
  "directory",
]);

function dispatchDedupeKey(
  cwd: string,
  message: string,
  provider?: string,
  model?: string,
  thinkingLevel?: ThinkingLevel,
): string {
  return [
    cwd,
    message.trim().toLowerCase().replace(/\s+/g, " "),
    provider || "",
    model || "",
    thinkingLevel || "",
  ].join("::");
}

function dispatchRequestKey(cwd: string, message: string, thinkingLevel?: ThinkingLevel): string {
  return [
    cwd,
    message.trim().toLowerCase().replace(/\s+/g, " "),
    thinkingLevel || "",
  ].join("::");
}

function pathBasename(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || pathname;
}

function extractExplicitFolderTarget(message: string, cwdHint?: string): string | undefined {
  const rx = /\b(?:in|into|for|on)\s+([a-z0-9._-]+)\s+(?:folder|project|repo|directory)\b/i;
  const match = message.match(rx);
  if (match?.[1]) {
    const token = compactToken(match[1]);
    if (token && !GENERIC_FOLDER_HINTS.has(token)) {
      return token;
    }
  }

  const rx2 = /\b([a-z0-9._-]+)\s+(?:folder|project|repo|directory)\b/i;
  const match2 = message.match(rx2);
  if (match2?.[1]) {
    const token = compactToken(match2[1]);
    if (token && !GENERIC_FOLDER_HINTS.has(token)) {
      return token;
    }
  }

  if (cwdHint && !cwdHint.startsWith("/")) {
    const hint = compactToken(cwdHint);
    if (hint && hint.length >= 3 && !GENERIC_FOLDER_HINTS.has(hint)) return hint;
  }

  return undefined;
}

async function resolveDispatchCwd(message: string, cwdHint?: string): Promise<
  | { ok: true; cwd: string }
  | { ok: false; error: string; projects: RigProject[] }
> {
  const data = await getJson("/api/projects");
  const projects: RigProject[] = (data.projects || []).filter((p: any) => p?.path && p?.name);

  if (projects.length === 0) {
    return { ok: false, error: "No projects are registered in Rig yet.", projects: [] };
  }

  const trimmedHint = (cwdHint || "").trim();
  const explicitTarget = extractExplicitFolderTarget(message, cwdHint);

  if (explicitTarget) {
    const exact = projects.filter((project) => {
      const base = compactToken(pathBasename(project.path));
      const name = compactToken(project.name);
      return base === explicitTarget || name === explicitTarget;
    });

    if (exact.length === 1) {
      return { ok: true, cwd: exact[0].path };
    }
    if (exact.length > 1) {
      return {
        ok: false,
        error: `Multiple folders match '${explicitTarget}'. Pick one to continue.`,
        projects: exact.slice(0, 12),
      };
    }

    return {
      ok: false,
      error: `Couldn't find folder '${explicitTarget}'. Pick a project to continue.`,
      projects: projects
        .filter((project) => {
          const base = compactToken(pathBasename(project.path));
          const name = compactToken(project.name);
          return base.includes(explicitTarget) || name.includes(explicitTarget);
        })
        .slice(0, 12),
    };
  }

  if (trimmedHint.startsWith("/")) {
    const direct = projects.find((p) => p.path === trimmedHint);
    if (direct) {
      return { ok: true, cwd: direct.path };
    }
    return {
      ok: false,
      error: `Project path '${trimmedHint}' is not registered. Pick one to continue.`,
      projects: projects.slice(0, 12),
    };
  }

  return {
    ok: false,
    error: "Project not specified. Pick one to continue.",
    projects: projects.slice(0, 12),
  };
}

export default function rigTools(pi: ExtensionAPI) {
  pi.on("before_agent_start", async () => {
    return {
      message: {
        customType: "rig-operator-context",
        display: false,
        content: `You are Rig Operator: a general-purpose assistant that can also control Rig coding sessions.

Behavior:
- If user asks a quick question, answer directly.
- If user asks for substantial coding changes, multi-step refactors, or long-running tasks, call rig_dispatch.
- For dispatch: first resolve project explicitly (prefer exact path/name, or use rig_list_projects), then call rig_dispatch.
- Do not guess project folders from fuzzy wording. If uncertain, ask user or trigger project picker flow.
- When dispatching, mention the generated short title in your response.
- You can check status, logs, stop, or resume sessions using rig_* tools.
- Keep responses concise and clear.`
      }
    };
  });

  pi.registerTool({
    name: "rig_list_projects",
    label: "Rig List Projects",
    description: "List available Rig projects that can be used for dispatch.",
    parameters: Type.Object({}),
    async execute() {
      const data = await getJson("/api/projects");
      return {
        content: [{ type: "text", text: JSON.stringify(data.projects || [], null, 2) }],
        details: data,
      };
    },
  });

  pi.registerTool({
    name: "rig_list_sessions",
    label: "Rig List Sessions",
    description: "List Rig sessions with optional project cwd filter.",
    parameters: Type.Object({
      cwd: Type.Optional(Type.String({ description: "Optional absolute project path" })),
    }),
    async execute(_id: string, params: { cwd?: string }) {
      const query = params.cwd ? `?cwd=${encodeURIComponent(params.cwd)}` : "";
      const data = await getJson(`/api/sessions${query}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data.sessions || [], null, 2) }],
        details: data,
      };
    },
  });

  pi.registerTool({
    name: "rig_models",
    label: "Rig Models",
    description: "Get Rig enabled models and default model.",
    parameters: Type.Object({}),
    async execute() {
      const data = await getJson("/api/models");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: data,
      };
    },
  });

  pi.registerTool({
    name: "rig_dispatch",
    label: "Rig Dispatch",
    description: "Dispatch a new coding task to Rig for long-running or multi-step execution.",
    parameters: Type.Object({
      cwd: Type.Optional(Type.String({ description: "Absolute project path or project/folder hint" })),
      message: Type.String({ description: "Task prompt for Rig" }),
      provider: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      thinkingLevel: Type.Optional(Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
      ])),
    }),
    async execute(
      _id: string,
      params: {
        cwd?: string;
        message: string;
        provider?: string;
        model?: string;
        thinkingLevel?: ThinkingLevel;
      },
    ) {
      const title = titleFromPrompt(params.message);
      const resolved = await resolveDispatchCwd(params.message, params.cwd);
      if (!resolved.ok) {
        const details = {
          needsProject: true,
          message: params.message,
          provider: params.provider,
          model: params.model,
          thinkingLevel: params.thinkingLevel,
          title,
          error: resolved.error,
          projects: resolved.projects,
        };
        return {
          content: [{ type: "text", text: `Project selection required before dispatch. ${resolved.error}` }],
          details,
        };
      }

      const cwd = resolved.cwd;
      const requestKey = dispatchRequestKey(cwd, params.message, params.thinkingLevel);
      const now = Date.now();
      const awaitingSince = awaitingModelSelection.get(requestKey);
      if (awaitingSince && now - awaitingSince < AWAITING_MODEL_WINDOW_MS && params.provider && params.model) {
        const details = {
          awaitingModelSelection: true,
          cwd,
          message: params.message,
          thinkingLevel: params.thinkingLevel,
          title,
          error: "Waiting for user-selected model from Telegram picker.",
        };
        return {
          content: [{ type: "text", text: "Dispatch is waiting for explicit user model selection in Telegram." }],
          details,
        };
      }

      if (!params.provider || !params.model) {
        awaitingModelSelection.set(requestKey, Date.now());
        const details = {
          needsModel: true,
          cwd,
          message: params.message,
          thinkingLevel: params.thinkingLevel,
          title,
          error: "Model not specified",
        };
        return {
          content: [{ type: "text", text: "Model selection required before dispatch." }],
          details,
        };
      }

      const payload = {
        cwd,
        message: params.message,
        provider: params.provider,
        model: params.model,
        thinkingLevel: params.thinkingLevel as ThinkingLevel | undefined,
      };
      const dedupeKey = dispatchDedupeKey(cwd, params.message, params.provider, params.model, params.thinkingLevel);
      const existing = recentDispatches.get(dedupeKey);
      if (existing && now - existing.at < DUPLICATE_DISPATCH_WINDOW_MS) {
        const details = { ...existing.details, deduped: true, dedupeWindowMs: DUPLICATE_DISPATCH_WINDOW_MS, title };
        return {
          content: [{ type: "text", text: `Reusing recent dispatch: ${title}\n${JSON.stringify(details, null, 2)}` }],
          details,
        };
      }
      let data: any;
      try {
        data = await postJson("/api/dispatch", payload);
        recentDispatches.set(dedupeKey, { at: now, details: { ...data } });
        awaitingModelSelection.delete(requestKey);
      } catch (error: any) {
        const errorText = String(error?.message || error);
        if (/model|provider|not found|invalid/i.test(errorText)) {
          const details = {
            needsModel: true,
            cwd,
            message: params.message,
            thinkingLevel: params.thinkingLevel,
            title,
            error: errorText,
          };
          return {
            content: [{ type: "text", text: `Dispatch failed due to model selection: ${errorText}` }],
            details,
          };
        }
        throw error;
      }

      const details = { ...data, title };
      return {
        content: [{ type: "text", text: `Dispatched: ${title}\n${JSON.stringify(details, null, 2)}` }],
        details,
      };
    },
  });

  pi.registerTool({
    name: "rig_session_status",
    label: "Rig Session Status",
    description: "Check status for a running bridge and summarize recent events.",
    parameters: Type.Object({
      bridgeId: Type.String({ description: "Bridge ID from dispatch or active list" }),
    }),
    async execute(_id: string, params: { bridgeId: string }) {
      const active = await getJson("/api/active");
      const session = (active.active || []).find((item: any) => item.bridgeId === params.bridgeId);
      if (!session) {
        return {
          content: [{ type: "text", text: `No active bridge found for ${params.bridgeId}` }],
          details: { found: false, bridgeId: params.bridgeId },
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
        details: { found: true, session },
      };
    },
  });

  pi.registerTool({
    name: "rig_session_log",
    label: "Rig Session Log",
    description: "Fetch entries from a specific session file.",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID in URL path" }),
      path: Type.String({ description: "Absolute session file path" }),
    }),
    async execute(_id: string, params: { sessionId: string; path: string }) {
      const query = `?path=${encodeURIComponent(params.path)}`;
      const data = await getJson(`/api/sessions/${encodeURIComponent(params.sessionId)}/entries${query}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data.entries || [], null, 2) }],
        details: data,
      };
    },
  });

  pi.registerTool({
    name: "rig_stop_session",
    label: "Rig Stop Session",
    description: "Stop a currently active Rig bridge.",
    parameters: Type.Object({
      bridgeId: Type.String(),
    }),
    async execute(_id: string, params: { bridgeId: string }) {
      const data = await postJson("/api/stop", { bridgeId: params.bridgeId });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: data,
      };
    },
  });

  pi.registerTool({
    name: "rig_resume_session",
    label: "Rig Resume Session",
    description: "Resume a Rig session from a session file and cwd.",
    parameters: Type.Object({
      sessionFile: Type.String(),
      cwd: Type.String(),
    }),
    async execute(_id: string, params: { sessionFile: string; cwd: string }) {
      const data = await postJson("/api/resume", {
        sessionFile: params.sessionFile,
        cwd: params.cwd,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: data,
      };
    },
  });
}
