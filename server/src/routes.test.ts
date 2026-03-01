import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerRoutes, toPiImages } from "./routes.js";
import { killBridge, sendCommand, spawnPi } from "./pi-bridge.js";

vi.mock("./pi-bridge.js", () => ({
  spawnPi: vi.fn(),
  sendCommand: vi.fn(),
  sendRaw: vi.fn(),
  killBridge: vi.fn(),
}));

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

describe("/api/models/capabilities", () => {
  const bridge = { id: "bridge_test", alive: true } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawnPi).mockResolvedValue(bridge);
  });

  it("resolves capabilities without mutating model state", async () => {
    vi.mocked(sendCommand).mockImplementation(async (_bridge, command) => {
      if (command.type === "get_available_models") {
        return {
          success: true,
          data: {
            models: [
              {
                provider: "anthropic",
                id: "claude-3-7-sonnet-20250219",
                reasoning: true,
              },
            ],
          },
        };
      }
      return { success: true };
    });

    const app = Fastify();
    await app.register(websocket);
    await registerRoutes(app);

    const res = await app.inject({
      method: "GET",
      url: "/api/models/capabilities?provider=anthropic&modelId=claude-3-7-sonnet-20250219",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      provider: "anthropic",
      modelId: "claude-3-7-sonnet-20250219",
      thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    });

    const commandTypes = vi.mocked(sendCommand).mock.calls.map(([, command]) => command?.type);
    expect(commandTypes).toEqual(["get_available_models"]);
    expect(commandTypes).not.toContain("set_model");
    expect(commandTypes).not.toContain("cycle_thinking_level");
    expect(commandTypes).not.toContain("set_thinking_level");
    expect(killBridge).toHaveBeenCalledWith(bridge);

    await app.close();
  });

  it("includes xhigh for gpt-5.2 models", async () => {
    vi.mocked(sendCommand).mockResolvedValue({
      success: true,
      data: {
        models: [
          {
            provider: "openai-codex",
            id: "gpt-5.2-codex",
            reasoning: true,
          },
        ],
      },
    });

    const app = Fastify();
    await app.register(websocket);
    await registerRoutes(app);

    const res = await app.inject({
      method: "GET",
      url: "/api/models/capabilities?provider=openai-codex&modelId=gpt-5.2-codex",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().thinkingLevels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);

    await app.close();
  });
});
