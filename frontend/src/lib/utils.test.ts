import { describe, expect, it } from "vitest";
import { getProjectColor, getToolColor, truncatePath } from "./utils";

describe("getProjectColor", () => {
  it("returns a valid color object with bg and text", () => {
    const color = getProjectColor("my-project");
    expect(color).toHaveProperty("bg");
    expect(color).toHaveProperty("text");
    expect(color.bg).toMatch(/^rgba\(/);
    expect(color.text).toMatch(/^#/);
  });

  it("is deterministic (same name → same color)", () => {
    const a = getProjectColor("my-project");
    const b = getProjectColor("my-project");
    expect(a).toEqual(b);
  });

  it("different names can produce different colors", () => {
    const colors = new Set(
      ["alpha", "beta", "gamma", "delta", "epsilon"].map(
        (n) => getProjectColor(n).text,
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("getToolColor", () => {
  it('returns correct color for "read"', () => {
    expect(getToolColor("read")).toBe("text-blue");
  });

  it('returns correct color for "edit"', () => {
    expect(getToolColor("edit")).toBe("text-amber");
  });

  it('returns correct color for "write"', () => {
    expect(getToolColor("write")).toBe("text-green");
  });

  it('returns correct color for "bash"', () => {
    expect(getToolColor("bash")).toBe("text-violet");
  });

  it('returns "text-text-dim" for unknown tools', () => {
    expect(getToolColor("something-else")).toBe("text-text-dim");
  });
});

describe("truncatePath", () => {
  it("returns full path when segments ≤ maxSegments", () => {
    expect(truncatePath("src/lib/utils.ts")).toBe("src/lib/utils.ts");
  });

  it('truncates long paths with "…/" prefix', () => {
    expect(truncatePath("home/user/projects/rig/src/lib/utils.ts")).toBe(
      "…/src/lib/utils.ts",
    );
  });

  it("handles root paths", () => {
    expect(truncatePath("file.ts")).toBe("file.ts");
  });

  it("respects custom maxSegments parameter", () => {
    expect(truncatePath("a/b/c/d/e", 2)).toBe("…/d/e");
    expect(truncatePath("a/b/c/d/e", 4)).toBe("…/b/c/d/e");
    expect(truncatePath("a/b/c/d/e", 5)).toBe("a/b/c/d/e");
  });
});
