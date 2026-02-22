import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolCall } from "../types";
import { getToolColor, truncatePath } from "../lib/utils";

interface ToolCallLineProps {
  call: ToolCall;
}

export function ToolCallLine({ call }: ToolCallLineProps) {
  const colorClass = getToolColor(call.tool);
  const [expanded, setExpanded] = useState(false);
  const hasOutput = !!call.output?.trim();

  return (
    <div className="py-0.5">
      <div
        onClick={hasOutput ? () => setExpanded(!expanded) : undefined}
        className={`grid items-baseline gap-2 font-mono text-xs rounded px-1 -mx-1 ${
          hasOutput
            ? "cursor-pointer hover:bg-surface-2/50 transition-colors"
            : ""
        }`}
        style={{ gridTemplateColumns: "52px 40px 1fr auto" }}
      >
        <span className="text-[10px] text-text-muted tabular-nums">
          {call.timestamp || ""}
        </span>
        <span className={`font-semibold text-[11px] ${colorClass}`}>{call.tool}</span>
        <span className="text-text-dim truncate min-w-0" title={call.path}>
          {truncatePath(call.path, 4)}
        </span>
        <span className="flex items-center gap-1">
          {call.detail && (
            <span className="text-text-muted text-[10px] whitespace-nowrap">{call.detail}</span>
          )}
          {hasOutput && (
            <ChevronRight
              size={10}
              className={`text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </span>
      </div>
      {hasOutput && expanded && (
        <div className="ml-[60px] mt-1 pr-4 mb-1">
          <div className="text-[10px] font-mono text-text-muted bg-surface-2/50 rounded px-2 py-1.5 whitespace-pre-wrap break-all border-l-2 border-border max-h-[200px] overflow-y-auto">
            {call.output!.trim().slice(0, 2000)}
            {call.output!.length > 2000 && <span className="opacity-50">…</span>}
          </div>
        </div>
      )}
    </div>
  );
}
