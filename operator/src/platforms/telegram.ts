import { Markup, Telegraf } from "telegraf";
import WebSocket from "ws";
import { saveDefaultModelToRigConfig } from "../config.js";
import type { NotificationWatcher } from "../notification-watcher.js";
import type { SessionManager } from "../session-manager.js";
import type { ModelInfo, OperatorConfig, PromptImage, ThinkingLevel } from "../types.js";

const TELEGRAM_TEXT_LIMIT = 4096;
const VERBOSE_LOGS = process.env.OPERATOR_VERBOSE_LOGS !== "0";

function logInfo(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log("[telegram]", message, meta);
    return;
  }
  console.log("[telegram]", message);
}

function logDebug(message: string, meta?: Record<string, unknown>): void {
  if (!VERBOSE_LOGS) return;
  if (meta) {
    console.log("[telegram:debug]", message, meta);
    return;
  }
  console.log("[telegram:debug]", message);
}

function telegramErrorSummary(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return String(error || "");

  const asRecord = error as {
    message?: unknown;
    description?: unknown;
    response?: { description?: unknown; error_code?: unknown };
  };

  const responseDesc = typeof asRecord.response?.description === "string" ? asRecord.response.description : "";
  const description = typeof asRecord.description === "string" ? asRecord.description : "";
  const message = typeof asRecord.message === "string" ? asRecord.message : "";

  return [responseDesc, description, message].filter(Boolean).join(" | ");
}

function isNotModifiedEditError(error: unknown): boolean {
  return telegramErrorSummary(error).toLowerCase().includes("message is not modified");
}

function telegramRetryAfterSeconds(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const asRecord = error as {
    parameters?: { retry_after?: unknown };
    response?: { parameters?: { retry_after?: unknown } };
    description?: unknown;
    message?: unknown;
  };

  const direct = Number(asRecord.parameters?.retry_after);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const nested = Number(asRecord.response?.parameters?.retry_after);
  if (Number.isFinite(nested) && nested > 0) return nested;

  const summary = telegramErrorSummary(error);
  const match = summary.match(/retry after\s+(\d+)/i);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return undefined;
}

async function withTelegramRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      const retryAfter = telegramRetryAfterSeconds(error);
      const isRateLimited = retryAfter !== undefined || telegramErrorSummary(error).includes("429");
      if (!isRateLimited || attempt >= maxAttempts - 1) {
        throw error;
      }

      const delayMs = Math.max(1000, ((retryAfter ?? 2) + 1) * 1000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
}

