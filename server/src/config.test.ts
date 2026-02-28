import { describe, expect, it } from "vitest";
import { addProject, removeProject, type RigConfig } from "./config.js";

const baseConfig: RigConfig = {
  port: 3100,
  projects: [],
};

describe("addProject", () => {
  it("adds a project to empty list", () => {
    const result = addProject(baseConfig, "/home/user/my-app", "my-app");
    expect(result.projects).toEqual([{ path: "/home/user/my-app", name: "my-app" }]);
  });

  it("adds a project to non-empty list", () => {
    const config: RigConfig = {
      ...baseConfig,
      projects: [{ path: "/home/user/existing", name: "existing" }],
    };
    const result = addProject(config, "/home/user/new-app", "new-app");
    expect(result.projects).toEqual([
      { path: "/home/user/existing", name: "existing" },
      { path: "/home/user/new-app", name: "new-app" },
    ]);
  });

  it("deduplicates by path (replaces existing with same path)", () => {
    const config: RigConfig = {
      ...baseConfig,
      projects: [{ path: "/home/user/app", name: "old-name" }],
    };
    const result = addProject(config, "/home/user/app", "new-name");
    expect(result.projects).toEqual([{ path: "/home/user/app", name: "new-name" }]);
    expect(result.projects).toHaveLength(1);
  });

  it("preserves other config fields (port, operator)", () => {
    const config: RigConfig = {
      port: 4200,
      projects: [],
      operator: {
        telegram: { botToken: "tok123", allowedChatIds: [1] },
        defaultModel: { provider: "anthropic", modelId: "claude-4" },
      },
    };
    const result = addProject(config, "/home/user/app", "app");
    expect(result.port).toBe(4200);
    expect(result.operator).toEqual(config.operator);
  });
});

describe("removeProject", () => {
  it("removes existing project by path", () => {
    const config: RigConfig = {
      ...baseConfig,
      projects: [
        { path: "/home/user/a", name: "a" },
        { path: "/home/user/b", name: "b" },
      ],
    };
    const result = removeProject(config, "/home/user/a");
    expect(result.projects).toEqual([{ path: "/home/user/b", name: "b" }]);
  });

  it("no-op when path doesn't exist", () => {
    const config: RigConfig = {
      ...baseConfig,
      projects: [{ path: "/home/user/a", name: "a" }],
    };
    const result = removeProject(config, "/home/user/nonexistent");
    expect(result.projects).toEqual([{ path: "/home/user/a", name: "a" }]);
  });

  it("preserves other config fields", () => {
    const config: RigConfig = {
      port: 5000,
      projects: [{ path: "/home/user/a", name: "a" }],
      operator: { defaultModel: { provider: "openai", modelId: "gpt-5" } },
    };
    const result = removeProject(config, "/home/user/a");
    expect(result.port).toBe(5000);
    expect(result.operator).toEqual(config.operator);
  });
});
