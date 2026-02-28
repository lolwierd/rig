import { describe, expect, it } from "vitest";
import type { LogEntry } from "../types";
import { shouldDedupeDirective, isSafeInlineImageUrl, areSameImages } from "./useSessionBridge";

describe("shouldDedupeDirective", () => {
  it("dedupes only when both text and images match", () => {
    const last: LogEntry = {
      type: "directive",
      text: "",
      timestamp: "10:00:00",
      images: [{ url: "data:image/png;base64,aaa", mediaType: "image/png" }],
    };

    expect(
      shouldDedupeDirective(last, "", [{ url: "data:image/png;base64,aaa", mediaType: "image/png" }]),
    ).toBe(true);

    // Different image should not be treated as duplicate, even with empty text.
    expect(
      shouldDedupeDirective(last, "", [{ url: "data:image/png;base64,bbb", mediaType: "image/png" }]),
    ).toBe(false);
  });

  it("does not dedupe non-directive previous entries", () => {
    const last: LogEntry = {
      type: "prose",
      text: "assistant",
    };

    expect(shouldDedupeDirective(last, "", [])).toBe(false);
  });
});

describe("isSafeInlineImageUrl", () => {
  it("allows data:image/ URLs", () => {
    expect(isSafeInlineImageUrl("data:image/png;base64,abc")).toBe(true);
  });

  it("allows blob: URLs", () => {
    expect(isSafeInlineImageUrl("blob:http://localhost:5173/abc-123")).toBe(true);
  });

  it("rejects https:// URLs", () => {
    expect(isSafeInlineImageUrl("https://example.com/image.png")).toBe(false);
  });

  it("rejects data:text/ URLs", () => {
    expect(isSafeInlineImageUrl("data:text/html;base64,abc")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(isSafeInlineImageUrl("")).toBe(false);
  });
});

describe("areSameImages", () => {
  it("returns true for two undefined arrays", () => {
    expect(areSameImages(undefined, undefined)).toBe(true);
  });

  it("returns true for two empty arrays", () => {
    expect(areSameImages([], [])).toBe(true);
  });

  it("returns true for matching images", () => {
    const imgs = [{ url: "data:image/png;base64,aaa", mediaType: "image/png" }];
    expect(areSameImages(imgs, [...imgs])).toBe(true);
  });

  it("returns false for different lengths", () => {
    const a = [{ url: "data:image/png;base64,aaa", mediaType: "image/png" }];
    expect(areSameImages(a, [])).toBe(false);
  });

  it("returns false for different URLs", () => {
    const a = [{ url: "data:image/png;base64,aaa", mediaType: "image/png" }];
    const b = [{ url: "data:image/png;base64,bbb", mediaType: "image/png" }];
    expect(areSameImages(a, b)).toBe(false);
  });

  it("returns false for different mediaTypes", () => {
    const a = [{ url: "data:image/png;base64,aaa", mediaType: "image/png" }];
    const b = [{ url: "data:image/png;base64,aaa", mediaType: "image/jpeg" }];
    expect(areSameImages(a, b)).toBe(false);
  });

  it("handles undefined vs empty array", () => {
    expect(areSameImages(undefined, [])).toBe(true);
    expect(areSameImages([], undefined)).toBe(true);
  });
});
