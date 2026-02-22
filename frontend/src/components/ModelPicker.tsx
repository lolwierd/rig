import { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, Sparkles } from "lucide-react";
import type { ModelInfo } from "../types";
import { fetchAllModels } from "../lib/api";

interface AllModel {
  provider: string;
  modelId: string;
  name: string;
  reasoning: boolean;
}

interface ModelPickerProps {
  scopedModels: ModelInfo[];
  selected: ModelInfo | null;
  onSelect: (model: ModelInfo) => void;
  onClose: () => void;
}

export function ModelPicker({ scopedModels, selected, onSelect, onClose }: ModelPickerProps) {
  const [search, setSearch] = useState("");
  const [allModels, setAllModels] = useState<AllModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  // Lazy-load all models when "Show all" is toggled
  useEffect(() => {
    if (showAll && allModels.length === 0) {
      setLoading(true);
      fetchAllModels()
        .then(setAllModels)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [showAll, allModels.length]);

  const scopedSet = useMemo(
    () => new Set(scopedModels.map((m) => `${m.provider}/${m.modelId}`)),
    [scopedModels],
  );

  const q = search.toLowerCase();

  const filteredScoped = useMemo(() => {
    if (!q) return scopedModels;
    return scopedModels.filter(
      (m) =>
        m.modelId.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q),
    );
  }, [scopedModels, q]);

  // All models grouped by provider, excluding scoped ones
  const filteredAll = useMemo(() => {
    const nonScoped = allModels.filter((m) => !scopedSet.has(`${m.provider}/${m.modelId}`));
    const matches = q
      ? nonScoped.filter(
          (m) =>
            m.modelId.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q),
        )
      : nonScoped;

    // Group by provider
    const groups = new Map<string, AllModel[]>();
    for (const m of matches) {
      const arr = groups.get(m.provider) || [];
      arr.push(m);
      groups.set(m.provider, arr);
    }
    return groups;
  }, [allModels, scopedSet, q]);

  const handleSelect = (provider: string, modelId: string, displayName: string) => {
    onSelect({ provider, modelId, displayName });
    onClose();
  };

  const selectedKey = selected ? `${selected.provider}/${selected.modelId}` : "";

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border-bright rounded-lg shadow-lg z-10 overflow-hidden max-h-80 flex flex-col">
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Search size={12} className="text-text-muted shrink-0" />
        <input
          ref={searchRef}
          type="text"
          placeholder="search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-xs font-mono text-text placeholder:text-text-muted outline-none"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-text-muted hover:text-text cursor-pointer">
            <X size={10} />
          </button>
        )}
      </div>

      <div className="overflow-y-auto flex-1">
        {/* Scoped / enabled models */}
        {filteredScoped.length > 0 && (
          <div>
            <div className="px-3 py-1.5 font-mono text-[9px] font-semibold tracking-widest uppercase text-text-muted bg-surface-2/50 border-b border-border">
              Enabled
            </div>
            {filteredScoped.map((m) => {
              const key = `${m.provider}/${m.modelId}`;
              return (
                <button
                  key={key}
                  onClick={() => handleSelect(m.provider, m.modelId, m.displayName)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-2 transition-colors cursor-pointer ${
                    key === selectedKey ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="font-mono text-[10px] text-text-muted shrink-0 w-[90px] truncate">
                    {m.provider}
                  </span>
                  <span className="font-mono text-[11px] text-text truncate">{m.displayName}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Toggle for all models */}
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full px-3 py-2.5 text-center font-mono text-[10px] text-amber/70 hover:text-amber hover:bg-surface-2 transition-colors cursor-pointer border-t border-border"
          >
            Show all models…
          </button>
        )}

        {/* All models by provider */}
        {showAll && loading && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {showAll &&
          !loading &&
          Array.from(filteredAll.entries()).map(([provider, models]) => (
            <div key={provider}>
              <div className="px-3 py-1.5 font-mono text-[9px] font-semibold tracking-widest uppercase text-text-muted bg-surface-2/50 border-y border-border">
                {provider}
              </div>
              {models.map((m) => {
                const key = `${m.provider}/${m.modelId}`;
                return (
                  <button
                    key={key}
                    onClick={() => handleSelect(m.provider, m.modelId, m.name)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-2 transition-colors cursor-pointer ${
                      key === selectedKey ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="font-mono text-[11px] text-text truncate flex-1">{m.name}</span>
                    {m.reasoning && <Sparkles size={10} className="text-amber/50 shrink-0" />}
                    <span className="font-mono text-[9px] text-text-muted shrink-0">{m.modelId}</span>
                  </button>
                );
              })}
            </div>
          ))}

        {showAll && !loading && filteredAll.size === 0 && q && (
          <div className="px-3 py-4 text-center font-mono text-[11px] text-text-muted">
            no models match "{q}"
          </div>
        )}
      </div>
    </div>
  );
}
