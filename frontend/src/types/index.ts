/** Known tool names — open union so unknown tools don't crash */
export type ToolName = "read" | "edit" | "write" | "bash" | "grep" | "find" | "ls" | "todo" | (string & {});

export interface ToolCall {
  timestamp: string;
  tool: string;
  path: string;
  detail?: string;
  toolCallId?: string;
  output?: string;
}

/** A file touched during a session */
export interface TouchedFile {
  path: string;
  action: "read" | "edit" | "new" | "bash";
  timestamp?: number;
}

/** An image block extracted from message content */
export interface ImageBlock {
  url: string;
  mediaType?: string;
}

/** A single entry in the session log */
export type LogEntry =
  | { type: "directive"; text: string; timestamp: string; images?: ImageBlock[] }
  | { type: "system"; text: string; timestamp: string }
  | { type: "tool"; call: ToolCall }
  | { type: "prose"; text: string; thinking?: string; streaming?: boolean; images?: ImageBlock[] }
  | { type: "error"; text: string; timestamp: string };

/** Session status */
export type SessionStatus = "running" | "done" | "error";

/** A session on the board */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface Session {
  id: string;
  path: string;
  cwd: string;
  projectName: string;
  name?: string;
  firstMessage: string;
  status: SessionStatus;
  model: string;
  modelId: string;
  provider: string;
  thinkingLevel?: ThinkingLevel;
  timeAgo: string;
  messageCount: number;
  isActive: boolean;
  bridgeId?: string;
  created: string;
  modified: string;
  entries: LogEntry[];
  touchedFiles: TouchedFile[];
}

/** A registered project */
export interface Project {
  path: string;
  name: string;
}

/** Available model from pi */
export interface ModelInfo {
  provider: string;
  modelId: string;
  displayName: string;
}

/** Extension UI request from pi */
export interface ExtensionUIRequest {
  id: string;
  type: "extension_ui_request";
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}
