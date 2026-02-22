import { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, Sparkles, Check } from "lucide-react";
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

export function ModelPicker({
  scopedModels,
  selected,
  onSelect,
  onClose,
}: ModelPickerProps) {
  const [search, setSearch] = useState("");
  const [allModels, setAllModels] = useState<AllModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Slight delay to ensure the popover is mounted
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
    const nonScoped = allModels.filter(
      (m) => !scopedSet.has(`${m.provider}/${m.modelId}`),
    );
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

  const handleSelect = (
    provider: string,
    modelId: string,
    displayName: string,
  ) => {
    onSelect({ provider, modelId, displayName });
    onClose();
  };

  const selectedKey = selected
    ? `${selected.provider}/${selected.modelId}`
    : "";

  return (
    <div className="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-xl shadow-xl z-20 overflow-hidden max-h-[400px] flex flex-col ring-1 ring-black/10">
      {/* Search Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface shrink-0">
        <Search size={14} className="text-amber shrink-0" />
        <input
          ref={searchRef}
          type="text"
          placeholder="find a model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent text-[13px] font-ui font-medium text-text placeholder:text-text-muted/50 outline-none"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-text-muted hover:text-text cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="overflow-y-auto flex-1 p-1">
        {/* Scoped / enabled models */}
        {filteredScoped.length > 0 && (
          <div className="mb-2">
            <div className="px-3 py-2 font-mono text-[10px] font-medium tracking-widest text-text-muted/70 uppercase">
              Enabled
            </div>
            {filteredScoped.map((m) => {
              const key = `${m.provider}/${m.modelId}`;
              const isSelected = key === selectedKey;
              return (
                <button
                  key={key}
                  onClick={() =>
                    handleSelect(m.provider, m.modelId, m.displayName)
                  }
                  className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-all cursor-pointer group ${
                    isSelected
                      ? "bg-amber/10 text-amber"
                      : "text-text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  <div
                    className={`w-1 h-1 rounded-full shrink-0 ${
                      isSelected ? "bg-amber" : "bg-border group-hover:bg-text-muted"
                    }`}
                  />
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span
                      className={`font-ui text-[13px] font-medium truncate ${
                        isSelected ? "text-amber" : "text-text"
                      }`}
                    >
                      {m.displayName}
                    </span>
                    <span className="font-mono text-[10px] opacity-60 truncate">
                      {m.provider} / {m.modelId}
                    </span>
                  </div>
                  {isSelected && <Check size={14} className="text-amber" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Toggle for all models */}
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full mx-auto my-1 px-3 py-2 text-center rounded-lg font-mono text-[11px] text-text-muted hover:text-amber hover:bg-amber/5 transition-colors cursor-pointer border border-dashed border-border hover:border-amber/30"
          >
            show all available models ({filteredScoped.length} hidden)
          </button>
        )}

        {/* Loading State */}
        {showAll && loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <div className="w-4 h-4 border-2 border-amber border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-[10px] text-text-muted">
              fetching registry...
            </span>
          </div>
        )}

        {/* All models by provider */}
        {showAll &&
          !loading &&
          Array.from(filteredAll.entries()).map(([provider, models]) => (
            <div key={provider} className="mt-2 first:mt-0">
              <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm px-3 py-2 border-b border-border/50 font-mono text-[10px] font-medium tracking-widest text-text-muted/70 uppercase flex items-center gap-2">
                <span>{provider}</span>
                <span className="bg-surface-2 px-1.5 py-0.5 rounded text-[9px] text-text-muted">
                  {models.length}
                </span>
              </div>
              <div className="py-1">
                {models.map((m) => {
                  const key = `${m.provider}/${m.modelId}`;
                  const isSelected = key === selectedKey;
                  return (
                    <button
                      key={key}
                      onClick={() =>
                        handleSelect(m.provider, m.modelId, m.name)
                      }
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-all cursor-pointer group ${
                        isSelected
                          ? "bg-amber/10 text-amber"
                          : "text-text-muted hover:bg-surface-2 hover:text-text"
                      }`}
                    >
                      <div className="w-1 h-1 rounded-full shrink-0 bg-transparent" />
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-ui text-[13px] font-medium truncate ${
                              isSelected ? "text-amber" : "text-text"
                            }`}
                          >
                            {m.name}
                          </span>
                          {m.reasoning && (
                            <Sparkles
                              size={10}
                              className="text-amber/70 shrink-0"
                            />
                          )}
                        </div>
                        <span className="font-mono text-[10px] opacity-60 truncate">
                          {m.modelId}
                        </span>
                      </div>
                      {isSelected && <Check size={14} className="text-amber" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

        {showAll && !loading && filteredAll.size === 0 && q && (
          <div className="px-3 py-8 text-center font-mono text-[11px] text-text-muted">
            no models match "{q}"
          </div>
        )}
      </div>
    </div>
  );
}