function escapeMarkdownV2(input: string): string {
  return input.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function renderTelegramBody(text: string, toolCalls: string[]): string {
  const safeText = escapeMarkdownV2(text || "...");
  const annotations = Array.from(new Set(toolCalls.slice(-3))).map((name) => `_Using ${escapeMarkdownV2(name)}\\.\\.\\._`);
  const joined = annotations.length > 0 ? `${safeText}\n\n${annotations.join("\n")}` : safeText;
  if (joined.length <= TELEGRAM_TEXT_LIMIT) {
    return joined;
  }
  return joined.slice(0, TELEGRAM_TEXT_LIMIT - 20) + "\n\n\\(truncated\\)";
}

async function extractPhotoAsDataUrl(ctx: any): Promise<PromptImage[] | undefined> {
  const photos = ctx.message?.photo;
  if (!Array.isArray(photos) || photos.length === 0) {
    return undefined;
  }
  const best = photos[photos.length - 1];
  const link = await ctx.telegram.getFileLink(best.file_id);
  const resp = await fetch(String(link));
  if (!resp.ok) {
    return undefined;
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const b64 = Buffer.from(bytes).toString("base64");
  return [{ url: `data:image/jpeg;base64,${b64}`, mediaType: "image/jpeg" }];
}

function isAllowedChat(chatId: number, allowed: number[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.includes(chatId);
}

async function fetchRecentRigSessions(rigUrl: string): Promise<Array<{ id: string; projectName?: string; firstMessage?: string; modified?: string }>> {
  const resp = await fetch(`${rigUrl}/api/sessions`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch sessions: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return (data.sessions || []).slice(0, 10);
}

async function fetchEnabledModels(rigUrl: string): Promise<ModelInfo[]> {
  // Prefer full runtime model registry so /model and /modeldefault show all models,
  // not just settings.enabledModels.
  try {
    const allResp = await fetch(`${rigUrl}/api/models/all`);
    if (allResp.ok) {
      const allData = await allResp.json();
      const models: ModelInfo[] = Array.isArray(allData.models)
        ? allData.models.map((m: any) => ({
            provider: String(m.provider || ""),
            modelId: String(m.modelId || m.id || ""),
            displayName: String(m.name || m.modelId || m.id || ""),
          }))
        : [];

      return models
        .filter((m: ModelInfo) => m.provider && m.modelId)
        .sort((a: ModelInfo, b: ModelInfo) => `${a.provider}/${a.modelId}`.localeCompare(`${b.provider}/${b.modelId}`));
    }
  } catch {
    // Fall back to enabled models endpoint below.
  }

  const resp = await fetch(`${rigUrl}/api/models`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch models: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return data.models || [];
}

async function fetchRigProjects(rigUrl: string): Promise<Array<{ path: string; name: string }>> {
  const resp = await fetch(`${rigUrl}/api/projects`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch projects: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return data.projects || [];
}

async function fetchModelCapabilities(rigUrl: string, provider: string, modelId: string): Promise<ThinkingLevel[]> {
  const params = `provider=${encodeURIComponent(provider)}&modelId=${encodeURIComponent(modelId)}`;
  const resp = await fetch(`${rigUrl}/api/models/capabilities?${params}`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch model capabilities: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  if (!Array.isArray(data.thinkingLevels)) {
    return ["off"];
  }
  return data.thinkingLevels;
}

function supportsThinking(levels: ThinkingLevel[]): boolean {
  return levels.some((level) => level !== "off");
}

function thinkingLabel(level: ThinkingLevel): string {
  return level === "minimal" ? "min" : level === "medium" ? "med" : level;
}

function compactModelRef(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function wsUrlForBridge(rigUrl: string, bridgeId: string): string {
  return rigUrl.replace(/^http/, "ws") + `/api/ws/${encodeURIComponent(bridgeId)}`;
}

function extractAssistantTextFromEvent(event: any): string {
  const message = event?.message;
  if (!message || message.role !== "assistant") {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text || ""))
    .join("\n")
    .trim();
}

async function fetchActiveBridges(rigUrl: string): Promise<Array<{ bridgeId: string; cwd: string; sessionId?: string; sessionFile?: string }>> {
  const resp = await fetch(`${rigUrl}/api/active`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch active sessions: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  return data.active || [];
}

async function fetchRecentBridgeMessages(
  rigUrl: string,
  sessionId?: string,
  sessionFile?: string,
  limit = 8,
): Promise<string[]> {
  if (!sessionId || !sessionFile) {
    return [];
  }

  const resp = await fetch(`${rigUrl}/api/sessions/${encodeURIComponent(sessionId)}/entries?path=${encodeURIComponent(sessionFile)}`);
  if (!resp.ok) {
    return [];
  }

  const data = await resp.json();
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry?.type !== "message" || !entry.message) {
      continue;
    }
    const role = entry.message.role === "assistant" ? "Assistant" : entry.message.role === "user" ? "User" : "System";
    const content = entry.message.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.filter((b: any) => b?.type === "text").map((b: any) => String(b.text || "")).join("\n")
        : "";
    const clean = text.trim();
    if (!clean) {
      continue;
    }
    lines.push(`${role}: ${clean.replace(/\s+/g, " ").slice(0, 320)}`);
  }

  return lines.slice(-limit);
}

function titleFromPrompt(prompt: string): string {
  return prompt.trim().split(/\s+/).slice(0, 7).join(" ").replace(/[\r\n]+/g, " ");
}

async function dispatchWithModel(
  rigUrl: string,
  payload: { cwd: string; message: string; provider: string; model: string; thinkingLevel?: ThinkingLevel },
): Promise<{ bridgeId: string; sessionId?: string; sessionFile?: string }> {
  const resp = await fetch(`${rigUrl}/api/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json();
}

type ActiveBridge = { bridgeId: string; cwd: string; sessionId?: string; sessionFile?: string };
type DispatchProject = { path: string; name: string };
const MODELS_PER_PAGE = 10;
const PROJECTS_PER_PAGE = 8;
type PendingDispatch = {
  cwd?: string;
  message: string;
  thinkingLevel?: ThinkingLevel;
  provider?: string;
  model?: string;
};

type ThinkingSelectionAction = "model:set" | "model:default" | "model:dispatch";

type PendingThinkingSelection = {
  action: ThinkingSelectionAction;
  provider: string;
  modelId: string;
  levels: ThinkingLevel[];
};

function topicKey(chatId: number, threadId?: number): string {
  return `${chatId}:${threadId || 0}`;
}

function operatorConversationId(chatId: number, threadId?: number): string {
  return `telegram:${topicKey(chatId, threadId)}`;
}

function parseTelegramConversationId(conversationId: string): { chatId: number; threadId?: number } | null {
  if (!conversationId.startsWith("telegram:")) {
    return null;
  }

  const [chatToken, threadToken] = conversationId.slice("telegram:".length).split(":");
  const chatId = Number(chatToken);
  const threadId = Number(threadToken || "0");
  if (!Number.isFinite(chatId)) {
    return null;
  }

  return {
    chatId,
    threadId: Number.isFinite(threadId) && threadId !== 0 ? threadId : undefined,
  };
}

function currentThreadIdFromCtx(ctx: any): number | undefined {
  return (
    (ctx.message as any)?.message_thread_id ??
    (ctx.callbackQuery as any)?.message?.message_thread_id
  ) as number | undefined;
}

export async function startTelegramBot(config: OperatorConfig, sessions: SessionManager, watcher: NotificationWatcher): Promise<Telegraf | null> {
  if (!config.telegram.botToken) {
    return null;
  }

  const bot = new Telegraf(config.telegram.botToken, { handlerTimeout: 10 * 60_000 });

  bot.catch((error, ctx) => {
    const chatId = ctx.chat?.id;
    console.error("Telegram update handler error", {
      chatId,
      updateType: ctx.updateType,
      updateId: (ctx.update as any)?.update_id,
      error,
    });
  });

  const modelPickerCache = new Map<string, ModelInfo[]>();
  const modelPickerPageByTopic = new Map<string, number>();
  const modelCapabilityCache = new Map<string, ThinkingLevel[]>();
  const pendingThinkingByTopic = new Map<string, PendingThinkingSelection>();
  const activeBridgePickerCache = new Map<string, ActiveBridge[]>();
  const projectPickerCache = new Map<string, DispatchProject[]>();
  const projectPickerPageByTopic = new Map<string, number>();
  const pendingDispatchByTopic = new Map<string, PendingDispatch>();
  const recentPickerPrompts = new Map<string, number>();
  const recentInboundMessages = new Map<string, number>();
  const activeStreamSockets = new Map<string, WebSocket>();
  const topicToBridge = new Map<string, { bridgeId: string; ws: WebSocket; chatId: number; threadId?: number }>();
  const telegramCommands = [
    { command: "status", description: "Show active operator session status" },
    { command: "sessions", description: "List recent Rig sessions" },
    { command: "active", description: "List active Rig bridges" },
    { command: "connect", description: "Connect a bridge stream to this topic" },
    { command: "topic", description: "Show connected bridge for this topic" },
    { command: "disconnect", description: "Disconnect this topic from a bridge" },
    { command: "model", description: "Set model for this Telegram chat" },
    { command: "modeldefault", description: "Set operator default model" },
    { command: "modelstatus", description: "Show model resolution status" },
    { command: "clear", description: "Clear this chat conversation context" },
  ] as const;

  const registerTelegramCommands = async (): Promise<void> => {
    const baseScopes: Array<Record<string, unknown> | undefined> = [
      undefined,
      { type: "all_private_chats" },
      { type: "all_group_chats" },
      { type: "all_chat_administrators" },
    ];

    const chatScopes = config.telegram.allowedChatIds.map((chatId) => ({ type: "chat", chat_id: chatId }));
    const scopes = [...baseScopes, ...chatScopes];

    for (const scope of scopes) {
      try {
        if (scope) {
          await bot.telegram.deleteMyCommands({ scope: scope as any });
          await bot.telegram.setMyCommands(telegramCommands as any, { scope: scope as any });
        } else {
          await bot.telegram.deleteMyCommands();
          await bot.telegram.setMyCommands(telegramCommands as any);
        }
      } catch (error: any) {
        logInfo("Telegram command registration failed for scope", {
          scope: scope || { type: "default" },
          error: error?.message || String(error),
        });
      }
    }

    logInfo("Telegram commands registered", {
      count: telegramCommands.length,
      scopeCount: scopes.length,
    });
  };

  const renderModelButtons = (scopeKey: string, prefix: "model:set" | "model:default" | "model:dispatch", page = 0) => {
    const models = modelPickerCache.get(scopeKey) || [];
    const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(models.length / MODELS_PER_PAGE) - 1)));
    const start = safePage * MODELS_PER_PAGE;
    const end = start + MODELS_PER_PAGE;
    const pageItems = models.slice(start, end);

    const rows: any[] = pageItems.map((m, idx) => [
      Markup.button.callback(
        `${compactModelRef(m.provider, m.modelId)}`,
        `${prefix}:${safePage}:${idx}`,
      ),
    ]);

    const action = prefix.split(":")[1] as "set" | "default" | "dispatch";
    const navRow: any[] = [];
    if (safePage > 0) {
      navRow.push(Markup.button.callback("Prev", `model:page:${action}:${safePage - 1}`));
    }
    navRow.push(Markup.button.callback(`${safePage + 1}/${Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE))}`, "noop"));
    if (end < models.length) {
      navRow.push(Markup.button.callback("Next", `model:page:${action}:${safePage + 1}`));
    }
    if (navRow.length > 0) {
      rows.push(navRow);
    }

    return Markup.inlineKeyboard(rows);
  };

  const renderThinkingButtons = (levels: ThinkingLevel[]) => {
    const safeLevels = levels.length > 0 ? levels : (["off"] as ThinkingLevel[]);
    return Markup.inlineKeyboard(
      safeLevels.map((level, idx) => [
        Markup.button.callback(`thinking: ${thinkingLabel(level)}`, `thinking:pick:${idx}`),
      ]),
    );
  };

  const resolveModelThinkingLevels = async (provider: string, modelId: string): Promise<ThinkingLevel[]> => {
    const key = compactModelRef(provider, modelId);
    const cached = modelCapabilityCache.get(key);
    if (cached) {
      return cached;
    }
    const levels = await fetchModelCapabilities(config.rigUrl, provider, modelId);
    modelCapabilityCache.set(key, levels);
    return levels;
  };

  const promptThinkingSelection = async (
    ctx: any,
    scopeKey: string,
    action: ThinkingSelectionAction,
    provider: string,
    modelId: string,
  ): Promise<boolean> => {
    const levels = await resolveModelThinkingLevels(provider, modelId);
    if (!supportsThinking(levels)) {
      return false;
    }

    pendingThinkingByTopic.set(scopeKey, {
      action,
      provider,
      modelId,
      levels,
    });

    await ctx.reply(
      `Selected ${compactModelRef(provider, modelId)}. Pick thinking level:`,
      renderThinkingButtons(levels),
    );
    return true;
  };

  const renderActiveBridgeButtons = (scopeKey: string) => {
    const list = activeBridgePickerCache.get(scopeKey) || [];
    return Markup.inlineKeyboard(
      list.map((item, idx) => [
        Markup.button.callback(
          `${item.bridgeId} - ${item.cwd.split("/").pop() || "project"}`,
          `connect:pick:${idx}`,
        ),
      ]),
    );
  };

  const renderProjectButtons = (scopeKey: string, page = 0) => {
    const list = projectPickerCache.get(scopeKey) || [];
    const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(list.length / PROJECTS_PER_PAGE) - 1)));
    const start = safePage * PROJECTS_PER_PAGE;
    const end = start + PROJECTS_PER_PAGE;
    const pageItems = list.slice(start, end);
    const rows = pageItems.map((item, idx) => [
      Markup.button.callback(
        `${item.name}`,
        `project:dispatch:${safePage}:${idx}`,
      ),
    ]);

    const navRow: any[] = [];
    if (safePage > 0) {
      navRow.push(Markup.button.callback("Prev", `project:page:${safePage - 1}`));
    }
    if (end < list.length) {
      navRow.push(Markup.button.callback("Next", `project:page:${safePage + 1}`));
    }
    if (navRow.length > 0) {
      rows.push(navRow);
    }

    return Markup.inlineKeyboard(
      rows,
    );
  };

  const connectBridgeToTopic = async (ctx: any, bridgeId: string): Promise<void> => {
    const chatId = ctx.chat.id as number;
    logInfo("connectBridgeToTopic requested", { chatId, bridgeId });
    const active = await fetchActiveBridges(config.rigUrl);
    const found = active.find((item) => item.bridgeId === bridgeId);
    if (!found) {
      await ctx.reply(`Bridge not found: ${bridgeId}`);
      return;
    }

    const chat = await ctx.getChat();
    let threadId: number | undefined = undefined;
    let topicName = `rig-${bridgeId.slice(0, 10)}`;
    const currentThreadId = currentThreadIdFromCtx(ctx);

    if ((chat as any).is_forum) {
      if (currentThreadId) {
        threadId = currentThreadId;
        topicName = `thread-${threadId}`;
      } else {
        try {
          const created = await ctx.telegram.createForumTopic(chatId, topicName);
          threadId = created.message_thread_id;
        } catch {
          threadId = currentThreadId;
          topicName = threadId ? `thread-${threadId}` : "main-chat";
        }
      }
    }

    const streamKey = `${chatId}:${bridgeId}`;
    if (activeStreamSockets.has(streamKey)) {
      await ctx.reply(`Already streaming ${bridgeId} in this chat.`);
      return;
    }

    const ws = new WebSocket(wsUrlForBridge(config.rigUrl, bridgeId));
    activeStreamSockets.set(streamKey, ws);

    topicToBridge.set(topicKey(chatId, threadId), {
      bridgeId,
      ws,
      chatId,
      threadId,
    });

    const startMsg = await ctx.telegram.sendMessage(chatId, `Connected to ${bridgeId} in ${topicName}. New non-command messages in this topic will be forwarded to this session.`, {
      message_thread_id: threadId,
    });

    const backlog = await fetchRecentBridgeMessages(config.rigUrl, found.sessionId, found.sessionFile, 6);
    if (backlog.length > 0) {
      await ctx.telegram.sendMessage(
        chatId,
        `Recent context:\n${backlog.join("\n")}`.slice(0, TELEGRAM_TEXT_LIMIT),
        { message_thread_id: threadId },
      );
    }

    let lastEdit = 0;
    const editThrottleMs = 700;
    let latestText = "";

    ws.on("message", async (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (data.type === "event") {
          const event = data.event;
          if (event?.type === "message_update" || event?.type === "message_end" || event?.type === "message") {
            const textUpdate = extractAssistantTextFromEvent(event);
            if (textUpdate) {
              latestText = textUpdate;
              const now = Date.now();
              if (now - lastEdit >= editThrottleMs) {
                lastEdit = now;
                await ctx.telegram.editMessageText(chatId, startMsg.message_id, undefined, latestText.slice(0, TELEGRAM_TEXT_LIMIT));
              }
            }
          }
        }

        if (data.type === "exit") {
          const finalText = latestText || `Session ${bridgeId} exited.`;
          await ctx.telegram.editMessageText(chatId, startMsg.message_id, undefined, finalText.slice(0, TELEGRAM_TEXT_LIMIT));
          ws.close();
          activeStreamSockets.delete(streamKey);
          topicToBridge.delete(topicKey(chatId, threadId));
        }
      } catch {
        // Ignore malformed websocket data.
      }
    });

    ws.on("close", () => {
      logInfo("topic stream closed", { chatId, bridgeId, threadId });
      activeStreamSockets.delete(streamKey);
      topicToBridge.delete(topicKey(chatId, threadId));
    });
    ws.on("error", () => {
      logInfo("topic stream errored", { chatId, bridgeId, threadId });
      activeStreamSockets.delete(streamKey);
      topicToBridge.delete(topicKey(chatId, threadId));
    });
  };

  const shouldSuppressPickerPrompt = (kind: "model" | "project", scopeKey: string, key: string): boolean => {
    const now = Date.now();
    const promptKey = `${kind}:${scopeKey}:${key}`;
    const previous = recentPickerPrompts.get(promptKey);
    recentPickerPrompts.set(promptKey, now);

    if (recentPickerPrompts.size > 500) {
      const cutoff = now - 10 * 60_000;
      for (const [k, at] of recentPickerPrompts.entries()) {
        if (at < cutoff) recentPickerPrompts.delete(k);
      }
    }

    return !!previous && now - previous < 20_000;
  };

  watcher.on("session-done", async (event: { conversationId: string; title: string; bridgeId: string }) => {
    const target = parseTelegramConversationId(event.conversationId);
    if (!target) {
      return;
    }
    const text = escapeMarkdownV2(`Dispatch complete: ${event.title} (${event.bridgeId})`);
    await bot.telegram.sendMessage(target.chatId, text, {
      parse_mode: "MarkdownV2",
      message_thread_id: target.threadId,
    });
  });

  bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }
    await ctx.reply("Rig operator online. Commands: /status /sessions /active /connect [bridgeId] /topic /disconnect /model /modeldefault /modelstatus /clear");
  });

  bot.command("topic", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const mapped = topicToBridge.get(topicKey(chatId, threadId));
    if (!mapped) {
      await ctx.reply("This topic is not connected. Use /connect to attach an active session here.");
      return;
    }

    await ctx.reply(`This topic is connected to bridge ${mapped.bridgeId}.`);
  });

  bot.command("active", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    try {
      const active = await fetchActiveBridges(config.rigUrl);
      if (active.length === 0) {
        await ctx.reply("No active Rig sessions right now.");
        return;
      }

      const text = active
        .map((item, idx) => `${idx + 1}. ${item.bridgeId} - ${item.cwd}`)
        .join("\n");
      await ctx.reply(`Active sessions:\n${text}\n\nUse /connect <bridgeId> to stream one into a topic.`);
    } catch (error: any) {
      await ctx.reply(`Failed to fetch active sessions: ${error?.message || String(error)}`);
    }
  });

  bot.command("connect", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    const text = "text" in ctx.message ? ctx.message.text : "";
    const parts = text.trim().split(/\s+/);
    const bridgeId = parts[1];
    const scopeKey = topicKey(chatId, currentThreadIdFromCtx(ctx));
    try {
      if (!bridgeId) {
        const active = await fetchActiveBridges(config.rigUrl);
        if (active.length === 0) {
          await ctx.reply("No active Rig sessions right now.");
          return;
        }
        activeBridgePickerCache.set(scopeKey, active);
        await ctx.reply("Pick an active session to connect:", renderActiveBridgeButtons(scopeKey));
        return;
      }
      await connectBridgeToTopic(ctx, bridgeId);
    } catch (error: any) {
      await ctx.reply(`Failed to connect stream: ${error?.message || String(error)}`);
    }
  });

  bot.command("disconnect", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const key = topicKey(chatId, threadId);
    const mapped = topicToBridge.get(key);
    if (!mapped) {
      await ctx.reply("This topic has no connected session.");
      return;
    }

    topicToBridge.delete(key);
    activeStreamSockets.delete(`${mapped.chatId}:${mapped.bridgeId}`);
    mapped.ws.close();
    await ctx.reply(`Disconnected from ${mapped.bridgeId}.`);
  });

  bot.action(/connect:pick:(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const scopeKey = topicKey(chatId, currentThreadIdFromCtx(ctx));
    const list = activeBridgePickerCache.get(scopeKey) || [];
    const idx = Number(ctx.match[1]);
    const item = list[idx];
    if (!item) {
      await ctx.answerCbQuery("Session list expired. Run /connect again.", { show_alert: true });
      return;
    }

    try {
      await connectBridgeToTopic(ctx, item.bridgeId);
      await ctx.answerCbQuery("Connected.");
    } catch (error: any) {
      await ctx.answerCbQuery("Failed to connect", { show_alert: true });
      await ctx.reply(`Failed to connect: ${error?.message || String(error)}`);
    }
  });

  bot.command("modelstatus", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const status = await sessions.getConversationModelStatus(operatorConversationId(chatId, threadId));
    const selected = status.selectedProvider && status.selectedModelId
      ? compactModelRef(status.selectedProvider, status.selectedModelId)
      : "(not set)";
    const selectedThinking = status.selectedThinkingLevel || "(not set)";
    const fallback = status.defaultProvider && status.defaultModelId
      ? compactModelRef(status.defaultProvider, status.defaultModelId)
      : "(not set)";
    const fallbackThinking = status.defaultThinkingLevel || "(not set)";
    const live = status.liveProvider && status.liveModelId
      ? compactModelRef(status.liveProvider, status.liveModelId)
      : status.active
        ? "(active session, model unknown)"
        : "(no active session)";
    const liveThinking = status.liveThinkingLevel || (status.active ? "(unknown)" : "(no active session)");

    await ctx.reply([
      `Chat selected model: ${selected}`,
      `Chat selected thinking: ${selectedThinking}`,
      `Operator default model: ${fallback}`,
      `Operator default thinking: ${fallbackThinking}`,
      `Live active session model: ${live}`,
      `Live active thinking: ${liveThinking}`,
    ].join("\n"));
  });

  bot.command("model", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }
    try {
      const threadId = currentThreadIdFromCtx(ctx);
      const scopeKey = topicKey(chatId, threadId);
      pendingThinkingByTopic.delete(scopeKey);
      const models = await fetchEnabledModels(config.rigUrl);
      if (models.length === 0) {
        await ctx.reply("No enabled models found.");
        return;
      }
      modelPickerCache.set(scopeKey, models);
      modelPickerPageByTopic.set(scopeKey, 0);
      const current = await sessions.getConversationModel(operatorConversationId(chatId, threadId));
      const currentLine = current.provider && current.modelId
        ? `Current chat model: ${compactModelRef(current.provider, current.modelId)} (thinking: ${current.thinkingLevel || "off"})`
        : "Current chat model: (operator default)";
      await ctx.reply(`${currentLine}\nChoose a model for this topic:`, renderModelButtons(scopeKey, "model:set", 0));
    } catch (error: any) {
      await ctx.reply(`Failed to load models: ${error?.message || String(error)}`);
    }
  });

  bot.command("modeldefault", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }
    try {
      const scopeKey = topicKey(chatId, currentThreadIdFromCtx(ctx));
      pendingThinkingByTopic.delete(scopeKey);
      const models = await fetchEnabledModels(config.rigUrl);
      if (models.length === 0) {
        await ctx.reply("No enabled models found.");
        return;
      }
      modelPickerCache.set(scopeKey, models);
      modelPickerPageByTopic.set(scopeKey, 0);
      const current = config.defaultModel
        ? `${compactModelRef(config.defaultModel.provider, config.defaultModel.modelId)} (thinking: ${config.defaultModel.thinkingLevel || "off"})`
        : "(not set)";
      await ctx.reply(`Current operator default: ${current}\nChoose new default:`, renderModelButtons(scopeKey, "model:default", 0));
    } catch (error: any) {
      await ctx.reply(`Failed to load models: ${error?.message || String(error)}`);
    }
  });

  bot.action(/model:page:(set|default|dispatch):(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const scopeKey = topicKey(chatId, currentThreadIdFromCtx(ctx));
    const models = modelPickerCache.get(scopeKey) || [];
    if (models.length === 0) {
      await ctx.answerCbQuery("Model list expired. Run /model again.", { show_alert: true });
      return;
    }

    const action = String(ctx.match[1]) as "set" | "default" | "dispatch";
    const requestedPage = Number(ctx.match[2]);
    const maxPage = Math.max(0, Math.ceil(models.length / MODELS_PER_PAGE) - 1);
    const page = Math.max(0, Math.min(requestedPage, maxPage));
    modelPickerPageByTopic.set(scopeKey, page);

    const prefix = (`model:${action}`) as "model:set" | "model:default" | "model:dispatch";
    try {
      await ctx.editMessageReplyMarkup(renderModelButtons(scopeKey, prefix, page).reply_markup);
      await ctx.answerCbQuery(`Page ${page + 1}/${maxPage + 1}`);
    } catch {
      await ctx.answerCbQuery("Failed to change page", { show_alert: true });
    }
  });

  bot.action("noop", async (ctx) => {
    await ctx.answerCbQuery();
  });

  bot.action(/model:set:(\d+):(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const scopeKey = topicKey(chatId, threadId);
    const models = modelPickerCache.get(scopeKey) || [];
    const page = Number(ctx.match[1]);
    const idx = Number(ctx.match[2]);
    const model = models[page * MODELS_PER_PAGE + idx];
    if (!model) {
      await ctx.answerCbQuery("Model list expired. Run /model again.", { show_alert: true });
      return;
    }

    try {
      const needsThinkingSelection = await promptThinkingSelection(ctx, scopeKey, "model:set", model.provider, model.modelId);
      if (needsThinkingSelection) {
        await ctx.answerCbQuery("Now pick thinking level.");
        return;
      }

      await sessions.setConversationModel(operatorConversationId(chatId, threadId), model.provider, model.modelId, "off");
      await ctx.answerCbQuery("Model set for this chat.");
      await ctx.reply(`Topic model set to: ${compactModelRef(model.provider, model.modelId)} (thinking: off)`);
    } catch (error: any) {
      await ctx.answerCbQuery("Failed to set model", { show_alert: true });
      await ctx.reply(`Failed to set model: ${error?.message || String(error)}`);
    }
  });

  bot.action(/model:default:(\d+):(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const scopeKey = topicKey(chatId, currentThreadIdFromCtx(ctx));
    const models = modelPickerCache.get(scopeKey) || [];
    const page = Number(ctx.match[1]);
    const idx = Number(ctx.match[2]);
    const model = models[page * MODELS_PER_PAGE + idx];
    if (!model) {
      await ctx.answerCbQuery("Model list expired. Run /modeldefault again.", { show_alert: true });
      return;
    }

    try {
      const needsThinkingSelection = await promptThinkingSelection(ctx, scopeKey, "model:default", model.provider, model.modelId);
      if (needsThinkingSelection) {
        await ctx.answerCbQuery("Now pick thinking level.");
        return;
      }

      await saveDefaultModelToRigConfig(model.provider, model.modelId, "off");
      config.defaultModel = { provider: model.provider, modelId: model.modelId, thinkingLevel: "off" };
      await ctx.answerCbQuery("Operator default model updated.");
      await ctx.reply(`Operator default set to: ${compactModelRef(model.provider, model.modelId)} (thinking: off)`);
    } catch (error: any) {
      await ctx.answerCbQuery("Failed to update default model", { show_alert: true });
      await ctx.reply(`Failed to update default model: ${error?.message || String(error)}`);
    }
  });

  bot.action(/project:page:(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const scopeKey = topicKey(chatId, currentThreadIdFromCtx(ctx));
    const projects = projectPickerCache.get(scopeKey) || [];
    if (projects.length === 0) {
      await ctx.answerCbQuery("Project list expired. Retry your request.", { show_alert: true });
      return;
    }

    const requestedPage = Number(ctx.match[1]);
    const maxPage = Math.max(0, Math.ceil(projects.length / PROJECTS_PER_PAGE) - 1);
    const page = Math.max(0, Math.min(requestedPage, maxPage));
    projectPickerPageByTopic.set(scopeKey, page);

    try {
      await ctx.editMessageReplyMarkup(renderProjectButtons(scopeKey, page).reply_markup);
      await ctx.answerCbQuery(`Page ${page + 1}/${maxPage + 1}`);
    } catch {
      await ctx.answerCbQuery("Failed to change page", { show_alert: true });
    }
  });

  bot.action(/project:dispatch:(\d+):(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const scopeKey = topicKey(chatId, threadId);
    const pending = pendingDispatchByTopic.get(scopeKey);
    if (!pending) {
      await ctx.answerCbQuery("No pending dispatch. Ask again.", { show_alert: true });
      return;
    }

    const projects = projectPickerCache.get(scopeKey) || [];
    const page = Number(ctx.match[1]);
    const idx = Number(ctx.match[2]);
    const project = projects[page * PROJECTS_PER_PAGE + idx];
    if (!project) {
      await ctx.answerCbQuery("Project list expired. Retry your request.", { show_alert: true });
      return;
    }

    pending.cwd = project.path;
    pendingDispatchByTopic.set(scopeKey, pending);

    try {
      if (pending.provider && pending.model) {
        if (!pending.thinkingLevel) {
          const needsThinkingSelection = await promptThinkingSelection(ctx, scopeKey, "model:dispatch", pending.provider, pending.model);
          if (needsThinkingSelection) {
            await ctx.answerCbQuery("Project set. Now pick thinking level.");
            return;
          }
        }

        const data = await dispatchWithModel(config.rigUrl, {
          cwd: pending.cwd,
          message: pending.message,
          provider: pending.provider,
          model: pending.model,
          thinkingLevel: pending.thinkingLevel || "off",
        });
        const title = titleFromPrompt(pending.message);
        watcher.watch({ bridgeId: data.bridgeId, title, conversationId: operatorConversationId(chatId, threadId) });
        pendingDispatchByTopic.delete(scopeKey);
        pendingThinkingByTopic.delete(scopeKey);
        await ctx.answerCbQuery("Dispatch started.");
        await ctx.reply(
          `Dispatch started in ${project.name} (${project.path}) with ${compactModelRef(pending.provider, pending.model)} (thinking: ${pending.thinkingLevel || "off"}).`,
        );
        return;
      }

      const models = await fetchEnabledModels(config.rigUrl);
      modelPickerCache.set(scopeKey, models);
      modelPickerPageByTopic.set(scopeKey, 0);
      await ctx.answerCbQuery("Project selected.");
      await ctx.reply(`Project set to ${project.name}. Pick a model to start dispatch.`, renderModelButtons(scopeKey, "model:dispatch", 0));
    } catch (error: any) {
      await ctx.answerCbQuery("Failed", { show_alert: true });
      await ctx.reply(`Failed to continue dispatch: ${error?.message || String(error)}`);
    }
  });

  bot.action(/model:dispatch:(\d+):(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const scopeKey = topicKey(chatId, threadId);
    const pending = pendingDispatchByTopic.get(scopeKey);
    if (!pending || !pending.cwd) {
      await ctx.answerCbQuery("No pending dispatch. Ask again.", { show_alert: true });
      return;
    }

    const models = modelPickerCache.get(scopeKey) || [];
    const page = Number(ctx.match[1]);
    const idx = Number(ctx.match[2]);
    const model = models[page * MODELS_PER_PAGE + idx];
    if (!model) {
      await ctx.answerCbQuery("Model list expired. Retry your request.", { show_alert: true });
      return;
    }

    try {
      if (!pending.thinkingLevel) {
        pending.provider = model.provider;
        pending.model = model.modelId;
        pendingDispatchByTopic.set(scopeKey, pending);

        const needsThinkingSelection = await promptThinkingSelection(ctx, scopeKey, "model:dispatch", model.provider, model.modelId);
        if (needsThinkingSelection) {
          await ctx.answerCbQuery("Now pick thinking level.");
          return;
        }
      }

      const data = await dispatchWithModel(config.rigUrl, {
        cwd: pending.cwd,
        message: pending.message,
        provider: model.provider,
        model: model.modelId,
        thinkingLevel: pending.thinkingLevel || "off",
      });

      const title = titleFromPrompt(pending.message);
      watcher.watch({ bridgeId: data.bridgeId, title, conversationId: operatorConversationId(chatId, threadId) });
      pendingDispatchByTopic.delete(scopeKey);
      pendingThinkingByTopic.delete(scopeKey);

      await ctx.answerCbQuery("Dispatch started.");
      await ctx.reply(
        `Dispatch started with ${compactModelRef(model.provider, model.modelId)} (thinking: ${pending.thinkingLevel || "off"})\nBridge: ${data.bridgeId}`,
      );
    } catch (error: any) {
      await ctx.answerCbQuery("Failed to start dispatch", { show_alert: true });
      await ctx.reply(`Dispatch failed: ${error?.message || String(error)}`);
    }
  });

  bot.action(/thinking:pick:(\d+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.answerCbQuery("Unauthorized", { show_alert: true });
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const scopeKey = topicKey(chatId, threadId);
    const pendingThinking = pendingThinkingByTopic.get(scopeKey);
    if (!pendingThinking) {
      await ctx.answerCbQuery("Thinking choices expired. Pick a model again.", { show_alert: true });
      return;
    }

    const idx = Number(ctx.match[1]);
    const level = pendingThinking.levels[idx];
    if (!level) {
      await ctx.answerCbQuery("Invalid thinking level.", { show_alert: true });
      return;
    }

    try {
      if (pendingThinking.action === "model:set") {
        await sessions.setConversationModel(
          operatorConversationId(chatId, threadId),
          pendingThinking.provider,
          pendingThinking.modelId,
          level,
        );
        await ctx.answerCbQuery("Model + thinking saved.");
        await ctx.reply(
          `Topic model set to: ${compactModelRef(pendingThinking.provider, pendingThinking.modelId)} (thinking: ${level})`,
        );
        pendingThinkingByTopic.delete(scopeKey);
        return;
      }

      if (pendingThinking.action === "model:default") {
        await saveDefaultModelToRigConfig(pendingThinking.provider, pendingThinking.modelId, level);
        config.defaultModel = {
          provider: pendingThinking.provider,
          modelId: pendingThinking.modelId,
          thinkingLevel: level,
        };
        await ctx.answerCbQuery("Default model + thinking saved.");
        await ctx.reply(
          `Operator default set to: ${compactModelRef(pendingThinking.provider, pendingThinking.modelId)} (thinking: ${level})`,
        );
        pendingThinkingByTopic.delete(scopeKey);
        return;
      }

      const pendingDispatch = pendingDispatchByTopic.get(scopeKey);
      if (!pendingDispatch || !pendingDispatch.cwd) {
        pendingThinkingByTopic.delete(scopeKey);
        await ctx.answerCbQuery("Pending dispatch expired. Ask again.", { show_alert: true });
        return;
      }

      const provider = pendingDispatch.provider || pendingThinking.provider;
      const model = pendingDispatch.model || pendingThinking.modelId;
      pendingDispatch.provider = provider;
      pendingDispatch.model = model;
      pendingDispatch.thinkingLevel = level;
      pendingDispatchByTopic.set(scopeKey, pendingDispatch);

      const data = await dispatchWithModel(config.rigUrl, {
        cwd: pendingDispatch.cwd,
        message: pendingDispatch.message,
        provider,
        model,
        thinkingLevel: level,
      });

      const title = titleFromPrompt(pendingDispatch.message);
      watcher.watch({ bridgeId: data.bridgeId, title, conversationId: operatorConversationId(chatId, threadId) });
      pendingDispatchByTopic.delete(scopeKey);
      pendingThinkingByTopic.delete(scopeKey);

      await ctx.answerCbQuery("Dispatch started.");
      await ctx.reply(`Dispatch started with ${compactModelRef(provider, model)} (thinking: ${level})\nBridge: ${data.bridgeId}`);
    } catch (error: any) {
      await ctx.answerCbQuery("Failed", { show_alert: true });
      await ctx.reply(`Failed to apply thinking level: ${error?.message || String(error)}`);
    }
  });

  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }
    const conversationId = operatorConversationId(chatId, currentThreadIdFromCtx(ctx));
    const active = await sessions.listActiveConversations();
    const mine = active.filter((item) => item.conversationId === conversationId);
    const lines = mine.length > 0
      ? mine.map((item) => `- active since ${new Date(item.lastActiveAt).toLocaleString()}\n  ${item.sessionFile || "(session file pending)"}`)
      : ["No active operator sessions for this chat."];
    await ctx.reply(lines.join("\n"));
  });

  bot.command("clear", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    const threadId = currentThreadIdFromCtx(ctx);
    const scopeKey = topicKey(chatId, threadId);
    const conversationId = operatorConversationId(chatId, threadId);
    await sessions.clearConversation(conversationId, { preserveModel: true });
    pendingDispatchByTopic.delete(scopeKey);
    pendingThinkingByTopic.delete(scopeKey);
    modelPickerCache.delete(scopeKey);
    modelPickerPageByTopic.delete(scopeKey);
    projectPickerCache.delete(scopeKey);
    projectPickerPageByTopic.delete(scopeKey);

    await ctx.reply("Cleared conversation context for this topic. Your next message starts a fresh session.");
  });

  bot.command("sessions", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    try {
      const sessionsList = await fetchRecentRigSessions(config.rigUrl);
      if (sessionsList.length === 0) {
        await ctx.reply("No Rig sessions found.");
        return;
      }

      const text = sessionsList
        .map((session, idx) => {
          const msg = (session.firstMessage || "").replace(/\s+/g, " ").slice(0, 80);
          return `${idx + 1}. ${session.projectName || "project"} - ${msg || "(no prompt)"}`;
        })
        .join("\n");
      await ctx.reply(text);
    } catch (error: any) {
      await ctx.reply(`Failed to fetch sessions: ${error?.message || String(error)}`);
    }
  });

  bot.on(["text", "photo"], async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowedChat(chatId, config.telegram.allowedChatIds)) {
      await ctx.reply("Unauthorized chat.");
      return;
    }

    logDebug("incoming telegram update", {
      chatId,
      updateType: ctx.updateType,
      hasText: "text" in ctx.message,
      hasPhoto: Array.isArray((ctx.message as any)?.photo),
      threadId: currentThreadIdFromCtx(ctx),
    });

    const currentThreadId = currentThreadIdFromCtx(ctx);
    const scopeKey = topicKey(chatId, currentThreadId);
    const messageId = (ctx.message as any)?.message_id as number | undefined;
    if (typeof messageId === "number") {
      const dedupeKey = `${chatId}:${messageId}`;
      const now = Date.now();
      const seenAt = recentInboundMessages.get(dedupeKey);
      if (seenAt && now - seenAt < 120_000) {
        logInfo("skipping duplicate inbound update", { chatId, messageId, threadId: currentThreadId });
        return;
      }
      recentInboundMessages.set(dedupeKey, now);
      if (recentInboundMessages.size > 500) {
        const cutoff = now - 10 * 60_000;
        for (const [key, at] of recentInboundMessages.entries()) {
          if (at < cutoff) {
            recentInboundMessages.delete(key);
          }
        }
      }
    }

    const mapped = topicToBridge.get(topicKey(chatId, currentThreadId));
    if (mapped) {
      if ("text" in ctx.message) {
        const content = ctx.message.text || "";
        if (!content.startsWith("/")) {
          const requestId = `tg_${Date.now()}`;
          logInfo("forwarding message to connected topic bridge", {
            chatId,
            threadId: currentThreadId,
            bridgeId: mapped.bridgeId,
            requestId,
            textLength: content.length,
          });
          mapped.ws.send(JSON.stringify({
            type: "command",
            requestId,
            command: {
              type: "prompt",
              message: content,
            },
          }));
          await withTelegramRetry(() => ctx.reply("Sent to connected session."));
          return;
        }
      }
    }

    const conversationId = operatorConversationId(chatId, currentThreadId);
    const textPrompt = "text" in ctx.message ? ctx.message.text : (ctx.message.caption || "Analyze this image.");
    const images = await extractPhotoAsDataUrl(ctx);

    const placeholder = await withTelegramRetry(() => ctx.reply("\\.\\.\\.", { parse_mode: "MarkdownV2" }));

    const turnStartedAt = Date.now();
    logInfo("operator turn started", {
      chatId,
      conversationId,
      threadId: currentThreadId,
      promptLength: textPrompt.length,
      hasImages: !!images?.length,
      placeholderMessageId: placeholder.message_id,
    });

    const seenTools: string[] = [];
    let latestAssistantText = "";
    let lastEdit = 0;
    const throttleMs = 1200;

    const edit = async (body: string): Promise<void> => {
      const now = Date.now();
      if (now - lastEdit < throttleMs) return;
      lastEdit = now;
      try {
        await withTelegramRetry(() =>
          ctx.telegram.editMessageText(chatId, placeholder.message_id, undefined, body, {
            parse_mode: "MarkdownV2",
          }),
        );
      } catch {
        // Ignore message edit race/rate errors.
      }
    };

    void (async () => {
      try {
        const result = await sessions.sendMessage(conversationId, textPrompt, {
          images,
          callbacks: {
            onText: (nextText) => {
              latestAssistantText = nextText;
              void edit(renderTelegramBody(nextText, seenTools));
            },
            onToolCall: (toolName) => {
              seenTools.push(toolName);
              logDebug("tool call observed", { chatId, toolName, conversationId });
              void edit(renderTelegramBody(latestAssistantText, seenTools));
            },
            onDispatchModelRequired: async (request) => {
              const promptKey = `${request.cwd}|${request.message}|${request.thinkingLevel || ""}`;
              if (shouldSuppressPickerPrompt("model", scopeKey, promptKey)) {
                logInfo("suppressing duplicate model picker prompt", { chatId, cwd: request.cwd });
                return;
              }
              logInfo("dispatch requires model picker", {
                chatId,
                cwd: request.cwd,
                title: request.title,
                error: request.error,
              });
              pendingDispatchByTopic.set(scopeKey, {
                cwd: request.cwd,
                message: request.message,
                thinkingLevel: request.thinkingLevel,
              });

              const models = await fetchEnabledModels(config.rigUrl);
              modelPickerCache.set(scopeKey, models);
              modelPickerPageByTopic.set(scopeKey, 0);
              const hint = request.error ? `\nReason: ${request.error}` : "";
              await withTelegramRetry(() =>
                ctx.reply(`Pick a model to start this dispatch.${hint}`, renderModelButtons(scopeKey, "model:dispatch", 0)),
              );
            },
            onDispatchProjectRequired: async (request) => {
              const promptKey = `${request.message}|${request.provider || ""}|${request.model || ""}|${request.thinkingLevel || ""}`;
              if (shouldSuppressPickerPrompt("project", scopeKey, promptKey)) {
                logInfo("suppressing duplicate project picker prompt", { chatId });
                return;
              }
              logInfo("dispatch requires project picker", {
                chatId,
                title: request.title,
                error: request.error,
                projectCount: request.projects.length,
              });
              pendingDispatchByTopic.set(scopeKey, {
                message: request.message,
                provider: request.provider,
                model: request.model,
                thinkingLevel: request.thinkingLevel,
              });

              const projects = request.projects.length > 0
                ? request.projects
                : await fetchRigProjects(config.rigUrl);
              projectPickerCache.set(scopeKey, projects);
              projectPickerPageByTopic.set(scopeKey, 0);

              if (projects.length === 0) {
                const hint = request.error ? `\nReason: ${request.error}` : "";
                await withTelegramRetry(() => ctx.reply(`Dispatch needs a project, but no projects are available.${hint}`));
                return;
              }

              const hint = request.error ? `\nReason: ${request.error}` : "";
              await withTelegramRetry(() => ctx.reply(`Pick a project for this dispatch.${hint}`, renderProjectButtons(scopeKey, 0)));
            },
          },
        });

        const final = renderTelegramBody(result.text || "(no response)", seenTools);
        try {
          await withTelegramRetry(() =>
            ctx.telegram.editMessageText(chatId, placeholder.message_id, undefined, final, {
              parse_mode: "MarkdownV2",
            }),
          );
        } catch (error) {
          if (!isNotModifiedEditError(error)) {
            throw error;
          }
        }
        logInfo("operator turn completed", {
          chatId,
          conversationId,
          elapsedMs: Date.now() - turnStartedAt,
          toolCalls: seenTools.length,
          responseChars: (result.text || "").length,
        });
      } catch (error) {
        const summary = telegramErrorSummary(error) || String(error);
        const message = escapeMarkdownV2(`Error: ${summary}`);
        try {
          await withTelegramRetry(() =>
            ctx.telegram.editMessageText(chatId, placeholder.message_id, undefined, message, {
              parse_mode: "MarkdownV2",
            }),
          );
        } catch (editError) {
          if (!isNotModifiedEditError(editError)) {
            await withTelegramRetry(() => ctx.reply(message, { parse_mode: "MarkdownV2" }));
          }
        }
        logInfo("operator turn failed", {
          chatId,
          conversationId,
          elapsedMs: Date.now() - turnStartedAt,
          error: summary,
        });
      }
    })();
  });

  await registerTelegramCommands();

  await bot.launch();
  logInfo("Telegram bot launched", {
    allowedChats: config.telegram.allowedChatIds.length,
    verboseLogs: VERBOSE_LOGS,
  });
  return bot;
}
