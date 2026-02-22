import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl } from "../lib/api";
import type { LogEntry, Session, ToolCall, TouchedFile, ExtensionUIRequest } from "../types";

export interface UseSessionBridgeResult {
  entries: LogEntry[];
  touchedFiles: TouchedFile[];
  thinkingLevel?: "low" | "medium" | "high";
  pendingRequest: ExtensionUIRequest | null;
  isReady: boolean;
  sendCommand: (type: string, payload?: any) => void;
  sendResponse: (id: string, payload: any) => void;
}

export function useSessionBridge(
  session: Session | null,
  initialEntries: LogEntry[],
): UseSessionBridgeResult {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries);
  const [touchedFiles, setTouchedFiles] = useState<TouchedFile[]>([]);
  const [thinkingLevel, setThinkingLevel] = useState<"low" | "medium" | "high" | undefined>(
    session?.thinkingLevel,
  );
  const [pendingRequest, setPendingRequest] = useState<ExtensionUIRequest | null>(null);
  const [isReady, setIsReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

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
    }
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setEntries((prev) => [
          ...prev,
          { type: "error", text: event.message, timestamp: new Date().toLocaleTimeString() },
        ]);
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
          const isDupe =
            last?.type === "directive" && last.text === text;
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
  }, []);

  const connect = useCallback(() => {
    if (!session?.bridgeId || !session.isActive) return;

    const url = wsUrl(session.bridgeId);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsReady(true);

    ws.onclose = () => {
      setIsReady(false);
      wsRef.current = null;
    };

    ws.onerror = () => setIsReady(false);

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "state") {
          if (data.data?.thinkingLevel) setThinkingLevel(data.data.thinkingLevel);
        } else if (data.type === "files") {
          setTouchedFiles(data.files);
        } else if (data.type === "event") {
          handleEvent(data.event);
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }, [session?.bridgeId, session?.isActive, handleEvent]);

  const sendCommand = useCallback((type: string, payload: any = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", command: { type, ...payload } }));
    }
  }, []);

  const sendResponse = useCallback((id: string, payload: any) => {
    setPendingRequest((prev) => (prev?.id === id ? null : prev));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "extension_ui_response", data: { id, ...payload } }));
    }
  }, []);

  // Connect/disconnect WebSocket based on session state
  useEffect(() => {
    if (session?.isActive && session.bridgeId) {
      connect();
    } else {
      setIsReady(false);
      wsRef.current?.close();
      wsRef.current = null;
    }
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [session?.id, session?.bridgeId, session?.isActive, connect]);

  return { entries, touchedFiles, thinkingLevel, pendingRequest, isReady, sendCommand, sendResponse };
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
