import { ArrowLeft, Square, Play, Brain, ChevronRight, PanelLeft, PanelLeftClose, FileText } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import type { Session } from "../types";
import { ProjectBadge } from "./ProjectBadge";
import { ToolCallLine } from "./ToolCallLine";

interface SessionLogProps {
  session: Session;
  onBack: () => void;
  onSendMessage: (message: string) => void;
  onStop: () => void;
  onResume: () => void;
  onThinkingLevelChange: (level: "low" | "medium" | "high") => void;
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
  sidebarCollapsed,
  onToggleSidebar,
  showFilesPanel,
  onToggleFiles,
}: SessionLogProps) {
  const [input, setInput] = useState("");
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const fileCount = session.touchedFiles.length;

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface shrink-0">
        {/* Desktop: sidebar toggle */}
        <button
          onClick={onToggleSidebar}
          className="hidden lg:flex p-1.5 text-text-muted hover:text-text transition-colors cursor-pointer rounded hover:bg-surface-2"
          title={sidebarCollapsed ? "Show board" : "Hide board"}
        >
          {sidebarCollapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
        </button>
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
              const next =
                session.thinkingLevel === "low"
                  ? "medium"
                  : session.thinkingLevel === "medium"
                    ? "high"
                    : "low";
              onThinkingLevelChange(next);
            }}
            className="font-mono text-[10px] text-text-dim bg-surface-2 border border-border rounded-md px-2 py-1 hover:text-text hover:border-amber transition-colors cursor-pointer shrink-0"
            title="Thinking level (click to cycle)"
          >
            think:{session.thinkingLevel}
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
                <div className="text-[14px] text-text leading-relaxed py-3 px-4 bg-surface-2/80 rounded-lg">
                  {entry.text}
                </div>
              </div>
            );
          }

          if (entry.type === "tool") {
            return <ToolCallLine key={i} call={entry.call} />;
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
                  <div className="text-[13px] text-text leading-[1.7]">
                    {renderMarkdownLite(entry.text)}
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
          <input
            ref={inputRef}
            type="text"
            placeholder="follow up..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
        <div className="ml-4 pl-3 border-l-2 border-violet/20 text-[12px] text-text-dim leading-relaxed max-h-[300px] overflow-y-auto whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

// ─── Minimal Markdown renderer ────────────────────────────────────────────

function renderMarkdownLite(text: string) {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks: { type: string; lang?: string; content: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    blocks.push({ type: "code", lang: match[1], content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    blocks.push({ type: "text", content: text.slice(lastIndex) });
  }

  return (
    <>
      {blocks.map((block, blockIdx) => {
        if (block.type === "code") {
          return (
            <div
              key={blockIdx}
              className="my-3 bg-surface-2 border border-border rounded-lg overflow-hidden font-mono text-[11px] leading-relaxed"
            >
              {block.lang && (
                <div className="px-3 py-1.5 bg-surface-3 border-b border-border text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                  {block.lang}
                </div>
              )}
              <div className="p-3 overflow-x-auto text-text-dim m-0 whitespace-pre">{block.content}</div>
            </div>
          );
        }

        return (
          <div key={blockIdx}>
            {block.content.split("\n").map((line, lineIdx) => {
              const isListItem = /^\s*[-*]\s+/.test(line);
              const isOrderedItem = /^\s*\d+\.\s+/.test(line);
              const isHeading = /^#{1,3}\s+/.test(line);

              let cleanLine = line;
              if (isListItem) cleanLine = line.replace(/^\s*[-*]\s+/, "");
              if (isOrderedItem) cleanLine = line.replace(/^\s*\d+\.\s+/, "");
              if (isHeading) cleanLine = line.replace(/^#{1,3}\s+/, "");

              return (
                <div
                  key={`${blockIdx}-${lineIdx}`}
                  className={`
                    ${line.trim() === "" ? "h-3" : "min-h-[1.5em]"}
                    ${isListItem || isOrderedItem ? "pl-4 relative" : ""}
                    ${isHeading ? "font-semibold text-text mt-2" : ""}
                  `}
                >
                  {(isListItem || isOrderedItem) && (
                    <span className="absolute left-0 text-amber font-bold opacity-60 text-[10px] top-[0.2em]">
                      {isListItem ? "●" : line.match(/^\s*(\d+\.)/)?.[1]}
                    </span>
                  )}
                  {renderInline(cleanLine)}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="font-mono text-[11px] bg-surface-2 border border-border px-1 py-0.5 rounded text-amber"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    if (boldParts.length > 1) {
      return boldParts.map((bp, j) => {
        if (bp.startsWith("**") && bp.endsWith("**")) {
          return (
            <strong key={`${i}-${j}`} className="font-semibold text-text">
              {bp.slice(2, -2)}
            </strong>
          );
        }
        return <span key={`${i}-${j}`}>{bp}</span>;
      });
    }
    return <span key={i}>{part}</span>;
  });
}
