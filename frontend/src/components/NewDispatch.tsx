import { X, Search, FolderOpen, FolderPlus, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { Project, ModelInfo, ThinkingLevel, ImageBlock } from "../types";
import { getProjectColor } from "../lib/utils";
import { addProject, fetchModelCapabilities } from "../lib/api";
import { FolderPicker } from "./FolderPicker";
import { ModelPicker } from "./ModelPicker";

interface NewDispatchProps {
  projects: Project[];
  models: ModelInfo[];
  defaultModel: ModelInfo | null;
  onDispatch: (
    projectPath: string,
    message: string,
    model: ModelInfo,
    thinkingLevel?: ThinkingLevel,
    images?: ImageBlock[],
  ) => void;
  onClose: () => void;
  onProjectsChanged: () => void;
}

type ModelCapability = {
  levels: ThinkingLevel[];
};

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
};

function modelKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}


export function NewDispatch({
  projects,
  models,
  defaultModel,
  onDispatch,
  onClose,
  onProjectsChanged,
}: NewDispatchProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(projects[0] ?? null);
  const [message, setMessage] = useState("");
  const [attachedImages, setAttachedImages] = useState<ImageBlock[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(defaultModel ?? models[0] ?? null);
  const [selectedThinking, setSelectedThinking] = useState<ThinkingLevel>("medium");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<Map<string, ModelCapability>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (projectPickerOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [projectPickerOpen]);

  useEffect(() => {
    let cancelled = false;
    const model = selectedModel;
    if (!model) return;

    const key = modelKey(model.provider, model.modelId);
    if (capabilities.has(key)) return;

    fetchModelCapabilities(model.provider, model.modelId)
      .then((data) => {
        if (cancelled) return;
        setCapabilities((prev) => {
          const next = new Map(prev);
          next.set(key, { levels: data.thinkingLevels });
          return next;
        });
      })
      .catch(() => {
        // conservative fallback until capability is known
        if (cancelled) return;
        setCapabilities((prev) => {
          const next = new Map(prev);
          next.set(key, { levels: ["off"] });
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedModel, capabilities]);

  const filteredProjects = useMemo(() => {
    if (!projectSearch) return projects;
    const q = projectSearch.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const selectedCapability = useMemo(() => {
    if (!selectedModel) return undefined;
    return capabilities.get(modelKey(selectedModel.provider, selectedModel.modelId));
  }, [capabilities, selectedModel]);

  const capabilityKnown = !!selectedCapability;
  const supportedThinking = selectedCapability?.levels ?? (["off"] as ThinkingLevel[]);
  const supportsThinking = capabilityKnown && supportedThinking.some((l) => l !== "off");

  useEffect(() => {
    if (!capabilityKnown) return;
    if (!supportsThinking) {
      setSelectedThinking("off");
      return;
    }
    if (!supportedThinking.includes(selectedThinking)) {
      setSelectedThinking(supportedThinking.includes("medium") ? "medium" : supportedThinking[0]);
    }
  }, [capabilityKnown, supportsThinking, supportedThinking, selectedThinking]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const mediaType = file.type || "image/png";
          setAttachedImages((prev) => [...prev, { url: dataUrl, mediaType }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = () => {
    if (!selectedProject || (!message.trim() && attachedImages.length === 0) || !selectedModel) return;
    onDispatch(
      selectedProject.path,
      message.trim(),
      selectedModel,
      supportsThinking ? selectedThinking : undefined,
      attachedImages.length > 0 ? attachedImages : undefined,
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFolderSelect = async (path: string, name: string) => {
    setShowFolderPicker(false);
    try {
      await addProject(path, name);
      onProjectsChanged();
      setSelectedProject({ path, name });
      setProjectPickerOpen(false);
    } catch (err) {
      console.error("Failed to add project:", err);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 animate-[fade-in_150ms_ease]" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 z-50 animate-[slide-up_250ms_ease] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[560px] lg:max-w-[calc(100vw-2rem)] lg:rounded-xl lg:animate-[fade-in_150ms_ease]">
        <div className="rounded-t-2xl border-t border-border bg-surface p-5 lg:rounded-xl lg:border">
          <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-surface-3 lg:hidden" />

          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-amber">
              New Dispatch
            </span>
            <button onClick={onClose} className="cursor-pointer p-1 text-text-muted transition-colors hover:text-text">
              <X size={16} />
            </button>
          </div>
          <div className="mb-3">
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text-muted">
              Project
            </label>
            <div className="relative">
              <button
                onClick={() => {
                  setProjectPickerOpen(!projectPickerOpen);
                  if (!projectPickerOpen) setModelPickerOpen(false);
                }}
                className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 text-left transition-colors hover:border-border-bright cursor-pointer"
                title={selectedProject ? `${selectedProject.name}\n${selectedProject.path}` : undefined}
              >
                {selectedProject ? (
                  <>
                    <FolderOpen size={13} className="shrink-0 text-text-muted" />
                    <span
                      className="max-w-[38%] shrink-0 truncate rounded px-1.5 py-px font-mono text-[10px] font-semibold"
                      style={{
                        background: getProjectColor(selectedProject.name).bg,
                        color: getProjectColor(selectedProject.name).text,
                      }}
                    >
                      {selectedProject.name}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[10px] text-text-muted">
                      {selectedProject.path}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-[11px] text-text-muted">select a project…</span>
                )}
                <span className="ml-auto shrink-0 text-[10px] text-text-muted">▾</span>
              </button>

              {projectPickerOpen && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-hidden rounded-lg border border-border-bright bg-surface shadow-lg">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <Search size={12} className="shrink-0 text-text-muted" />
                    <input
                      ref={searchRef}
                      type="text"
                      placeholder="search projects..."
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="flex-1 bg-transparent font-mono text-xs text-text placeholder:text-text-muted outline-none"
                    />
                  </div>

                  <div className="max-h-48 overflow-y-auto">
                    {filteredProjects.map((project) => (
                      <button
                        key={project.path}
                        onClick={() => {
                          setSelectedProject(project);
                          setProjectPickerOpen(false);
                          setProjectSearch("");
                        }}
                        className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 ${
                          selectedProject?.path === project.path ? "bg-surface-2" : ""
                        }`}
                        title={`${project.name}\n${project.path}`}
                      >
                        <span
                          className="max-w-[45%] shrink-0 truncate rounded px-1.5 py-px font-mono text-[10px] font-semibold"
                          style={{
                            background: getProjectColor(project.name).bg,
                            color: getProjectColor(project.name).text,
                          }}
                        >
                          {project.name}
                        </span>
                        <span className="min-w-0 truncate font-mono text-[10px] text-text-muted">
                          {project.path}
                        </span>
                      </button>
                    ))}
                    {filteredProjects.length === 0 && !projectSearch && (
                      <div className="px-3 py-4 text-center font-mono text-[11px] text-text-muted">no projects yet</div>
                    )}
                    {filteredProjects.length === 0 && projectSearch && (
                      <div className="px-3 py-4 text-center font-mono text-[11px] text-text-muted">no projects match</div>
                    )}
                  </div>

                  <button
                    onClick={() => setShowFolderPicker(true)}
                    className="flex w-full cursor-pointer items-center gap-2.5 border-t border-border px-3 py-2.5 text-amber/80 transition-colors hover:bg-surface-2 hover:text-amber"
                  >
                    <FolderPlus size={13} />
                    <span className="font-mono text-[11px] font-medium">Add project folder…</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text-muted">
              Directive
            </label>
            <textarea
              ref={textareaRef}
              placeholder="what do you want done?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-[13px] leading-relaxed text-text placeholder:text-text-muted outline-none transition-colors focus:border-border-bright"
            />
            {attachedImages.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {attachedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img.url}
                      alt={`Attached ${i + 1}`}
                      className="h-16 w-16 object-cover rounded-lg border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red text-bg rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2.5">
            <div className="relative min-w-0 flex-1 basis-[250px]">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text-muted">Model</label>
              <button
                onClick={() => {
                  setModelPickerOpen(!modelPickerOpen);
                  if (!modelPickerOpen) setProjectPickerOpen(false);
                }}
                className="flex h-9 w-full items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 font-mono text-[10px] text-text-dim transition-colors hover:border-border-bright cursor-pointer"
                title={selectedModel ? `${selectedModel.provider}/${selectedModel.modelId}` : undefined}
              >
                {selectedModel ? (
                  <>
                    <span className="shrink-0 text-text-muted">{selectedModel.provider}</span>
                    <span className="shrink-0 text-text-muted">/</span>
                    <span className="min-w-0 truncate">{selectedModel.displayName}</span>
                  </>
                ) : (
                  <span className="text-text-muted">select model</span>
                )}
                <ChevronDown size={10} className="ml-auto shrink-0 text-text-muted" />
              </button>

              {modelPickerOpen && (
                <ModelPicker
                  scopedModels={models}
                  selected={selectedModel}
                  onSelect={(m) => {
                    setSelectedModel(m);
                    setModelPickerOpen(false);
                  }}
                  onClose={() => setModelPickerOpen(false)}
                />
              )}
            </div>

            <div className="min-w-[180px] max-w-full">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text-muted">
                Thinking
              </label>
              <div className="h-9 rounded-lg border border-border bg-surface-2 p-0.5 flex items-center gap-0.5 overflow-x-auto">
                {(supportsThinking ? supportedThinking : (["off"] as ThinkingLevel[])).map((level) => {
                  const selected = (supportsThinking ? selectedThinking : "off") === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => supportsThinking && setSelectedThinking(level)}
                      disabled={!supportsThinking || !capabilityKnown}
                      className={`h-full whitespace-nowrap rounded-md px-2 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                        selected
                          ? "border border-amber/35 bg-amber/10 text-amber"
                          : "text-text-muted hover:text-text"
                      } ${!supportsThinking || !capabilityKnown ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                      title={level}
                    >
                      {THINKING_LABELS[level]}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {!capabilityKnown && (
            <div className="mt-2 font-mono text-[10px] text-text-muted">resolving thinking levels…</div>
          )}
          {capabilityKnown && !supportsThinking && (
            <div className="mt-2 font-mono text-[10px] text-text-muted">thinking not available for this model</div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="font-mono text-[10px] text-text-muted">⌘+Enter to dispatch</span>
            <button
              onClick={handleSubmit}
              disabled={!selectedProject || (!message.trim() && attachedImages.length === 0)}
              className="h-9 rounded-lg bg-amber px-5 font-mono text-[12px] font-semibold tracking-wide text-bg transition-all cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:brightness-100 disabled:opacity-30"
            >
              Dispatch ↑
            </button>
          </div>
        </div>
      </div>

      {showFolderPicker && (
        <FolderPicker onSelect={handleFolderSelect} onClose={() => setShowFolderPicker(false)} />
      )}
    </>
  );
}
