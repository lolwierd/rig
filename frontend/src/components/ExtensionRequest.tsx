import { useState } from "react";
import { X } from "lucide-react";
import type { ExtensionUIRequest } from "../types";

interface ExtensionRequestProps {
  request: ExtensionUIRequest;
  onResponse: (response: any) => void;
}

export function ExtensionRequest({ request, onResponse }: ExtensionRequestProps) {
  const [input, setInput] = useState(request.prefill || "");

  const dismiss = () => onResponse({ cancelled: true });

  return (
    <>
      {/* Backdrop — click to dismiss */}
      <div
        className="fixed inset-0 bg-black/60 z-50 animate-[fade-in_150ms_ease]"
        onClick={dismiss}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 animate-[slide-up_250ms_ease] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[480px] lg:rounded-xl lg:animate-[fade-in_150ms_ease]">
        <div className="bg-surface border-t border-border rounded-t-2xl lg:rounded-xl lg:border p-6 shadow-2xl">
          <div className="w-10 h-1 bg-surface-3 rounded-full mx-auto mb-6 lg:hidden" />

          {/* Header with close button */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="text-sm font-medium text-text">
              {request.title || "Action Required"}
            </h3>
            <button
              onClick={dismiss}
              className="text-text-muted hover:text-text transition-colors p-0.5 cursor-pointer shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          {request.message && (
            <p className="text-xs text-text-dim mb-6 leading-relaxed">
              {request.message}
            </p>
          )}

          {/* Confirm */}
          {request.method === "confirm" && (
            <div className="flex gap-3">
              <button
                onClick={() => onResponse({ confirmed: false })}
                className="flex-1 h-10 bg-surface-2 border border-border rounded-lg text-xs font-medium text-text-dim hover:text-text hover:bg-surface-3 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => onResponse({ confirmed: true })}
                className="flex-1 h-10 bg-amber text-bg rounded-lg text-xs font-bold hover:brightness-110 transition-all cursor-pointer"
              >
                Confirm
              </button>
            </div>
          )}

          {/* Select */}
          {request.method === "select" && (
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
              {request.options?.map((opt: string) => (
                <button
                  key={opt}
                  onClick={() => onResponse({ value: opt })}
                  className="w-full text-left px-4 py-3 bg-surface-2 border border-border rounded-lg text-xs text-text hover:border-amber/50 hover:bg-surface-3 transition-colors cursor-pointer"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {/* Input / Editor */}
          {(request.method === "input" || request.method === "editor") && (
            <div className="flex flex-col gap-4">
              {request.method === "editor" ? (
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="w-full h-32 bg-surface-2 border border-border rounded-lg p-3 text-xs font-mono text-text placeholder:text-text-muted outline-none focus:border-amber/50 resize-none"
                  placeholder={request.placeholder}
                  autoFocus
                />
              ) : (
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="w-full h-10 bg-surface-2 border border-border rounded-lg px-3 text-xs text-text placeholder:text-text-muted outline-none focus:border-amber/50"
                  placeholder={request.placeholder}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && onResponse({ value: input })}
                />
              )}
              <div className="flex gap-3">
                <button
                  onClick={dismiss}
                  className="flex-1 h-10 bg-surface-2 border border-border rounded-lg text-xs font-medium text-text-dim hover:text-text hover:bg-surface-3 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onResponse({ value: input })}
                  className="flex-1 h-10 bg-amber text-bg rounded-lg text-xs font-bold hover:brightness-110 transition-all cursor-pointer"
                >
                  Submit
                </button>
              </div>
            </div>
          )}

          {/* Fallback: unknown method — just a dismiss button */}
          {request.method !== "confirm" &&
            request.method !== "select" &&
            request.method !== "input" &&
            request.method !== "editor" && (
              <button
                onClick={dismiss}
                className="w-full h-10 bg-surface-2 border border-border rounded-lg text-xs font-medium text-text-dim hover:text-text hover:bg-surface-3 transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            )}
        </div>
      </div>
    </>
  );
}
