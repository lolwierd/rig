import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl } from "../lib/api";
import type { LogEntry, Session, ToolCall, TouchedFile, ExtensionUIRequest, ThinkingLevel } from "../types";

interface PendingCommand {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface UseSessionBridgeResult {
  entries: LogEntry[];
  touchedFiles: TouchedFile[];
  thinkingLevel?: ThinkingLevel;
  pendingRequest: ExtensionUIRequest | null;
  isReady: boolean;
  isStreaming: boolean;
  sendCommand: (type: string, payload?: any) => Promise<any>;
  sendResponse: (id: string, payload: any) => void;
  addSystemNote: (text: string) => void;
}

export function useSessionBridge(
  session: Session | null,
  initialEntries: LogEntry[],
): UseSessionBridgeResult {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries);
  const [touchedFiles, setTouchedFiles] = useState<TouchedFile[]>([]);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | undefined>(
    session?.thinkingLevel,
  );
  const [pendingRequest, setPendingRequest] = useState<ExtensionUIRequest | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const pendingRequestsRef = useRef(new Map<string, PendingCommand>());
  const requestCounterRef = useRef(0);

  const appendError = useCallback((text: string) => {
    setEntries((prev) => [
      ...prev,
      { type: "error", text, timestamp: new Date().toLocaleTimeString() },
    ]);
  }, []);

  const addSystemNote = useCallback((text: string) => {
    setEntries((prev) => [
      ...prev,
      { type: "system", text, timestamp: new Date().toLocaleTimeString() },
    ]);
  }, []);

  const rejectPendingRequests = useCallback((reason: string) => {
    for (const [, pending] of pendingRequestsRef.current) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    pendingRequestsRef.current.clear();
  }, []);

  // Track previous session ID to detect actual session changes (not just re-renders)
  const prevSessionIdRef = useRef<string | null>(null);

  // Reset state only when the selected session actually changes
  useEffect(() => {
    if (session?.id !== prevSessionIdRef.current) {
      prevSessionIdRef.current = session?.id ?? null;
      initialEntriesLenRef.current = 0;
      setEntries(initialEntries);
      setTouchedFiles([]);
      setThinkingLevel(session?.thinkingLevel);
      setPendingRequest(null);
      setIsStreaming(false);
      rejectPendingRequests("Session changed");
    }
  }, [session?.id, session?.thinkingLevel, rejectPendingRequests]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync initial entries when they arrive (async fetch completes after session selection)
  const initialEntriesLenRef = useRef(0);
  useEffect(() => {
    if (initialEntries.length > 0 && initialEntries.length !== initialEntriesLenRef.current) {
      initialEntriesLenRef.current = initialEntries.length;
      setEntries(initialEntries);
    }
  }, [initialEntries]);

  // Event handler — processes RPC events from pi and updates log entries
  const handleEvent = useCallback((event: any) => {
    if (event.type === "response" && event.success === false && event.error) {
      appendError(event.error);
      return;
    }

    if (event.type === "agent_start") {
      setIsStreaming(true);
    } else if (event.type === "agent_end") {
      setIsStreaming(false);
    }

    if (event.type === "thinking_level_change") {
      setThinkingLevel(event.thinkingLevel);
    }

    if (event.type === "extension_ui_request") {
      const interactive = ["confirm", "select", "input", "editor"];
      if (interactive.includes(event.method)) {
        setPendingRequest(event);
        return;
      }
      // Non-interactive (notifications/errors from extensions) — show as log entry
      if (event.message) {
        appendError(event.message);
      }
      return;
    }

    setEntries((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];

      if (event.type === "message_start") {
        const { message } = event;
        if (message.role === "user") {
          const text = extractText(message.content);
          const isDupe = last?.type === "directive" && last.text === text;
          if (!isDupe) {
            next.push({
              type: "directive",
              text,
              timestamp: new Date().toLocaleTimeString(),
            });
          }
        } else if (message.role === "assistant") {
          next.push({ type: "prose", text: "", thinking: "", streaming: true });
        }
      } else if (event.type === "message_update") {
        const { text, thinking } = extractContent(event.message.content);
        if (last?.type === "prose" && last.streaming) {
          next[next.length - 1] = { ...last, text, thinking };
        } else {
          next.push({ type: "prose", text, thinking, streaming: true });
        }
      } else if (event.type === "message_end") {
        if (last?.type === "prose" && last.streaming) {
          next[next.length - 1] = { ...last, streaming: false };
        }
      } else if (event.type === "tool_execution_start") {
        const { toolName, args, toolCallId } = event;
        const path = args?.path || args?.cwd || "";
        const toolCall: ToolCall = {
          timestamp: new Date().toLocaleTimeString(),
          tool: toolName,
          path: toolName === "bash" ? (args?.command ?? "") : path,
          toolCallId,
        };
        next.push({ type: "tool", call: toolCall });
      } else if (event.type === "tool_execution_end") {
        const { toolName, result, toolCallId } = event;
        let foundIndex = -1;

        if (toolCallId) {
          foundIndex = next.findIndex(
            (e) => e.type === "tool" && e.call.toolCallId === toolCallId,
          );
        }
        if (foundIndex === -1) {
          for (let i = next.length - 1; i >= 0; i--) {
            const entry = next[i];
            if (entry.type === "tool" && entry.call.tool === toolName) {
              foundIndex = i;
              break;
            }
          }
        }

        if (foundIndex !== -1) {
          const entry = next[foundIndex];
          if (entry.type === "tool") {
            next[foundIndex] = {
              ...entry,
              call: { ...entry.call, output: extractResultText(result) },
            };
          }
        }
      }

      return next;
    });

    // Track files from tool events
    if (event.type === "tool_execution_start") {
      const { toolName, args } = event;
      if (["read", "edit", "write"].includes(toolName) && args?.path) {
        setTouchedFiles((prev) => {
          if (prev.some((f) => f.path === args.path)) return prev;
          return [
            ...prev,
            {
              path: args.path,
              action: toolName === "write" ? "new" : (toolName as any),
              timestamp: Date.now(),
            },
          ];
        });
      }
    }
  }, [appendError]);

