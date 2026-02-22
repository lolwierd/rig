import { Plus, Zap, FolderOpen, Cpu, ArrowRight, PanelLeft } from "lucide-react";

interface EmptyDetailProps {
  hasSession: boolean;
  projectCount: number;
  modelCount: number;
  onNewDispatch: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function EmptyDetail({
  hasSession,
  projectCount,
  modelCount,
  onNewDispatch,
  sidebarCollapsed,
  onToggleSidebar,
}: EmptyDetailProps) {
  if (hasSession) {
    return <IdlePrompt sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar} />;
  }

  return <FreshWorkbench projectCount={projectCount} modelCount={modelCount} onNewDispatch={onNewDispatch} />;
}

function IdlePrompt({ sidebarCollapsed, onToggleSidebar }: { sidebarCollapsed?: boolean; onToggleSidebar?: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      {sidebarCollapsed && onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="mb-6 p-2 text-text-muted hover:text-text transition-colors cursor-pointer rounded hover:bg-surface-2"
          title="Show board"
        >
          <PanelLeft size={18} />
        </button>
      )}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-px bg-border" />
        <ArrowRight size={14} className="text-text-muted" />
        <div className="w-8 h-px bg-border" />
      </div>
      <p className="font-mono text-[11px] text-text-dim">
        select a session from the board
      </p>
    </div>
  );
}

/** Rich empty state: no sessions exist yet */
function FreshWorkbench({
  projectCount,
  modelCount,
  onNewDispatch,
}: {
  projectCount: number;
  modelCount: number;
  onNewDispatch: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-8 select-none">
      {/* Schematic decoration — the "rig" identity */}
      <div className="relative mb-8">
        {/* Ambient pulse — system is alive */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-amber/[0.03] animate-[pulse-glow_4s_ease-in-out_infinite]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-amber/[0.05]" />

        {/* Center mark */}
        <div className="relative w-14 h-14 flex items-center justify-center">
          <svg
            viewBox="0 0 56 56"
            fill="none"
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Outer ring — technical/schematic feel */}
            <circle cx="28" cy="28" r="26" stroke="var(--color-border-bright)" strokeWidth="1" strokeDasharray="4 3" />
            {/* Inner ring */}
            <circle cx="28" cy="28" r="16" stroke="var(--color-amber)" strokeWidth="1" opacity="0.4" />
            {/* Crosshair marks */}
            <line x1="28" y1="4" x2="28" y2="10" stroke="var(--color-text-muted)" strokeWidth="1" />
            <line x1="28" y1="46" x2="28" y2="52" stroke="var(--color-text-muted)" strokeWidth="1" />
            <line x1="4" y1="28" x2="10" y2="28" stroke="var(--color-text-muted)" strokeWidth="1" />
            <line x1="46" y1="28" x2="52" y2="28" stroke="var(--color-text-muted)" strokeWidth="1" />
            {/* Center dot */}
            <circle cx="28" cy="28" r="3" fill="var(--color-amber)" opacity="0.6" />
          </svg>
        </div>
      </div>

      {/* Wordmark */}
      <h1 className="font-ui text-2xl font-bold tracking-tight text-text mb-1">
        rig<span className="text-amber">.</span>
      </h1>
      <p className="font-mono text-[11px] text-text-muted tracking-wide mb-8">
        dispatch console ready
      </p>

      {/* System readiness — the "departures board is on but empty" feel */}
      <div className="w-full max-w-[260px] border border-border rounded-lg bg-surface/60 mb-8 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <span className="font-mono text-[9px] font-semibold tracking-[0.15em] uppercase text-text-muted">
            System Status
          </span>
        </div>
        <div className="divide-y divide-border">
          <StatusRow
            icon={<Zap size={12} />}
            label="Engine"
            value="online"
            valueColor="text-green"
            dotColor="bg-green"
          />
          <StatusRow
            icon={<Cpu size={12} />}
            label="Models"
            value={`${modelCount} loaded`}
            valueColor="text-amber"
            dotColor="bg-amber"
          />
          <StatusRow
            icon={<FolderOpen size={12} />}
            label="Projects"
            value={`${projectCount} registered`}
            valueColor="text-blue"
            dotColor="bg-blue"
          />
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={onNewDispatch}
        className="group flex items-center gap-2.5 h-10 px-5 bg-amber text-bg rounded-lg font-mono text-[12px] font-semibold tracking-wide cursor-pointer hover:brightness-110 transition-all mb-4"
      >
        <Plus size={15} className="transition-transform group-hover:rotate-90 duration-200" />
        Dispatch first task
      </button>

      {/* Shortcut hint */}
      <div className="flex items-center gap-4 font-mono text-[10px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded text-[10px] font-mono">
            ⌘N
          </kbd>
          dispatch
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 bg-surface-2 border border-border rounded text-[10px] font-mono">
            /
          </kbd>
          search
        </span>
      </div>
    </div>
  );
}

function StatusRow({
  icon,
  label,
  value,
  valueColor,
  dotColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor: string;
  dotColor: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="text-text-muted">{icon}</span>
      <span className="font-mono text-[11px] text-text-dim flex-1">{label}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
      <span className={`font-mono text-[10px] ${valueColor}`}>{value}</span>
    </div>
  );
}
