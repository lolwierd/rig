import { useState, useCallback, useEffect, useMemo } from "react";
import { Board } from "./components/Board";
import { SessionLog } from "./components/SessionLog";
import { NewDispatch } from "./components/NewDispatch";
import { EmptyDetail } from "./components/EmptyDetail";
import { FilesPanel } from "./components/FilesPanel";
import {
  fetchSessions,
  fetchProjects,
  fetchModels,
  dispatch,
  resume,
  stopSession,
} from "./lib/api";
import { useSessionBridge } from "./hooks/useSessionBridge";
import { ExtensionRequest } from "./components/ExtensionRequest";
import type { Session, ModelInfo, Project, LogEntry, TouchedFile } from "./types";

// Stable empty arrays to avoid re-render loops in hooks
const EMPTY_ENTRIES: LogEntry[] = [];
const EMPTY_FILES: TouchedFile[] = [];

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<ModelInfo | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showDispatch, setShowDispatch] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showFilesPanel, setShowFilesPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"board" | "session">("board");

  // Cache for loaded session content (keyed by session file path)
  const [sessionCache, setSessionCache] = useState<
    Record<string, { entries: LogEntry[]; files: TouchedFile[] }>
  >({});

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  // ─── Data fetching ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [sessionsData, projectsData, modelsData] = await Promise.all([
        fetchSessions(),
        fetchProjects(),
        fetchModels(),
      ]);
      setSessions(sessionsData);
      setProjects(projectsData);
      setModels(modelsData.models);
      setDefaultModel(modelsData.defaultModel);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ─── Auto-select ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!loading && sessions.length > 0 && !selectedSessionId) {
      const running = sessions.find((s) => s.status === "running");
      setSelectedSessionId(running?.id ?? sessions[0].id);
    }
  }, [loading, sessions, selectedSessionId]);

  // ─── Session content loading ────────────────────────────────────────────

  useEffect(() => {
    if (!selectedSession) return;
    if (sessionCache[selectedSession.path]) return;

    const fetchHistory = async () => {
      try {
        const res = await fetch(
          `/api/sessions/${selectedSession.id}/entries?path=${encodeURIComponent(selectedSession.path)}`,
        );
        if (!res.ok) return;
        const data = await res.json();

        const parsed: LogEntry[] = [];
        const filesMap = new Map<string, TouchedFile>();
        const toolCallMap = new Map<string, any>();

        for (const entry of data.entries) {
          if (entry.type === "message") {
            const msg = entry.message;
            if (!msg) continue;
            const timestamp = msg.timestamp
              ? new Date(msg.timestamp).toLocaleTimeString()
              : "";

            if (msg.role === "user") {
              const text = extractText(msg.content);
              if (text) {
                parsed.push({ type: "directive", text, timestamp });
              }
            } else if (msg.role === "assistant") {
              const text = extractText(msg.content);
              const thinking = extractThinking(msg.content);
              if (text || thinking) {
                parsed.push({ type: "prose", text, thinking: thinking || undefined });
              }

              // Extract tool calls from content blocks
              if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                  if (part.type === "toolCall") {
                    const args = part.arguments || {};
                    const toolCall = {
                      timestamp,
                      tool: part.name,
                      path: part.name === "bash" ? (args.command ?? "") : (args.path || args.cwd || ""),
                      toolCallId: part.id,
                      output: undefined as string | undefined,
                    };
                    parsed.push({ type: "tool", call: toolCall });
                    if (part.id) toolCallMap.set(part.id, toolCall);
                    trackFile(filesMap, part.name, args, msg.timestamp);
                  }
                }
              }
            } else if (msg.role === "toolResult") {
              const tc = msg.toolCallId && toolCallMap.get(msg.toolCallId);
              if (tc) {
                tc.output = extractText(msg.content);
              }
            }
          } else if (entry.type === "tool_execution_start") {
            const { toolName, args } = entry;
            const timestamp = entry.timestamp
              ? new Date(entry.timestamp).toLocaleTimeString()
              : "";
            parsed.push({
              type: "tool",
              call: {
                timestamp,
                tool: toolName,
                path: toolName === "bash" ? (args?.command ?? "") : (args?.path || args?.cwd || ""),
              },
            });
            trackFile(filesMap, toolName, args, entry.timestamp);
          }
        }

        setSessionCache((prev) => ({
          ...prev,
          [selectedSession.path]: {
            entries: parsed,
            files: Array.from(filesMap.values()),
          },
        }));
      } catch (e) {
        console.error("Failed to load session entries", e);
      }
    };

    fetchHistory();
  }, [selectedSession?.id, selectedSession?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Live bridge ────────────────────────────────────────────────────────

  const cachedData = selectedSession ? sessionCache[selectedSession.path] : null;
  const initialEntries = cachedData?.entries ?? EMPTY_ENTRIES;

  const bridge = useSessionBridge(selectedSession, initialEntries);

  // For active sessions, bridge manages entries. For inactive, use cache.
  const currentEntries = selectedSession?.isActive
    ? bridge.entries
    : initialEntries;
  const currentFiles = selectedSession?.isActive
    ? bridge.touchedFiles
    : (cachedData?.files ?? EMPTY_FILES);
  const currentThinkingLevel = selectedSession?.isActive
    ? bridge.thinkingLevel
    : selectedSession?.thinkingLevel;

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleSelectSession = useCallback((session: Session) => {
    setSelectedSessionId(session.id);
    setMobileView("session");
  }, []);

  const handleBack = useCallback(() => {
    setMobileView("board");
    if (window.innerWidth < 1024) {
      setSelectedSessionId(null);
    }
  }, []);

  const handleDispatch = useCallback(
    async (projectPath: string, message: string, model: ModelInfo) => {
      try {
        setShowDispatch(false);
        const res = await dispatch(projectPath, message, model.provider, model.modelId);
        if (res.sessionId) {
          setSelectedSessionId(res.sessionId);
          setMobileView("session");
        }
        await loadData();
      } catch (err) {
        console.error("Dispatch failed:", err);
        alert("Failed to dispatch: " + err);
      }
    },
    [loadData],
  );

  const handleSendMessage = useCallback(
    (message: string) => {
      if (!selectedSession?.isActive) return;
      bridge.sendCommand("prompt", { message });
    },
    [selectedSession?.isActive, bridge],
  );

  const handleStop = useCallback(async () => {
    if (!selectedSession?.bridgeId) return;
    try {
      await stopSession(selectedSession.bridgeId);
      await loadData();
    } catch (err) {
      console.error("Stop failed:", err);
    }
  }, [selectedSession?.bridgeId, loadData]);

  const handleResume = useCallback(async () => {
    if (!selectedSession) return;
    try {
      await resume(selectedSession.path, selectedSession.cwd);
      // Invalidate cache so we reload fresh entries
      setSessionCache((prev) => {
        const next = { ...prev };
        delete next[selectedSession.path];
        return next;
      });
      await loadData();
    } catch (err) {
      console.error("Resume failed:", err);
    }
  }, [selectedSession, loadData]);

  const handleThinkingLevelChange = useCallback(
    (level: "low" | "medium" | "high") => {
      if (selectedSession?.isActive) {
        bridge.sendCommand("set_thinking_level", { level });
      }
    },
    [selectedSession?.isActive, bridge],
  );

  const handleNewDispatch = useCallback(() => {
    setShowDispatch(true);
  }, []);

  // ─── Loading / Error states ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-amber border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="font-mono text-[11px] text-text-muted">connecting to rig server...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="text-center max-w-sm">
          <div className="w-10 h-10 rounded-full bg-red-dim flex items-center justify-center mx-auto mb-4">
            <span className="text-red text-lg">!</span>
          </div>
          <p className="font-mono text-[12px] text-text-dim mb-2">cannot reach rig server</p>
          <p className="font-mono text-[10px] text-text-muted mb-4 break-all">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-surface-2 border border-border rounded-lg font-mono text-[11px] text-text-dim cursor-pointer hover:bg-surface-3 transition-colors"
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const sessionWithData = selectedSession
    ? {
        ...selectedSession,
        entries: currentEntries,
        touchedFiles: currentFiles,
        thinkingLevel: currentThinkingLevel,
      }
    : null;

  return (
    <div className="h-full flex">
      {/* Desktop layout */}
      <div className="hidden lg:flex h-full w-full">
        <div
          className={`h-full border-r border-border bg-bg transition-all duration-200 shrink-0 ${
            sidebarCollapsed ? "w-0 overflow-hidden" : "w-[400px]"
          }`}
        >
          <Board
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={handleSelectSession}
            onNewDispatch={handleNewDispatch}
          />
        </div>

        <div className="flex-1 flex h-full min-w-0">
          {sessionWithData ? (
            <>
              <div className="flex-1 min-w-0">
                <SessionLog
                  session={sessionWithData}
                  onBack={handleBack}
                  onSendMessage={handleSendMessage}
                  onStop={handleStop}
                  onResume={handleResume}
                  onThinkingLevelChange={handleThinkingLevelChange}
                  sidebarCollapsed={sidebarCollapsed}
                  onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
                  showFilesPanel={showFilesPanel}
                  onToggleFiles={() => setShowFilesPanel(!showFilesPanel)}
                />
              </div>
              {showFilesPanel && sessionWithData.touchedFiles.length > 0 && (
                <FilesPanel
                  files={sessionWithData.touchedFiles}
                  onClose={() => setShowFilesPanel(false)}
                />
              )}
            </>
          ) : (
            <EmptyDetail
              hasSession={sessions.length > 0}
              projectCount={projects.length}
              modelCount={models.length}
              onNewDispatch={handleNewDispatch}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          )}
        </div>
      </div>

      {/* Mobile layout */}
      <div className="lg:hidden h-full w-full">
        {mobileView === "board" ? (
          <Board
            sessions={sessions}
            selectedId={null}
            onSelect={handleSelectSession}
            onNewDispatch={handleNewDispatch}
          />
        ) : sessionWithData ? (
          <SessionLog
            session={sessionWithData}
            onBack={handleBack}
            onSendMessage={handleSendMessage}
            onStop={handleStop}
            onResume={handleResume}
            onThinkingLevelChange={handleThinkingLevelChange}
            sidebarCollapsed={false}
            onToggleSidebar={() => {}}
            showFilesPanel={false}
            onToggleFiles={() => {}}
          />
        ) : (
          <Board
            sessions={sessions}
            selectedId={null}
            onSelect={handleSelectSession}
            onNewDispatch={handleNewDispatch}
          />
        )}
      </div>

      {/* Dispatch overlay */}
      {showDispatch && (
        <NewDispatch
          projects={projects}
          models={models}
          defaultModel={defaultModel}
          onDispatch={handleDispatch}
          onClose={() => setShowDispatch(false)}
          onProjectsChanged={loadData}
        />
      )}

      {/* Extension request overlay */}
      {bridge.pendingRequest && (
        <ExtensionRequest
          request={bridge.pendingRequest}
          onResponse={(response) => bridge.sendResponse(bridge.pendingRequest!.id, response)}
        />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

function extractThinking(content: any): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b.type === "thinking")
    .map((b: any) => b.thinking || b.text || "")
    .join("");
}

function trackFile(
  filesMap: Map<string, TouchedFile>,
  toolName: string,
  args: any,
  timestamp?: number,
) {
  if (["read", "edit", "write"].includes(toolName) && args?.path) {
    filesMap.set(args.path, {
      path: args.path,
      action: toolName === "write" ? "new" : (toolName as any),
      timestamp,
    });
  }
}