  const connect = useCallback(() => {
    if (!session?.bridgeId || !session.isActive) return;

    const url = wsUrl(session.bridgeId);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsReady(true);

    ws.onclose = () => {
      setIsReady(false);
      setIsStreaming(false);
      wsRef.current = null;
      rejectPendingRequests("Connection closed");
    };

    ws.onerror = () => {
      setIsReady(false);
      setIsStreaming(false);
      rejectPendingRequests("WebSocket error");
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "state") {
          if (data.data?.thinkingLevel) setThinkingLevel(data.data.thinkingLevel);
          setIsStreaming(!!data.data?.isStreaming);
        } else if (data.type === "files") {
          setTouchedFiles(data.files);
        } else if (data.type === "event") {
          handleEvent(data.event);
        } else if (data.type === "response") {
          const requestId = data.requestId as string | undefined;
          if (!requestId) return;

          const pending = pendingRequestsRef.current.get(requestId);
          if (!pending) return;

          pendingRequestsRef.current.delete(requestId);
          clearTimeout(pending.timer);

          const commandError =
            data.error ||
            (data.data && data.data.success === false ? data.data.error || "Command failed" : null);

          if (commandError) {
            appendError(commandError);
            pending.reject(new Error(commandError));
          } else {
            pending.resolve(data.data);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }, [session?.bridgeId, session?.isActive, handleEvent, rejectPendingRequests, appendError]);

  const sendCommand = useCallback((type: string, payload: any = {}) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Session socket is not connected"));
    }

    const requestId = `cmd_${++requestCounterRef.current}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId);
        const err = new Error(`Timeout waiting for ${type} response`);
        appendError(err.message);
        reject(err);
      }, 30000);

      pendingRequestsRef.current.set(requestId, { resolve, reject, timer });

      try {
        wsRef.current!.send(
          JSON.stringify({ type: "command", requestId, command: { type, ...payload } }),
        );
      } catch (err: any) {
        clearTimeout(timer);
        pendingRequestsRef.current.delete(requestId);
        const error = new Error(err?.message || "Failed to send command");
        appendError(error.message);
        reject(error);
      }
    });
  }, [appendError]);

  const sendResponse = useCallback((id: string, payload: any) => {
    setPendingRequest((prev) => (prev?.id === id ? null : prev));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "extension_ui_response", data: { id, ...payload } }),
      );
    }
  }, []);

  // Connect/disconnect WebSocket based on session state
  useEffect(() => {
    if (session?.isActive && session.bridgeId) {
      connect();
    } else {
      setIsReady(false);
      setIsStreaming(false);
      wsRef.current?.close();
      wsRef.current = null;
      rejectPendingRequests("Session is not active");
    }
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      rejectPendingRequests("Session connection reset");
    };
  }, [session?.id, session?.bridgeId, session?.isActive, connect, rejectPendingRequests]);

  return {
    entries,
    touchedFiles,
    thinkingLevel,
    pendingRequest,
    isReady,
    isStreaming,
    sendCommand,
    sendResponse,
    addSystemNote,
  };
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

function extractContent(content: any): { text: string; thinking: string } {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (Array.isArray(content)) {
    const text = content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const thinking = content
      .filter((b) => b.type === "thinking")
      .map((b) => b.thinking || b.text || "")
      .join("");
    return { text, thinking };
  }
  return { text: "", thinking: "" };
}

function extractResultText(result: any): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((part: any) => (part.type === "text" ? part.text : ""))
      .join("");
  }
  if (result && typeof result === "object") {
    return JSON.stringify(result, null, 2);
  }
  return "";
}
