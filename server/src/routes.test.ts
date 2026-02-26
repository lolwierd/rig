import { describe, expect, it } from "vitest";
import { toPiImages } from "./routes.js";

describe("toPiImages", () => {
  it("returns undefined for empty input", () => {
    expect(toPiImages()).toBeUndefined();
    expect(toPiImages([])).toBeUndefined();
  });

  it("converts image data urls into pi image content", () => {
    const out = toPiImages([
      { url: "data:image/png;base64,abc123", mediaType: "image/png" },
    ]);

    expect(out).toEqual([
      { type: "image", data: "abc123", mimeType: "image/png" },
    ]);
  });

  it("filters out non-image and remote urls", () => {
    const out = toPiImages([
      { url: "data:text/plain;base64,abc123" },
      { url: "https://example.com/image.png" },
    ]);

    expect(out).toBeUndefined();
  });
});
