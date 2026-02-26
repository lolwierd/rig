import { describe, expect, it } from "vitest";
import { sanitizeImageSrc } from "./MarkdownMessage";

describe("sanitizeImageSrc", () => {
  it("allows inline image data urls", () => {
    const src = "data:image/png;base64,abc123";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  it("allows blob urls", () => {
    const src = "blob:https://example.com/1234";
    expect(sanitizeImageSrc(src)).toBe(src);
  });

  it("blocks remote http/https and non-image data urls", () => {
    expect(sanitizeImageSrc("https://example.com/cat.png")).toBeUndefined();
    expect(sanitizeImageSrc("http://example.com/cat.png")).toBeUndefined();
    expect(sanitizeImageSrc("data:text/plain;base64,abc123")).toBeUndefined();
  });
});
