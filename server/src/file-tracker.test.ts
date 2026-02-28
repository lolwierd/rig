import { describe, expect, it, beforeEach, vi } from "vitest";
import { FileTracker } from "./file-tracker.js";

describe("FileTracker", () => {
  let tracker: FileTracker;

  beforeEach(() => {
    tracker = new FileTracker();
  });

  describe("processEvent", () => {
    it("returns null for non-tool_execution_start events", () => {
      expect(tracker.processEvent({ type: "message" })).toBeNull();
      expect(tracker.processEvent({ type: "tool_execution_end" })).toBeNull();
    });

    it('tracks "read" tool → action "read"', () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/src/index.ts" },
      });
      expect(result).toMatchObject({ path: "/src/index.ts", action: "read" });
      expect(result!.timestamp).toBeTypeOf("number");
    });

    it('tracks "edit" tool → action "edit"', () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "edit",
        args: { path: "/src/app.ts" },
      });
      expect(result).toMatchObject({ path: "/src/app.ts", action: "edit" });
    });

    it('tracks "write" tool → action "new"', () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "write",
        args: { path: "/src/new-file.ts" },
      });
      expect(result).toMatchObject({ path: "/src/new-file.ts", action: "new" });
    });

    it('returns null for "bash" tool', () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls -la" },
      });
      expect(result).toBeNull();
    });

    it("returns null for unknown tool names", () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "search",
        args: { query: "foo" },
      });
      expect(result).toBeNull();
    });

    it("returns null when args.path is missing", () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: {},
      });
      expect(result).toBeNull();
    });

    it("updates existing file entry on re-read/re-edit", () => {
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/src/index.ts" },
      });
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "edit",
        args: { path: "/src/index.ts" },
      });
      expect(result).toMatchObject({ path: "/src/index.ts", action: "edit" });
      expect(tracker.getFiles()).toHaveLength(1);
    });

    it("returns null when toolName is missing", () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        args: { path: "/src/index.ts" },
      });
      expect(result).toBeNull();
    });

    it("returns null when args is missing", () => {
      const result = tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
      });
      expect(result).toBeNull();
    });
  });

  describe("getFiles", () => {
    it("returns empty array initially", () => {
      expect(tracker.getFiles()).toEqual([]);
    });

    it("returns files sorted by most recently touched (descending timestamp)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/a.ts" },
      });
      vi.setSystemTime(2000);
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/b.ts" },
      });
      vi.setSystemTime(3000);
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/c.ts" },
      });

      const files = tracker.getFiles();
      expect(files.map((f) => f.path)).toEqual(["/c.ts", "/b.ts", "/a.ts"]);
      vi.useRealTimers();
    });

    it("deduplicates files by path", () => {
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/a.ts" },
      });
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "edit",
        args: { path: "/a.ts" },
      });
      expect(tracker.getFiles()).toHaveLength(1);
      expect(tracker.getFiles()[0].action).toBe("edit");
    });
  });

  describe("clear", () => {
    it("clears all tracked files", () => {
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/a.ts" },
      });
      tracker.processEvent({
        type: "tool_execution_start",
        toolName: "write",
        args: { path: "/b.ts" },
      });
      expect(tracker.getFiles()).toHaveLength(2);
      tracker.clear();
      expect(tracker.getFiles()).toEqual([]);
    });
  });
});
