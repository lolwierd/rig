export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface OperatorConfig {
  rigUrl: string;
  operatorCwd: string;
  sessionTimeoutSeconds: number;
  defaultModel?: {
    provider: string;
    modelId: string;
    thinkingLevel?: ThinkingLevel;
  };
  rest: {
    port: number;
    host: string;
    bearerToken?: string;
  };
  telegram: {
    botToken?: string;
    allowedChatIds: number[];
  };
}

export interface ConversationRecord {
  conversationId: string;
  sessionFile?: string;
  sessionId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  updatedAt: number;
}

export interface SessionStore {
  conversations: Record<string, ConversationRecord>;
}

export interface DispatchWatchTarget {
  bridgeId: string;
  title: string;
  conversationId: string;
}

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onToolCall?: (toolName: string) => void;
  onDispatchModelRequired?: (request: DispatchModelRequest) => void;
  onDispatchProjectRequired?: (request: DispatchProjectRequest) => void;
}

export interface PromptImage {
  url: string;
  mediaType?: string;
}

export interface ModelInfo {
  provider: string;
  modelId: string;
  displayName: string;
}

export interface DispatchModelRequest {
  cwd: string;
  message: string;
  thinkingLevel?: ThinkingLevel;
  title?: string;
  error?: string;
}

export interface DispatchProjectRequest {
  message: string;
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  title?: string;
  error?: string;
  projects: Array<{ path: string; name: string }>;
}
