import { useState, useEffect } from "react";
import { Folder, ChevronUp, X, Check } from "lucide-react";
import { browseDirectory } from "../lib/api";

interface FolderPickerProps {
  onSelect: (path: string, name: string) => void;
  onClose: () => void;
}

export function FolderPicker({ onSelect, onClose }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const browse = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await browseDirectory(path);
      setCurrentPath(data.path);
      setParentPath(data.parent);
      setDirectories(data.directories);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    browse();
  }, []);

  const currentName = currentPath.split("/").filter(Boolean).pop() || "root";

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70 z-[60] animate-[fade-in_100ms_ease]"
        onClick={onClose}
      />
      <div className="fixed inset-x-4 top-[10%] bottom-[10%] z-[60] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[480px] lg:h-[420px] animate-[fade-in_100ms_ease]">
        <div className="bg-surface border border-border rounded-xl shadow-2xl flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <span className="font-mono text-[11px] font-semibold tracking-widest uppercase text-amber">
              Pick Folder
            </span>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text transition-colors p-1 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Current path + go up */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface-2/50 shrink-0">
            {parentPath && (
              <button
                onClick={() => browse(parentPath)}
                className="p-1 text-text-muted hover:text-text transition-colors cursor-pointer rounded hover:bg-surface-3"
                title="Go up"
              >
                <ChevronUp size={14} />
              </button>
            )}
            <span className="font-mono text-[11px] text-text-dim truncate min-w-0" title={currentPath}>
              {currentPath}
            </span>
          </div>

          {/* Directory listing */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {error && (
              <div className="px-4 py-4 font-mono text-[11px] text-red">{error}</div>
            )}
            {!loading && !error && directories.length === 0 && (
              <div className="px-4 py-8 text-center font-mono text-[11px] text-text-muted">
                no subdirectories
              </div>
            )}
            {!loading &&
              !error &&
              directories.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => browse(dir.path)}
                  className="w-full text-left flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-2 transition-colors cursor-pointer border-b border-border/50"
                >
                  <Folder size={14} className="text-amber/60 shrink-0" />
                  <span className="font-mono text-[12px] text-text truncate">{dir.name}</span>
                </button>
              ))}
          </div>

          {/* Footer: select this folder */}
          <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-surface shrink-0">
            <span className="font-mono text-[10px] text-text-muted flex-1 truncate">
              {currentName}
            </span>
            <button
              onClick={() => onSelect(currentPath, currentName)}
              className="flex items-center gap-1.5 h-8 px-4 bg-amber text-bg rounded-lg font-mono text-[11px] font-semibold cursor-pointer hover:brightness-110 transition-all"
            >
              <Check size={12} />
              Select
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
