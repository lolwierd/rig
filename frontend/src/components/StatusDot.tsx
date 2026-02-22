import type { SessionStatus } from "../types";

interface StatusDotProps {
  status: SessionStatus;
  className?: string;
}

export function StatusDot({ status, className = "" }: StatusDotProps) {
  if (status === "running") {
    return (
      <span className={`relative flex items-center justify-center w-3 h-3 shrink-0 ${className}`}>
        <span className="absolute inset-0 rounded-full bg-amber/30 animate-ping" />
        <span className="relative w-2 h-2 rounded-full bg-amber" />
      </span>
    );
  }

  if (status === "error") {
    return <span className={`w-2 h-2 rounded-full bg-red shrink-0 ${className}`} />;
  }

  return <span className={`w-2 h-2 rounded-full bg-green shrink-0 ${className}`} />;
}
