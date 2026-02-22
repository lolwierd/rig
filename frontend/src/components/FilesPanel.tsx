import { X } from "lucide-react";
import type { TouchedFile } from "../types";

interface FilesPanelProps {
  files: TouchedFile[];
  onClose: () => void;
}

export function FilesPanel({ files, onClose }: FilesPanelProps) {
  return (
    <div className="w-[220px] border-l border-border bg-surface overflow-y-auto shrink-0">
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border">
        <span className="font-mono text-[10px] font-semibold tracking-widest uppercase text-text-dim">
          Files
        </span>
        <span className="font-mono text-[10px] bg-amber-dim text-amber px-1.5 py-px rounded">
          {files.length}
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-text-muted hover:text-text transition-colors p-0.5 cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>
      <div className="px-3.5 py-2">
        {files.map((file, i) => (
          <div
            key={i}
            className="flex items-center gap-2 py-1.5 font-mono text-[11px] text-text-dim"
          >
            <FileActionBadge action={file.action} />
            <span className="truncate min-w-0" title={file.path}>
              {file.path.split("/").pop()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileActionBadge({ action }: { action: TouchedFile["action"] }) {
  const styles: Record<string, string> = {
    edit: "bg-amber-dim text-amber",
    new: "bg-green-dim text-green",
    read: "bg-blue-dim text-blue",
    bash: "bg-violet-dim text-violet",
  };

  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-px rounded tracking-wide uppercase shrink-0 ${styles[action]}`}
    >
      {action === "new" ? "NEW" : action.toUpperCase()}
    </span>
  );
}
