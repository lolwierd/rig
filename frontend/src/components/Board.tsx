import { Search, Plus } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import type { Session } from "../types";
import { ProjectBadge } from "./ProjectBadge";
import { StatusDot } from "./StatusDot";

interface BoardProps {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (session: Session) => void;
  onNewDispatch: () => void;
  serverOnline: boolean;
  lastSyncAt: number | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function Board({
  sessions,
  selectedId,
  onSelect,
  onNewDispatch,
  serverOnline,
  lastSyncAt,
  sidebarCollapsed,
  onToggleSidebar,
}: BoardProps) {
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const syncText = useMemo(() => {
    if (!lastSyncAt) return "sync pending";
    const diffSec = Math.max(0, Math.floor((now - lastSyncAt) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
  }, [lastSyncAt, now]);

  const filtered = useMemo(() => {
    if (!filter) return sessions;
    const q = filter.toLowerCase();
    return sessions.filter(
      (s) =>
        s.projectName.toLowerCase().includes(q) ||
        s.firstMessage.toLowerCase().includes(q),
    );
  }, [sessions, filter]);

  // Active sessions first
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return 0;
    });
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface">
        <span className="font-ui text-lg font-bold tracking-tight text-amber shrink-0">rig</span>
        <div className="flex-1 flex items-center gap-2 h-8 bg-surface-2 border border-border rounded-lg px-3">
          <Search size={13} className="text-text-muted shrink-0" />
          <input
            type="text"
            placeholder="filter sessions..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 bg-transparent text-xs font-mono text-text placeholder:text-text-muted outline-none"
          />
        </div>
        <button
          onClick={onNewDispatch}
          className="h-8 px-3 bg-amber text-bg rounded-lg font-mono text-[11px] font-semibold tracking-wide flex items-center gap-1.5 hover:brightness-110 transition-all cursor-pointer shrink-0"
        >
          <Plus size={14} />
          New
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session)}
            className={`group w-full text-left grid items-center gap-3 px-4 py-3 border-b border-border transition-colors cursor-pointer ${
              session.id === selectedId
                ? "bg-surface-2 border-l-2 border-l-amber"
                : session.status === "running"
                  ? "bg-amber-dim/40 hover:bg-amber-dim/60"
                  : "hover:bg-surface"
            }`}
            style={{
              gridTemplateColumns: "auto 1fr auto auto",
            }}
            title={`${session.name || session.firstMessage}\nModel: ${session.model}\nProvider: ${session.provider}`}
          >
            <ProjectBadge name={session.projectName} />
            <span className="text-[13px] text-text truncate min-w-0">
              {session.name || session.firstMessage}
            </span>
            <StatusDot status={session.status} />
            <span className="font-mono text-[10px] text-text-muted whitespace-nowrap text-right min-w-[32px]">
              {session.timeAgo}
            </span>
          </button>
        ))}

        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            {filter ? (
              <p className="font-mono text-xs text-text-muted">
                no sessions match "{filter}"
              </p>
            ) : (
              <>
                <div className="w-10 h-px bg-border mb-5" />
                <p className="font-mono text-[11px] text-text-dim mb-1">
                  no dispatches yet
                </p>
                <p className="font-mono text-[10px] text-text-muted mb-6 leading-relaxed max-w-[200px]">
                  your work log starts with the first task you dispatch
                </p>
                <button
                  onClick={onNewDispatch}
                  className="flex items-center gap-2 px-4 py-2.5 bg-amber text-bg rounded-lg font-mono text-[11px] font-semibold cursor-pointer hover:brightness-110 transition-all"
                >
                  <Plus size={13} />
                  New dispatch
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Sidebar footer */}
      <div className="border-t border-border bg-surface px-4 py-3 flex items-center gap-2.5 shrink-0">
        <span
          className={`font-mono text-[10px] leading-none ${serverOnline ? "text-text-muted" : "text-red"}`}
          title={serverOnline ? "server reachable" : "server unreachable — sessions pause if host sleeps"}
        >
          {serverOnline ? `online • sync ${syncText}` : `offline • last sync ${syncText}`}
        </span>
        <button
          onClick={onToggleSidebar}
          className="ml-auto hidden lg:inline-flex h-9 items-center rounded-lg border border-border bg-surface-2 px-3 font-mono text-[10px] uppercase tracking-wide text-text-muted hover:text-text hover:border-border-bright transition-colors cursor-pointer"
          title={sidebarCollapsed ? "Show board" : "Collapse board"}
        >
          {sidebarCollapsed ? "show" : "collapse"}
        </button>
      </div>
    </div>
  );
}
