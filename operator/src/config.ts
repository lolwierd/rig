import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { OperatorConfig, SessionStore, ThinkingLevel } from "./types.js";

const operatorHome = path.join(homedir(), "rig-operator");
const rigConfigPath = path.join(homedir(), ".pi", "agent", "rig.json");

export const configPath = path.join(operatorHome, "config.json");
export const sessionStorePath = path.join(operatorHome, "conversations.json");

const defaultConfig: OperatorConfig = {
  rigUrl: process.env.RIG_URL || "http://localhost:3100",
  operatorCwd: operatorHome,
  sessionTimeoutSeconds: 15 * 60,
  defaultModel: undefined,
  rest: {
    port: Number(process.env.OPERATOR_PORT || "3200"),
    host: process.env.OPERATOR_HOST || "127.0.0.1",
    bearerToken: process.env.OPERATOR_BEARER_TOKEN,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    allowedChatIds: process.env.TELEGRAM_ALLOWED_CHAT_IDS
      ? process.env.TELEGRAM_ALLOWED_CHAT_IDS.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
      : [],
  },
};

type RigOperatorSection = {
  telegram?: {
    botToken?: string;
    allowedChatIds?: number[];
  };
  defaultModel?: {
    provider?: string;
    modelId?: string;
    thinkingLevel?: string;
  };
};

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (typeof value !== "string") return undefined;
  if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    return value as ThinkingLevel;
  }
  return undefined;
}

async function loadRigOperatorSection(): Promise<RigOperatorSection> {
  try {
    const raw = await readFile(rigConfigPath, "utf8");
    const parsed = JSON.parse(raw) as { operator?: RigOperatorSection };
    return parsed.operator || {};
  } catch {
    return {};
  }
}

export async function ensureOperatorHome(): Promise<void> {
  await mkdir(operatorHome, { recursive: true });
}

export async function loadConfig(): Promise<OperatorConfig> {
  await ensureOperatorHome();
  const rigOperator = await loadRigOperatorSection();
  const rigDefaultModel =
    rigOperator.defaultModel?.provider && rigOperator.defaultModel?.modelId
      ? {
          provider: rigOperator.defaultModel.provider,
          modelId: rigOperator.defaultModel.modelId,
          thinkingLevel: parseThinkingLevel(rigOperator.defaultModel.thinkingLevel),
        }
      : undefined;
  const rigTelegramAllowed = Array.isArray(rigOperator.telegram?.allowedChatIds)
    ? rigOperator.telegram?.allowedChatIds.filter((v) => Number.isFinite(v))
    : [];

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<OperatorConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      defaultModel: parsed.defaultModel || rigDefaultModel || defaultConfig.defaultModel,
      rest: { ...defaultConfig.rest, ...parsed.rest },
      telegram: {
        ...defaultConfig.telegram,
        botToken: process.env.TELEGRAM_BOT_TOKEN || parsed.telegram?.botToken || rigOperator.telegram?.botToken,
        allowedChatIds:
          parsed.telegram?.allowedChatIds && parsed.telegram.allowedChatIds.length > 0
            ? parsed.telegram.allowedChatIds
            : process.env.TELEGRAM_ALLOWED_CHAT_IDS
              ? process.env.TELEGRAM_ALLOWED_CHAT_IDS.split(",")
                  .map((v) => Number(v.trim()))
                  .filter((v) => Number.isFinite(v))
              : rigTelegramAllowed,
      },
    };
  } catch {
    const merged: OperatorConfig = {
      ...defaultConfig,
      defaultModel: rigDefaultModel || defaultConfig.defaultModel,
      telegram: {
        ...defaultConfig.telegram,
        botToken: process.env.TELEGRAM_BOT_TOKEN || rigOperator.telegram?.botToken,
        allowedChatIds: process.env.TELEGRAM_ALLOWED_CHAT_IDS
          ? process.env.TELEGRAM_ALLOWED_CHAT_IDS.split(",")
              .map((v) => Number(v.trim()))
              .filter((v) => Number.isFinite(v))
          : rigTelegramAllowed,
      },
    };
    await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return merged;
  }
}

export async function saveDefaultModelToRigConfig(
  provider: string,
  modelId: string,
  thinkingLevel?: ThinkingLevel,
): Promise<void> {
  await mkdir(path.dirname(rigConfigPath), { recursive: true });

  let root: Record<string, unknown> = {};
  try {
    const raw = await readFile(rigConfigPath, "utf8");
    root = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    root = {};
  }

  const existingOperator = (root.operator || {}) as Record<string, unknown>;
  root.operator = {
    ...existingOperator,
    defaultModel: {
      provider,
      modelId,
      ...(thinkingLevel && { thinkingLevel }),
    },
  };

  await writeFile(rigConfigPath, JSON.stringify(root, null, 2) + "\n", "utf8");
}

export async function loadSessionStore(): Promise<SessionStore> {
  await ensureOperatorHome();
  try {
    const raw = await readFile(sessionStorePath, "utf8");
    const parsed = JSON.parse(raw) as SessionStore;
    return {
      conversations: parsed.conversations || {},
    };
  } catch {
    const fresh: SessionStore = { conversations: {} };
    await writeFile(sessionStorePath, JSON.stringify(fresh, null, 2) + "\n", "utf8");
    return fresh;
  }
}

export async function saveSessionStore(store: SessionStore): Promise<void> {
  await ensureOperatorHome();
  await writeFile(sessionStorePath, JSON.stringify(store, null, 2) + "\n", "utf8");
}
