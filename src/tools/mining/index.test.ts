import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("mineflayer-pathfinder", () => {
  class MockMovements {
    constructor(public readonly bot: unknown) {}
  }

  class GoalNear {
    constructor(
      public readonly x: number,
      public readonly y: number,
      public readonly z: number,
      public readonly range: number
    ) {}
  }

  return {
    default: {
      Movements: MockMovements,
      goals: { GoalNear },
    },
    Movements: MockMovements,
    goals: { GoalNear },
  };
});

import { registerMiningTools } from "./index.js";

type RegisteredTool = {
  cb: (args?: Record<string, unknown>, extra?: unknown) => Promise<any>;
};

function block(
  name: string,
  x: number,
  y: number,
  z: number,
  overrides: Partial<any> = {}
) {
  return {
    name,
    position: { x, y, z },
    diggable: true,
    harvestTools: undefined,
    ...overrides,
  };
}

function createBot(options: {
  blocks?: Record<string, any>;
  inventoryItems?: Array<{ type: number; name: string }>;
  bestTool?: { type: number; name: string } | null;
  gotoImpl?: () => Promise<void>;
  digImpl?: () => Promise<void>;
} = {}) {
  const blocks = options.blocks ?? {};

  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    blockAt: vi.fn((pos: { x: number; y: number; z: number }) => {
      return blocks[`${pos.x},${pos.y},${pos.z}`] ?? null;
    }),
    inventory: {
      items: vi.fn(() => options.inventoryItems ?? []),
    },
    heldItem: null,
    canDigBlock: vi.fn((b: any) => b.diggable !== false),
    equip: vi.fn(async () => {}),
    dig: vi.fn(options.digImpl ?? (async () => {})),
    clearControlStates: vi.fn(),
    pathfinder: {
      setGoal: vi.fn(),
      setMovements: vi.fn(),
      goto: vi.fn(options.gotoImpl ?? (async () => {})),
      bestHarvestTool: vi.fn(() => options.bestTool ?? null),
    },
    players: {},
  };
}

function createHarness(initialBot: any = null) {
  const tools = new Map<string, RegisteredTool>();
  let bot = initialBot;

  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredTool["cb"]) {
      tools.set(name, { cb });
      return {} as any;
    },
  } as unknown as McpServer;

  registerMiningTools(server, () => bot);

  return {
    setBot(nextBot: any) {
      bot = nextBot;
    },
    async call(name: string, args?: Record<string, unknown>) {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool not registered: ${name}`);
      }
      return tool.cb(args, {});
    },
  };
}

describe("mining tools", () => {
  it("mines a valid block by coordinates", async () => {
    const bot = createBot({
      blocks: {
        "1,64,1": block("stone", 1, 64, 1),
      },
      bestTool: { type: 257, name: "iron_pickaxe" },
    });

    const harness = createHarness(bot);
    const result = await harness.call("mine_block_by_coords", {
      x: 1,
      y: 64,
      z: 1,
      timeout_ms: 30000,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Mined stone");
    expect(bot.equip).toHaveBeenCalledTimes(1);
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it("rejects unmineable block and missing required tool", async () => {
    const bot = createBot({
      blocks: {
        "2,64,2": block("bedrock", 2, 64, 2, { diggable: false }),
        "3,64,3": block("obsidian", 3, 64, 3, { harvestTools: { "278": true } }),
      },
      inventoryItems: [],
    });

    const harness = createHarness(bot);

    const bedrock = await harness.call("mine_block_by_coords", {
      x: 2,
      y: 64,
      z: 2,
      timeout_ms: 30000,
    });

    expect(bedrock.isError).toBe(true);
    expect(bedrock.content[0].text).toContain("not diggable");

    const obsidian = await harness.call("mine_block_by_coords", {
      x: 3,
      y: 64,
      z: 3,
      timeout_ms: 30000,
    });

    expect(obsidian.isError).toBe(true);
    expect(obsidian.content[0].text).toContain("Missing required tool");
  });

  it("mines room and returns summary", async () => {
    const bot = createBot({
      blocks: {
        "0,64,0": block("stone", 0, 64, 0),
        "1,64,0": block("dirt", 1, 64, 0),
      },
      bestTool: { type: 257, name: "iron_pickaxe" },
    });

    const harness = createHarness(bot);
    const result = await harness.call("mine_room", {
      start_x: 0,
      start_y: 64,
      start_z: 0,
      length: 2,
      width: 1,
      depth: 1,
      timeout_ms: 60000,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("mined=2");
  });

  it("mines room layer-by-layer from top to bottom", async () => {
    const bot = createBot({
      blocks: {
        "0,64,0": block("stone", 0, 64, 0),
        "0,63,0": block("stone", 0, 63, 0),
        "0,62,0": block("stone", 0, 62, 0),
        "1,64,0": block("stone", 1, 64, 0),
        "1,63,0": block("stone", 1, 63, 0),
        "1,62,0": block("stone", 1, 62, 0),
      },
      bestTool: { type: 257, name: "iron_pickaxe" },
    });

    const harness = createHarness(bot);
    const result = await harness.call("mine_room", {
      start_x: 0,
      start_y: 64,
      start_z: 0,
      length: 2,
      width: 1,
      depth: 3,
      timeout_ms: 60000,
    });

    expect(result.isError).toBeUndefined();

    const digOrder = bot.dig.mock.calls.map((call: any[]) => {
      const b = call[0];
      return `${b.position.x},${b.position.y},${b.position.z}`;
    });

    expect(digOrder).toEqual([
      "0,64,0",
      "1,64,0",
      "0,63,0",
      "1,63,0",
      "0,62,0",
      "1,62,0",
    ]);
  });

  it("breaks connected tree logs", async () => {
    const bot = createBot({
      blocks: {
        "5,64,5": block("oak_log", 5, 64, 5),
        "5,65,5": block("oak_log", 5, 65, 5),
        "5,66,5": block("oak_log", 5, 66, 5),
      },
      bestTool: { type: 258, name: "iron_axe" },
    });

    const harness = createHarness(bot);
    const result = await harness.call("break_tree", {
      x: 5,
      y: 64,
      z: 5,
      timeout_ms: 60000,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("logs_mined=3");
  });

  it("mines stairs and supports timeout cancellation", async () => {
    vi.useFakeTimers();

    try {
      const pendingGoto = vi.fn(
        () =>
          new Promise<void>(() => {
            // never resolve
          })
      );

      const bot = createBot({
        blocks: {
          "1,63,0": block("stone", 1, 63, 0),
        },
        gotoImpl: pendingGoto,
      });

      const harness = createHarness(bot);
      const promise = harness.call("mine_stairs", {
        depth: 1,
        timeout_ms: 1000,
      });

      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No support block");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops room mining if no block is mined within timeout", async () => {
    vi.useFakeTimers();

    try {
      const pendingGoto = vi.fn(
        () =>
          new Promise<void>(() => {
            // never resolve
          })
      );

      const bot = createBot({
        blocks: {
          "0,64,0": block("stone", 0, 64, 0),
          "1,64,0": block("stone", 1, 64, 0),
        },
        gotoImpl: pendingGoto,
      });

      const harness = createHarness(bot);
      const promise = harness.call("mine_room", {
        start_x: 0,
        start_y: 64,
        start_z: 0,
        length: 2,
        width: 1,
        depth: 1,
        timeout_ms: 1000,
      });

      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No block mined");
    } finally {
      vi.useRealTimers();
    }
  });

});
