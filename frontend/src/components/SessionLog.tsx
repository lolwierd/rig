import { ArrowLeft, Square, Play, Brain, ChevronRight, PanelLeft, FileText } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Session, ThinkingLevel } from "../types";
import { ProjectBadge } from "./ProjectBadge";
import { ToolCallLine } from "./ToolCallLine";
import { MarkdownMessage } from "./MarkdownMessage";

interface SessionLogProps {
  session: Session;
  onBack: () => void;
  onSendMessage: (message: string, mode: "steer" | "followUp") => void;
  onStop: () => void;
  onResume: () => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  thinkingLevels?: ThinkingLevel[];
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  showFilesPanel: boolean;
  onToggleFiles: () => void;
}

export function SessionLog({
  session,
  onBack,
  onSendMessage,
  onStop,
  onResume,
  onThinkingLevelChange,
  thinkingLevels,
  sidebarCollapsed,
  onToggleSidebar,
  showFilesPanel,
  onToggleFiles,
}: SessionLogProps) {
  const [input, setInput] = useState("");
  const [messageMode, setMessageMode] = useState<"steer" | "followUp">("steer");
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldAutoScroll = useRef(true);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevEntryCountRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    if (session.id !== prevSessionIdRef.current) {
      prevSessionIdRef.current = session.id;
      shouldAutoScroll.current = true;
      prevEntryCountRef.current = 0;
    }
  }, [session.id]);

  useEffect(() => {
    if (!shouldAutoScroll.current) return;
    const isInitialLoad = prevEntryCountRef.current === 0 && session.entries.length > 0;
    prevEntryCountRef.current = session.entries.length;
    requestAnimationFrame(() => {
      logEndRef.current?.scrollIntoView({
        behavior: isInitialLoad ? "instant" : "smooth",
      });
    });
  }, [session.entries]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      logEndRef.current?.scrollIntoView({ behavior });
    });
  };

  const handleSubmit = (e?: React.SyntheticEvent, overrideMode?: "steer" | "followUp") => {
    e?.preventDefault();
    if (!input.trim()) return;

    // User explicitly sent a follow-up/steer message: force auto-scroll so
    // their message + assistant reply stays in view.
    shouldAutoScroll.current = true;
    scrollToBottom("smooth");

    onSendMessage(input.trim(), overrideMode ?? messageMode);
    setInput("");
  };

  const fileCount = session.touchedFiles.length;

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface shrink-0">
        {/* Desktop: show board button (only when collapsed) */}
        {sidebarCollapsed && (
          <button
            onClick={onToggleSidebar}
            className="hidden lg:flex p-1.5 text-text-muted hover:text-text transition-colors cursor-pointer rounded hover:bg-surface-2"
            title="Show board"
          >
            <PanelLeft size={15} />
          </button>
        )}
        {/* Mobile: back */}
        <button
          onClick={onBack}
          className="lg:hidden p-1 text-text-dim hover:text-text transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>

        <ProjectBadge name={session.projectName} />
        <span className="flex-1 text-[13px] text-text font-medium truncate min-w-0">
          {session.name || session.firstMessage}
        </span>

        {/* Provider / full model ID */}
        <span className="hidden sm:flex font-mono text-[10px] bg-surface-2 border border-border rounded-md px-2.5 py-1 items-center gap-1 shrink-0">
          <span className="text-text-muted">{session.provider}</span>
          <span className="text-text-muted">/</span>
          <span className="text-text-dim">{session.modelId || session.model}</span>
        </span>

        {session.thinkingLevel && (
          <button
            onClick={() => {
              const levels = thinkingLevels && thinkingLevels.length > 0
                ? thinkingLevels
                : (["off", "minimal", "low", "medium", "high"] as ThinkingLevel[]);
              const idx = Math.max(0, levels.indexOf(session.thinkingLevel as ThinkingLevel));
              const next = levels[(idx + 1) % levels.length];
              onThinkingLevelChange(next);
            }}
            className={`h-7 inline-flex items-center rounded-md border px-2 font-mono text-[10px] uppercase tracking-wide transition-colors cursor-pointer shrink-0 ${
              session.thinkingLevel === "high" || session.thinkingLevel === "xhigh"
                ? "border-amber/35 bg-amber/10 text-amber"
                : session.thinkingLevel === "medium"
                  ? "border-border-bright bg-surface-2 text-text-dim hover:text-text"
                  : "border-border bg-surface-2 text-text-muted hover:text-text"
            }`}
            title="Thinking level (click to cycle)"
          >
            {session.thinkingLevel === "minimal" ? "min" : session.thinkingLevel === "medium" ? "med" : session.thinkingLevel}
          </button>
        )}

        {/* Files toggle (desktop only) */}
        {fileCount > 0 && (
          <button
            onClick={onToggleFiles}
            className={`hidden lg:flex p-1.5 transition-colors cursor-pointer rounded items-center gap-1 shrink-0 ${
              showFilesPanel
                ? "text-amber bg-amber-dim"
                : "text-text-muted hover:text-text hover:bg-surface-2"
            }`}
            title="Toggle files panel"
          >
            <FileText size={13} />
            <span className="font-mono text-[10px]">{fileCount}</span>
          </button>
        )}

        {session.status === "running" ? (
          <button
            onClick={onStop}
            className="text-red hover:text-red/80 transition-colors p-1.5 cursor-pointer bg-red-dim rounded hover:bg-red-dim/80 shrink-0"
            title="Stop session"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={onResume}
            className="text-green hover:text-green/80 transition-colors p-1.5 cursor-pointer bg-green-dim rounded hover:bg-green-dim/80 shrink-0"
            title="Resume session"
          >
            <Play size={12} fill="currentColor" />
          </button>
        )}
      </div>

      {/* Log body */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {session.entries.map((entry, i) => {
          if (entry.type === "directive") {
            return (
              <div key={i} className="mb-5">
                <div className="font-mono text-[10px] text-text-muted mb-1.5 flex items-center gap-2">
                  <span className="uppercase tracking-widest text-amber/60 font-semibold text-[9px]">you</span>
                  <span>{entry.timestamp}</span>
                </div>
                <div className="py-3 px-4 bg-surface-2/80 rounded-lg">
                  <MarkdownMessage
                    text={entry.text}
                    className="text-[13px] text-text leading-[1.65]"
                  />
                </div>
              </div>
            );
          }

          if (entry.type === "tool") {
            return <ToolCallLine key={i} call={entry.call} />;
          }

          if (entry.type === "system") {
            return (
              <div key={i} className="my-2 text-center">
                <span className="inline-flex items-center gap-1 font-mono text-[10px] text-text-muted bg-surface-2 border border-border rounded-full px-2.5 py-1">
                  {entry.text}
                </span>
              </div>
            );
          }

          if (entry.type === "prose") {
            return (
              <div key={i} className="my-3 px-1">
                {entry.thinking && (
                  <ThinkingBlock
                    text={entry.thinking}
                    streaming={!!entry.streaming && !entry.text}
                  />
                )}
                {(entry.text || (!entry.thinking && entry.streaming)) && (
                  <div className="text-[13px] text-text leading-[1.65]">
                    <MarkdownMessage text={entry.text} />
                    {entry.streaming && (
                      <span className="inline-block w-0.5 h-3.5 bg-amber ml-0.5 align-text-bottom animate-[blink_1s_step-end_infinite]" />
                    )}
                  </div>
                )}
              </div>
            );
          }

          if (entry.type === "error") {
            return (
              <div key={i} className="text-[13px] text-red bg-red-dim rounded-lg px-4 py-3 my-3 font-mono">
                {entry.text}
              </div>
            );
          }

          return null;
        })}
        <div ref={logEndRef} />
      </div>

      {/* Input bar — only for active sessions */}
      {session.isActive && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2.5 px-4 py-3 border-t border-border bg-surface shrink-0"
        >
          <select
            value={messageMode}
            onChange={(e) => setMessageMode(e.target.value as "steer" | "followUp")}
            className="h-9 bg-surface-2 border border-border rounded-lg px-2 font-mono text-[10px] text-text-dim outline-none focus:border-border-bright"
            title="Queue mode"
          >
            <option value="steer">steer</option>
            <option value="followUp">follow-up</option>
          </select>

          <input
            ref={inputRef}
            type="text"
            placeholder="send steering/follow-up..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (e.altKey) {
                e.preventDefault();
                handleSubmit(e, "followUp");
              } else if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                handleSubmit(e, "steer");
              }
            }}
            className="flex-1 h-9 bg-surface-2 border border-border rounded-lg px-3.5 text-[13px] text-text placeholder:text-text-muted outline-none focus:border-border-bright transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-9 h-9 bg-amber text-bg rounded-lg flex items-center justify-center text-base font-bold cursor-pointer hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:brightness-100"
          >
            ↑
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Thinking Block ───────────────────────────────────────────────────────

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = streaming || expanded;

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] font-mono text-violet/70 hover:text-violet transition-colors cursor-pointer py-1"
      >
        <Brain size={12} />
        <span>thinking</span>
        {streaming && (
          <span className="inline-block w-0.5 h-3 bg-violet/60 ml-0.5 animate-[blink_1s_step-end_infinite]" />
        )}
        {!streaming && (
          <ChevronRight size={10} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
        )}
      </button>
      {isOpen && (
        <div className="ml-4 pl-3 border-l-2 border-violet/20 max-h-[300px] overflow-y-auto">
          <MarkdownMessage text={text} className="text-[12px] text-text-dim leading-[1.6]" />
        </div>
      )}
    </div>
  );
}

