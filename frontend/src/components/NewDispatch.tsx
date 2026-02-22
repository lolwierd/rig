import { X, Search, FolderOpen, FolderPlus, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import type { Project, ModelInfo } from "../types";
import { getProjectColor } from "../lib/utils";
import { addProject } from "../lib/api";
import { FolderPicker } from "./FolderPicker";
import { ModelPicker } from "./ModelPicker";

interface NewDispatchProps {
  projects: Project[];
  models: ModelInfo[];
  defaultModel: ModelInfo | null;
  onDispatch: (projectPath: string, message: string, model: ModelInfo) => void;
  onClose: () => void;
  onProjectsChanged: () => void;
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
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(defaultModel ?? models[0] ?? null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (projectPickerOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [projectPickerOpen]);

  const filteredProjects = useMemo(() => {
    if (!projectSearch) return projects;
    const q = projectSearch.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const handleSubmit = () => {
    if (!selectedProject || !message.trim() || !selectedModel) return;
    onDispatch(selectedProject.path, message.trim(), selectedModel);
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
      const project = { path, name };
      setSelectedProject(project);
      setProjectPickerOpen(false);
    } catch (err) {
      console.error("Failed to add project:", err);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 animate-[fade-in_150ms_ease]" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 z-50 animate-[slide-up_250ms_ease] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[520px] lg:rounded-xl lg:animate-[fade-in_150ms_ease]">
        <div className="bg-surface border-t border-border rounded-t-2xl lg:rounded-xl lg:border p-5">
          <div className="w-9 h-1 bg-surface-3 rounded-full mx-auto mb-4 lg:hidden" />

          <div className="flex items-center justify-between mb-5">
            <span className="font-mono text-[11px] font-semibold tracking-widest uppercase text-amber">
              New Dispatch
            </span>
            <button onClick={onClose} className="text-text-muted hover:text-text transition-colors p-1 cursor-pointer">
              <X size={16} />
            </button>
          </div>

          {/* Project selector */}
          <div className="mb-3">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest block mb-1.5">
              Project
            </label>
            <div className="relative">
              <button
                onClick={() => setProjectPickerOpen(!projectPickerOpen)}
                className="w-full h-9 bg-surface-2 border border-border rounded-lg px-3 flex items-center gap-2.5 text-left cursor-pointer hover:border-border-bright transition-colors"
              >
                {selectedProject ? (
                  <>
                    <FolderOpen size={13} className="text-text-muted shrink-0" />
                    <span
                      className="font-mono text-[11px] font-semibold px-1.5 py-px rounded"
                      style={{
                        background: getProjectColor(selectedProject.name).bg,
                        color: getProjectColor(selectedProject.name).text,
                      }}
                    >
                      {selectedProject.name}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted truncate min-w-0">
                      {selectedProject.path}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-xs text-text-muted">select a project...</span>
                )}
                <span className="ml-auto text-text-muted text-[10px]">▾</span>
              </button>

              {projectPickerOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border-bright rounded-lg shadow-lg z-10 overflow-hidden max-h-72">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <Search size={12} className="text-text-muted shrink-0" />
                    <input
                      ref={searchRef}
                      type="text"
                      placeholder="search projects..."
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="flex-1 bg-transparent text-xs font-mono text-text placeholder:text-text-muted outline-none"
                    />
                  </div>
                  <div className="overflow-y-auto max-h-48">
                    {filteredProjects.map((project) => (
                      <button
                        key={project.path}
                        onClick={() => {
                          setSelectedProject(project);
                          setProjectPickerOpen(false);
                          setProjectSearch("");
                        }}
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-surface-2 transition-colors cursor-pointer ${
                          selectedProject?.path === project.path ? "bg-surface-2" : ""
                        }`}
                      >
                        <span
                          className="font-mono text-[10px] font-semibold px-1.5 py-px rounded shrink-0"
                          style={{
                            background: getProjectColor(project.name).bg,
                            color: getProjectColor(project.name).text,
                          }}
                        >
                          {project.name}
                        </span>
                        <span className="font-mono text-[10px] text-text-muted truncate min-w-0">
                          {project.path}
                        </span>
                      </button>
                    ))}
                    {filteredProjects.length === 0 && !projectSearch && (
                      <div className="px-3 py-4 text-center font-mono text-[11px] text-text-muted">
                        no projects yet
                      </div>
                    )}
                    {filteredProjects.length === 0 && projectSearch && (
                      <div className="px-3 py-4 text-center font-mono text-[11px] text-text-muted">
                        no projects match
                      </div>
                    )}
                  </div>
                  {/* Add project button */}
                  <button
                    onClick={() => setShowFolderPicker(true)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 border-t border-border hover:bg-surface-2 transition-colors cursor-pointer text-amber/80 hover:text-amber"
                  >
                    <FolderPlus size={13} />
                    <span className="font-mono text-[11px] font-medium">Add project folder…</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Directive */}
          <div className="mb-3">
            <label className="font-mono text-[10px] text-text-muted uppercase tracking-widest block mb-1.5">
              Directive
            </label>
            <textarea
              ref={textareaRef}
              placeholder="what do you want done?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              className="w-full bg-surface-2 border border-border rounded-lg px-3.5 py-3 text-[13px] text-text placeholder:text-text-muted outline-none resize-none leading-relaxed focus:border-border-bright transition-colors"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2.5 mt-4">
            <div className="relative">
              <button
                onClick={() => setModelPickerOpen(!modelPickerOpen)}
                className="flex items-center gap-1.5 font-mono text-[10px] text-text-dim bg-surface-2 border border-border rounded-md px-2.5 py-1.5 cursor-pointer hover:border-border-bright transition-colors"
              >
                {selectedModel ? (
                  <>
                    <span className="text-text-muted">{selectedModel.provider}</span>
                    <span className="text-text-muted">/</span>
                    <span>{selectedModel.displayName}</span>
                  </>
                ) : (
                  <span className="text-text-muted">select model</span>
                )}
                <ChevronDown size={10} className="text-text-muted ml-1" />
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

            <button
              onClick={handleSubmit}
              disabled={!selectedProject || !message.trim()}
              className="ml-auto h-9 px-5 bg-amber text-bg rounded-lg font-mono text-[12px] font-semibold tracking-wide cursor-pointer hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Dispatch ↑
            </button>
          </div>

          <div className="mt-3 text-center">
            <span className="font-mono text-[10px] text-text-muted">⌘+Enter to dispatch</span>
          </div>
        </div>
      </div>

      {/* Folder picker overlay */}
      {showFolderPicker && (
        <FolderPicker onSelect={handleFolderSelect} onClose={() => setShowFolderPicker(false)} />
      )}
    </>
  );
}
