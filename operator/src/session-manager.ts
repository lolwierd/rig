import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSessionStore, saveSessionStore } from "./config.js";
import { killPi, sendCommand, sendRaw, spawnOperatorPi, type PiOperatorProcess } from "./pi-operator.js";
import type { DispatchWatchTarget, OperatorConfig, PromptImage, StreamCallbacks, ThinkingLevel } from "./types.js";

interface ActiveConversation {
  conversationId: string;
  bridge: PiOperatorProcess;
  sessionFile?: string;
  sessionId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  lastActiveAt: number;
  queue: Promise<void>;
}

export interface SendResult {
  text: string;
  toolCalls: string[];
}

function resolveExtensionPath(thisFile: string): string {
  const explicit = process.env.OPERATOR_EXTENSION_PATH;
  if (explicit) {
    return path.resolve(explicit);
  }

  const candidates = [
    // Repo root (dev): operator/extensions/rig-tools.ts
    path.resolve(process.cwd(), "extensions/rig-tools.ts"),
    // Repo root (if precompiled extension is checked in)
    path.resolve(process.cwd(), "extensions/rig-tools.js"),

    // Dist runtime: operator/dist/src -> ../extensions/rig-tools.js
    path.resolve(path.dirname(thisFile), "../extensions/rig-tools.js"),
    // Source runtime: operator/src -> ../extensions/rig-tools.ts
    path.resolve(path.dirname(thisFile), "../extensions/rig-tools.ts"),

    // Legacy fallbacks
    path.resolve(path.dirname(thisFile), "../../extensions/rig-tools.js"),
    path.resolve(path.dirname(thisFile), "../../extensions/rig-tools.ts"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Return best-guess path for error visibility if nothing exists.
  return candidates[0];
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string };
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n");
}

function titleFromPrompt(prompt: string): string {
  return prompt
    .trim()
    .split(/\s+/)
    .slice(0, 7)
    .join(" ")
    .replace(/[\r\n]+/g, " ");
}

export class SessionManager extends EventEmitter {
  private readonly config: OperatorConfig;
  private readonly extensionPath: string;
  private readonly active = new Map<string, ActiveConversation>();
  private readonly idleTimer: ReturnType<typeof setInterval>;
  private readonly storePromise = loadSessionStore();

  constructor(config: OperatorConfig) {
    super();
    this.config = config;

    const thisFile = fileURLToPath(import.meta.url);
    this.extensionPath = resolveExtensionPath(thisFile);

    this.idleTimer = setInterval(() => {
      void this.reapIdle();
    }, 30_000);
  }

  private async getConversationRecord(conversationId: string): Promise<any> {
    const store = await this.storePromise;
    return store.conversations[conversationId];
  }

  private async saveConversationRecord(conversationId: string, record: any): Promise<void> {
    const store = await this.storePromise;
    store.conversations[conversationId] = record;
    await saveSessionStore(store as any);
  }

  private async refreshConversationState(conversation: ActiveConversation): Promise<void> {
    if (!conversation.bridge.alive) {
      return;
    }

    try {
      const state = await sendCommand(conversation.bridge, { type: "get_state" }, 10_000);
      const data = state?.data;
      if (!data || typeof data !== "object") {
        return;
      }

      if (typeof data.sessionFile === "string" && data.sessionFile.length > 0) {
        conversation.sessionFile = data.sessionFile;
      }
      if (typeof data.sessionId === "string" && data.sessionId.length > 0) {
        conversation.sessionId = data.sessionId;
      }

      const liveProvider =
        typeof data.provider === "string"
          ? data.provider
          : typeof data.model?.provider === "string"
            ? data.model.provider
            : undefined;
      const liveModelId =
        typeof data.modelId === "string"
          ? data.modelId
          : typeof data.model?.id === "string"
            ? data.model.id
            : undefined;
      const liveThinkingLevel =
        typeof data.thinkingLevel === "string"
          ? (data.thinkingLevel as ThinkingLevel)
          : undefined;

      if (liveProvider) {
        conversation.modelProvider = liveProvider;
      }
      if (liveModelId) {
        conversation.modelId = liveModelId;
      }
      if (liveThinkingLevel) {
        conversation.thinkingLevel = liveThinkingLevel;
      }
    } catch {
      // Keep the existing in-memory state if the refresh fails.
    }
  }

  private async persistConversation(conversation: ActiveConversation): Promise<void> {
    await this.saveConversationRecord(conversation.conversationId, {
      conversationId: conversation.conversationId,
      sessionFile: conversation.sessionFile,
      sessionId: conversation.sessionId,
      modelProvider: conversation.modelProvider,
      modelId: conversation.modelId,
      thinkingLevel: conversation.thinkingLevel,
      updatedAt: Date.now(),
    });
  }

  private async ensureConversation(conversationId: string): Promise<ActiveConversation> {
    const existing = this.active.get(conversationId);
    if (existing?.bridge.alive) {
      existing.lastActiveAt = Date.now();
      return existing;
    }

    const stored = await this.getConversationRecord(conversationId);
    const bridge = await spawnOperatorPi({
      cwd: this.config.operatorCwd,
      extensionPath: this.extensionPath,
      sessionFile: stored?.sessionFile,
    });

    const state = await sendCommand(bridge, { type: "get_state" });
    const data = state?.data || {};
    const usingStoredModel = !!(stored?.modelProvider && stored?.modelId);

    const conversation: ActiveConversation = {
      conversationId,
      bridge,
      sessionFile: data.sessionFile,
      sessionId: data.sessionId,
      modelProvider: stored?.modelProvider || this.config.defaultModel?.provider,
      modelId: stored?.modelId || this.config.defaultModel?.modelId,
      thinkingLevel: stored?.thinkingLevel ?? (usingStoredModel ? undefined : this.config.defaultModel?.thinkingLevel),
      lastActiveAt: Date.now(),
      queue: Promise.resolve(),
    };

    if (conversation.modelProvider && conversation.modelId) {
      try {
        await sendCommand(bridge, {
          type: "set_model",
          provider: conversation.modelProvider,
          modelId: conversation.modelId,
        }, 15_000);

        if (conversation.thinkingLevel) {
          await sendCommand(bridge, {
            type: "set_thinking_level",
            level: conversation.thinkingLevel,
          }, 15_000).catch(() => {});
        }
      } catch {
        // Keep going even if preferred model is unavailable.
      }
    }

    this.active.set(conversationId, conversation);
    await this.refreshConversationState(conversation);
    await this.persistConversation(conversation);

    bridge.events.on("exit", () => {
      this.active.delete(conversationId);
    });

    return conversation;
  }

  private async runTurn(conversation: ActiveConversation, message: string, images: PromptImage[] | undefined, callbacks?: StreamCallbacks): Promise<SendResult> {
    const bridge = conversation.bridge;
    conversation.lastActiveAt = Date.now();

    let assistantText = "";
    let seenAssistantMessage = false;
    let finished = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const toolCalls: string[] = [];

    const done = new Promise<SendResult>((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for operator turn to finish"));
      }, 10 * 60_000);

      const finalize = (): void => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({ text: assistantText.trim(), toolCalls });
      };

      const onEvent = (event: any): void => {
        if (!event || typeof event !== "object") return;

        if (event.type === "message_start" && event.message?.role === "assistant") {
          seenAssistantMessage = true;
          assistantText = extractTextFromContent(event.message?.content);
          callbacks?.onText?.(assistantText);
          return;
        }

        if (event.type === "message_update" && seenAssistantMessage && event.message?.role === "assistant") {
          assistantText = extractTextFromContent(event.message?.content);
          callbacks?.onText?.(assistantText);
          return;
        }

        if (event.type === "message" && event.message?.role === "assistant") {
          assistantText = extractTextFromContent(event.message?.content);
          callbacks?.onText?.(assistantText);
          finalize();
          return;
        }

        if (event.type === "message_end" && seenAssistantMessage) {
          const role = event.message?.role;
          if (!role || role === "assistant") {
            let nextText = assistantText;
            if (event.message?.content) {
              nextText = extractTextFromContent(event.message.content);
            }

            // Only finalize early on message_end if we actually have text.
            // Tool-call-only assistant messages can end with no text, and the real
            // user-facing text may come in a later assistant message.
            if (nextText.trim().length > 0) {
              assistantText = nextText;
              callbacks?.onText?.(assistantText);
              finalize();
              return;
            }
          }
        }

        if (event.type === "tool_execution_start") {
          const toolName = String(event.toolName || "tool");
          toolCalls.push(toolName);
          callbacks?.onToolCall?.(toolName);
          return;
        }

        if (event.type === "tool_execution_end" && event.toolName === "rig_dispatch") {
          const details = event.result?.details || event.result?.data?.details || event.result?.data || event.result;

          if (details?.needsProject && details?.message) {
            callbacks?.onDispatchProjectRequired?.({
              message: String(details.message),
              provider: details.provider ? String(details.provider) : undefined,
              model: details.model ? String(details.model) : undefined,
              thinkingLevel: details.thinkingLevel,
              title: details.title,
              error: details.error,
              projects: Array.isArray(details.projects)
                ? details.projects
                  .filter((p: any) => p?.path && p?.name)
                  .map((p: any) => ({ path: String(p.path), name: String(p.name) }))
                : [],
            });
            return;
          }

          if (details?.needsModel && details?.cwd && details?.message) {
            callbacks?.onDispatchModelRequired?.({
              cwd: String(details.cwd),
              message: String(details.message),
              thinkingLevel: details.thinkingLevel,
              title: details.title,
              error: details.error,
            });
            return;
          }

          const title = titleFromPrompt(message);
          const bridgeId = details?.bridgeId || event.result?.bridgeId || event.result?.data?.bridgeId;
          if (bridgeId) {
            const target: DispatchWatchTarget = { bridgeId: String(bridgeId), title, conversationId: conversation.conversationId };
            this.emit("dispatch", target);
          }
          return;
        }

        if (event.type === "agent_end") {
          finalize();
        }
      };

      const onExit = (): void => {
        if (finished) return;
        cleanup();
        reject(new Error("Operator session exited while handling message"));
      };

      const cleanup = (): void => {
        bridge.events.off("event", onEvent);
        bridge.events.off("exit", onExit);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
      };

      bridge.events.on("event", onEvent);
      bridge.events.on("exit", onExit);
    });

    sendRaw(bridge, {
      type: "prompt",
      message,
      images: images?.map((image) => {
        const match = image.url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          return {
            type: "image",
            mimeType: image.mediaType || match[1],
            data: match[2],
          };
        }
        return undefined;
      }).filter(Boolean),
    });

    const result = await done;
    conversation.lastActiveAt = Date.now();
    await this.refreshConversationState(conversation);
    await this.persistConversation(conversation);
    return result;
  }

  async sendMessage(conversationId: string, message: string, options?: { images?: PromptImage[]; callbacks?: StreamCallbacks }): Promise<SendResult> {
    const conversation = await this.ensureConversation(conversationId);

    const run = conversation.queue.then(() => this.runTurn(conversation, message, options?.images, options?.callbacks));
    conversation.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async listActiveConversations(): Promise<Array<{ conversationId: string; sessionFile?: string; lastActiveAt: number }>> {
    return Array.from(this.active.values()).map((item) => ({
      conversationId: item.conversationId,
      sessionFile: item.sessionFile,
      lastActiveAt: item.lastActiveAt,
    }));
  }

  async listKnownConversations(): Promise<Array<{ conversationId: string; sessionFile?: string; updatedAt: number }>> {
    const store = await this.storePromise;
    return Object.values(store.conversations)
      .map((entry) => ({
        conversationId: entry.conversationId,
        sessionFile: entry.sessionFile,
        updatedAt: entry.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async setConversationModel(
    conversationId: string,
    provider: string,
    modelId: string,
    thinkingLevel?: ThinkingLevel,
  ): Promise<void> {
    const conversation = await this.ensureConversation(conversationId);
    conversation.modelProvider = provider;
    conversation.modelId = modelId;
    if (thinkingLevel) {
      conversation.thinkingLevel = thinkingLevel;
    }

    await sendCommand(conversation.bridge, {
      type: "set_model",
      provider,
      modelId,
    }, 15_000);

    const levelToApply = thinkingLevel || conversation.thinkingLevel;
    if (levelToApply) {
      await sendCommand(conversation.bridge, {
        type: "set_thinking_level",
        level: levelToApply,
      }, 15_000).catch(() => {});
    }

    await this.refreshConversationState(conversation);
    await this.persistConversation(conversation);
  }

  async setConversationThinkingLevel(conversationId: string, thinkingLevel: ThinkingLevel): Promise<void> {
    const conversation = await this.ensureConversation(conversationId);
    conversation.thinkingLevel = thinkingLevel;

    await sendCommand(conversation.bridge, {
      type: "set_thinking_level",
      level: thinkingLevel,
    }, 15_000);

    await this.refreshConversationState(conversation);
    await this.persistConversation(conversation);
  }

  async getConversationModel(conversationId: string): Promise<{ provider?: string; modelId?: string; thinkingLevel?: ThinkingLevel }> {
    const active = this.active.get(conversationId);
    if (active) {
      return { provider: active.modelProvider, modelId: active.modelId, thinkingLevel: active.thinkingLevel };
    }
    const stored = await this.getConversationRecord(conversationId);
    const usingStoredModel = !!(stored?.modelProvider && stored?.modelId);
    return {
      provider: stored?.modelProvider || this.config.defaultModel?.provider,
      modelId: stored?.modelId || this.config.defaultModel?.modelId,
      thinkingLevel: stored?.thinkingLevel ?? (usingStoredModel ? undefined : this.config.defaultModel?.thinkingLevel),
    };
  }

  async getConversationModelStatus(conversationId: string): Promise<{
    selectedProvider?: string;
    selectedModelId?: string;
    selectedThinkingLevel?: ThinkingLevel;
    defaultProvider?: string;
    defaultModelId?: string;
    defaultThinkingLevel?: ThinkingLevel;
    liveProvider?: string;
    liveModelId?: string;
    liveThinkingLevel?: ThinkingLevel;
    active: boolean;
  }> {
    const selected = await this.getConversationModel(conversationId);
    const status: {
      selectedProvider?: string;
      selectedModelId?: string;
      selectedThinkingLevel?: ThinkingLevel;
      defaultProvider?: string;
      defaultModelId?: string;
      defaultThinkingLevel?: ThinkingLevel;
      liveProvider?: string;
      liveModelId?: string;
      liveThinkingLevel?: ThinkingLevel;
      active: boolean;
    } = {
      selectedProvider: selected.provider,
      selectedModelId: selected.modelId,
      selectedThinkingLevel: selected.thinkingLevel,
      defaultProvider: this.config.defaultModel?.provider,
      defaultModelId: this.config.defaultModel?.modelId,
      defaultThinkingLevel: this.config.defaultModel?.thinkingLevel,
      active: false,
    };

    const active = this.active.get(conversationId);
    if (!active || !active.bridge.alive) {
      return status;
    }

    status.active = true;
    try {
      const resp = await sendCommand(active.bridge, { type: "get_state" }, 10_000);
      if (resp?.success) {
        status.liveProvider = resp.data?.provider;
        status.liveModelId = resp.data?.modelId;
        if (typeof resp.data?.thinkingLevel === "string") {
          status.liveThinkingLevel = resp.data.thinkingLevel as ThinkingLevel;
        }
      }
    } catch {
      // Keep status response usable even if live state call fails.
    }

    return status;
  }

  async endConversation(conversationId: string): Promise<boolean> {
    const conversation = this.active.get(conversationId);
    if (!conversation) {
      return false;
    }
    killPi(conversation.bridge);
    this.active.delete(conversationId);
    return true;
  }

  async clearConversation(conversationId: string, options?: { preserveModel?: boolean }): Promise<void> {
    const preserveModel = options?.preserveModel ?? true;
    const active = this.active.get(conversationId);
    const stored = await this.getConversationRecord(conversationId);

    const modelProvider = active?.modelProvider || stored?.modelProvider;
    const modelId = active?.modelId || stored?.modelId;
    const thinkingLevel = active?.thinkingLevel || stored?.thinkingLevel;

    if (active) {
      killPi(active.bridge);
      this.active.delete(conversationId);
    }

    const store = await this.storePromise;
    if (preserveModel && modelProvider && modelId) {
      store.conversations[conversationId] = {
        conversationId,
        modelProvider,
        modelId,
        thinkingLevel,
        updatedAt: Date.now(),
      };
    } else {
      delete store.conversations[conversationId];
    }
    await saveSessionStore(store as any);
  }

  private async reapIdle(): Promise<void> {
    const cutoff = Date.now() - this.config.sessionTimeoutSeconds * 1000;
    for (const [conversationId, conversation] of this.active.entries()) {
      if (conversation.lastActiveAt >= cutoff) {
        continue;
      }
      killPi(conversation.bridge);
      this.active.delete(conversationId);
      await this.persistConversation(conversation);
    }
  }

  async shutdown(): Promise<void> {
    clearInterval(this.idleTimer);
    for (const conversation of this.active.values()) {
      killPi(conversation.bridge);
    }
    this.active.clear();
  }
}
