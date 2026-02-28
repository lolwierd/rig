import { describe, expect, it, vi, beforeEach } from "vitest";
import { readSessionEntries } from "./session-store.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

import { readFile } from "node:fs/promises";
const mockedReadFile = vi.mocked(readFile);

describe("readSessionEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses valid JSONL lines", async () => {
    mockedReadFile.mockResolvedValue(
      '{"type":"session","id":"1"}\n{"type":"message","role":"user"}\n'
    );
    const entries = await readSessionEntries("/fake/session.jsonl");
    expect(entries).toEqual([
      { type: "session", id: "1" },
      { type: "message", role: "user" },
    ]);
  });

  it("skips empty lines", async () => {
    mockedReadFile.mockResolvedValue(
      '{"type":"session","id":"1"}\n\n\n{"type":"message"}\n'
    );
    const entries = await readSessionEntries("/fake/session.jsonl");
    expect(entries).toHaveLength(2);
  });

  it("skips malformed JSON lines", async () => {
    mockedReadFile.mockResolvedValue(
      '{"type":"session","id":"1"}\nnot-json\n{"type":"message"}\n'
    );
    const entries = await readSessionEntries("/fake/session.jsonl");
    expect(entries).toEqual([
      { type: "session", id: "1" },
      { type: "message" },
    ]);
  });

  it("returns empty array for non-existent file", async () => {
    mockedReadFile.mockRejectedValue(new Error("ENOENT"));
    const entries = await readSessionEntries("/fake/nonexistent.jsonl");
    expect(entries).toEqual([]);
  });

  it("handles a mix of valid and invalid lines", async () => {
    mockedReadFile.mockResolvedValue(
      [
        '{"a":1}',
        "{broken",
        "",
        '{"b":2}',
        "null-ish garbage",
        '{"c":3}',
      ].join("\n")
    );
    const entries = await readSessionEntries("/fake/mixed.jsonl");
    expect(entries).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});
