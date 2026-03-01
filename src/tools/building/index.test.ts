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

import { registerBuildingTools } from "./index.js";

type RegisteredTool = {
  cb: (args?: Record<string, unknown>, extra?: unknown) => Promise<any>;
};

function block(name: string, x: number, y: number, z: number) {
  return {
    name,
    position: { x, y, z },
  };
}

function createBot(options: {
  blocks?: Record<string, any>;
  inventoryItems?: Array<{ type: number; name: string; count: number }>;
  gotoImpl?: () => Promise<void>;
} = {}) {
  const blocks = { ...(options.blocks ?? {}) };

  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 }, height: 1.8 },
    entities: {},
    registry: {
      blocksByName: {
        stone: { id: 1 },
        oak_planks: { id: 5 },
      },
    },
    heldItem: null as any,
    blockAt: vi.fn((pos: { x: number; y: number; z: number }) => {
      return blocks[`${pos.x},${pos.y},${pos.z}`] ?? null;
    }),
    inventory: {
      items: vi.fn(() => options.inventoryItems ?? []),
    },
    equip: vi.fn(async (item: any) => {
      bot.heldItem = item;
    }),
    placeBlock: vi.fn(async (referenceBlock: any, faceVector: { x: number; y: number; z: number }) => {
      const x = referenceBlock.position.x + faceVector.x;
      const y = referenceBlock.position.y + faceVector.y;
      const z = referenceBlock.position.z + faceVector.z;
      blocks[`${x},${y},${z}`] = block(bot.heldItem.name, x, y, z);
    }),
    pathfinder: {
      setGoal: vi.fn(),
      setMovements: vi.fn(),
      goto: vi.fn(options.gotoImpl ?? (async () => {})),
    },
  };

  return bot;
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

  registerBuildingTools(server, () => bot);

  return {
    async call(name: string, args?: Record<string, unknown>) {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool not registered: ${name}`);
      }
      return tool.cb(args, {});
    },
  };
}

describe("building tools", () => {
  it("returns an error when place_block_at is called without a bot", async () => {
    const harness = createHarness(null);
    const result = await harness.call("place_block_at", {
      block_name: "stone",
      x: 1,
      y: 64,
      z: 1,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not connected");
  });

  it("places a single block on valid coordinates", async () => {
    const bot = createBot({
      blocks: {
        "1,63,1": block("stone", 1, 63, 1),
      },
      inventoryItems: [{ type: 1, name: "stone", count: 4 }],
    });

    const harness = createHarness(bot);
    const result = await harness.call("place_block_at", {
      block_name: "stone",
      x: 1,
      y: 64,
      z: 1,
      timeout_ms: 5000,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Placed stone");
    expect(bot.placeBlock).toHaveBeenCalledTimes(1);
  });

  it("rejects single placement when an entity occupies the target", async () => {
    const bot = createBot({
      blocks: {
        "1,63,1": block("stone", 1, 63, 1),
      },
      inventoryItems: [{ type: 1, name: "stone", count: 4 }],
    });
    bot.entities = {
      1: {
        position: { x: 1, y: 64, z: 1 },
        height: 1.8,
      },
    };

    const harness = createHarness(bot);
    const result = await harness.call("place_block_at", {
      block_name: "stone",
      x: 1,
      y: 64,
      z: 1,
      timeout_ms: 5000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("occupying");
  });

  it("checks wall resources and reports required, available, and missing", async () => {
    const bot = createBot({
      blocks: {
        "0,63,0": block("stone", 0, 63, 0),
        "1,63,0": block("stone", 1, 63, 0),
        "2,63,0": block("stone", 2, 63, 0),
      },
      inventoryItems: [{ type: 5, name: "oak_planks", count: 2 }],
    });

    const harness = createHarness(bot);
    const result = await harness.call("place_wall", {
      block_name: "oak_planks",
      start_x: 0,
      start_y: 64,
      start_z: 0,
      x_length: 3,
      y_height: 1,
      z_length: 1,
      timeout_ms: 5000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required=3");
    expect(result.content[0].text).toContain("available=2");
    expect(result.content[0].text).toContain("missing=1");
  });

  it("stops ceiling placement when there is no placement progress within timeout", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    let callCount = 0;
    nowSpy.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? 0 : 2000;
    });

    try {
      const bot = createBot({
        blocks: {
          "0,63,0": block("stone", 0, 63, 0),
          "1,63,0": block("stone", 1, 63, 0),
        },
        inventoryItems: [{ type: 5, name: "oak_planks", count: 4 }],
      });

      const harness = createHarness(bot);
      const result = await harness.call("place_ceiling", {
        block_name: "oak_planks",
        start_x: 0,
        start_y: 64,
        start_z: 0,
        x_length: 2,
        z_length: 1,
        timeout_ms: 1000,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No ceiling placement progress");
    } finally {
      nowSpy.mockRestore();
    }
  });
});
