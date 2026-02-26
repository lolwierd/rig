import { describe, expect, it } from "vitest";
import type { LogEntry } from "../types";
import { shouldDedupeDirective } from "./useSessionBridge";

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
