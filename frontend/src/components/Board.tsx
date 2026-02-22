import { Search, Plus } from "lucide-react";
import { useState, useMemo } from "react";
import type { Session } from "../types";
import { ProjectBadge } from "./ProjectBadge";
import { StatusDot } from "./StatusDot";

interface BoardProps {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (session: Session) => void;
  onNewDispatch: () => void;
}

export function Board({
  sessions,
  selectedId,
  onSelect,
  onNewDispatch,
}: BoardProps) {
  const [filter, setFilter] = useState("");

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
        <span className="font-ui text-lg font-bold tracking-tight text-amber">
          rig
        </span>
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
                {/* Empty board — quiet, inviting */}
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
    </div>
  );
}
