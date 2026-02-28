import { describe, expect, it } from "vitest";
import { modelDisplayName } from "./api";

describe("modelDisplayName", () => {
  it('returns "unknown" for undefined', () => {
    expect(modelDisplayName(undefined)).toBe("unknown");
  });

  it('returns "unknown" for empty string', () => {
    expect(modelDisplayName("")).toBe("unknown");
  });

  it("strips date suffixes like -20250514", () => {
    expect(modelDisplayName("claude-sonnet-4-20250514")).toBe("claude-sonnet-4");
  });

  it("strips -preview suffix", () => {
    expect(modelDisplayName("gpt-4o-preview")).toBe("gpt-4o");
  });

  it("strips -preview even after a date segment", () => {
    // The date regex only matches at end-of-string, so -20250101 is not stripped
    // when followed by -preview; only -preview is removed.
    expect(modelDisplayName("some-model-20250101-preview")).toBe("some-model-20250101");
  });

  it("returns original name when no suffix to strip", () => {
    expect(modelDisplayName("claude-sonnet-4")).toBe("claude-sonnet-4");
  });
});
