import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMultiplayerTools } from "./index.js";

type RegisteredTool = {
  config: {
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
  cb: (args?: Record<string, unknown>, extra?: unknown) => Promise<any>;
};

function createHarness(initialBot: any = null) {
  const tools = new Map<string, RegisteredTool>();
  let bot = initialBot;

  const server = {
    registerTool(name: string, config: RegisteredTool["config"], cb: RegisteredTool["cb"]) {
      tools.set(name, { config, cb });
      return {} as any;
    },
  } as unknown as McpServer;

  registerMultiplayerTools(server, () => bot);

  return {
    setBot(nextBot: any) {
      bot = nextBot;
    },
    async call(name: string, args?: Record<string, unknown>) {
      const entry = tools.get(name);
      if (!entry) {
        throw new Error(`Tool not registered: ${name}`);
      }
      return entry.cb(args, {});
    },
    getTool(name: string) {
      return tools.get(name);
    },
  };
}

function player(username: string, position?: { x: number; y: number; z: number }) {
  return {
    username,
    entity: position ? { position } : undefined,
  };
}

describe("multiplayer tools", () => {
  it("registers all multiplayer tools", () => {
    const harness = createHarness();

    expect(harness.getTool("list_players")).toBeDefined();
    expect(harness.getTool("find_player")).toBeDefined();
    expect(harness.getTool("get_player_coordinates")).toBeDefined();
    expect(harness.getTool("distance_to_player")).toBeDefined();
    expect(harness.getTool("find_nearest_players")).toBeDefined();
  });

  it("returns an error when bot is not connected", async () => {
    const harness = createHarness(null);

    const listResult = await harness.call("list_players");
    const distanceResult = await harness.call("distance_to_player", { username: "Alice" });

    expect(listResult.isError).toBe(true);
    expect(listResult.content[0].text).toContain("not connected");
    expect(distanceResult.isError).toBe(true);
    expect(distanceResult.content[0].text).toContain("not connected");
  });

  it("lists players alphabetically", async () => {
    const bot = {
      username: "MCP-Bot",
      players: {
        Steve: player("Steve", { x: 0, y: 64, z: 0 }),
        Alex: player("Alex", { x: 5, y: 64, z: 0 }),
      },
      entity: { position: { x: 0, y: 64, z: 0 } },
    };

    const harness = createHarness(bot);
    const result = await harness.call("list_players");

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("Alex, Steve");
  });

  it("finds player by partial case-insensitive query", async () => {
    const bot = {
      username: "MCP-Bot",
      players: {
        BuilderBob: player("BuilderBob", { x: 0, y: 64, z: 0 }),
        Alice: player("Alice", { x: 5, y: 64, z: 0 }),
      },
      entity: { position: { x: 0, y: 64, z: 0 } },
    };

    const harness = createHarness(bot);

    const hit = await harness.call("find_player", { query: "bob" });
    const miss = await harness.call("find_player", { query: "charlie" });

    expect(hit.content[0].text).toBe("BuilderBob");
    expect(miss.content[0].text).toContain("No player found");
  });

  it("returns coordinates for visible player and errors for missing/invisible", async () => {
    const bot = {
      username: "MCP-Bot",
      players: {
        Alex: player("Alex", { x: 12.345, y: 64.5, z: -9.876 }),
        Ghost: player("Ghost"),
      },
      entity: { position: { x: 0, y: 64, z: 0 } },
    };

    const harness = createHarness(bot);

    const ok = await harness.call("get_player_coordinates", { username: "alex" });
    const invisible = await harness.call("get_player_coordinates", { username: "Ghost" });
    const missing = await harness.call("get_player_coordinates", { username: "Nobody" });

    expect(ok.content[0].text).toContain("Alex: x=12.35, y=64.50, z=-9.88");
    expect(invisible.isError).toBe(true);
    expect(invisible.content[0].text).toContain("not visible");
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("Player not found");
  });

  it("calculates 3D distance to player", async () => {
    const bot = {
      username: "MCP-Bot",
      players: {
        Target: player("Target", { x: 3, y: 68, z: 4 }),
      },
      entity: { position: { x: 0, y: 64, z: 0 } },
    };

    const harness = createHarness(bot);
    const result = await harness.call("distance_to_player", { username: "target" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("Distance to Target: 6.40 blocks");
  });

  it("handles distance errors for unavailable entities", async () => {
    const botWithoutEntity = {
      username: "MCP-Bot",
      players: {
        Alex: player("Alex", { x: 1, y: 64, z: 1 }),
      },
      entity: undefined,
    };

    const harness = createHarness(botWithoutEntity);
    const result = await harness.call("distance_to_player", { username: "Alex" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("entity is not available");

    harness.setBot({
      username: "MCP-Bot",
      players: { Alex: player("Alex") },
      entity: { position: { x: 0, y: 64, z: 0 } },
    });

    const invisible = await harness.call("distance_to_player", { username: "Alex" });
    expect(invisible.isError).toBe(true);
    expect(invisible.content[0].text).toContain("not visible");
  });

  it("finds nearest players sorted by distance and limits count", async () => {
    const bot = {
      username: "MCP-Bot",
      players: {
        "MCP-Bot": player("MCP-Bot", { x: 0, y: 64, z: 0 }),
        Far: player("Far", { x: 10, y: 64, z: 0 }),
        Near: player("Near", { x: 1, y: 64, z: 0 }),
        Mid: player("Mid", { x: 4, y: 64, z: 0 }),
      },
      entity: { position: { x: 0, y: 64, z: 0 } },
    };

    const harness = createHarness(bot);
    const result = await harness.call("find_nearest_players", { x_parameter: 2 });

    expect(result.content[0].text).toBe("1. Near (1.00 blocks)\n2. Mid (4.00 blocks)");
  });

  it("returns friendly nearest-player message when no visible players exist", async () => {
    const bot = {
      username: "MCP-Bot",
      players: {
        Hidden: player("Hidden"),
      },
      entity: { position: { x: 0, y: 64, z: 0 } },
    };

    const harness = createHarness(bot);
    const result = await harness.call("find_nearest_players", { x_parameter: 3 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("No visible players found.");
  });
});
