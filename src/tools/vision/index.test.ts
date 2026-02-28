import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Vec3 } from "vec3";
import { registerVisionTools } from "./index.js";

type RegisteredTool = {
  cb: (args?: Record<string, unknown>, extra?: unknown) => Promise<any>;
};

function createHarness(initialBot: any = null) {
  const tools = new Map<string, RegisteredTool>();
  let bot = initialBot;

  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredTool["cb"]) {
      tools.set(name, { cb });
      return {} as any;
    },
  } as unknown as McpServer;

  registerVisionTools(server, () => bot);

  return {
    async call(name: string, args?: Record<string, unknown>) {
      const entry = tools.get(name);
      if (!entry) {
        throw new Error(`Tool not registered: ${name}`);
      }

      return entry.cb(args, {});
    },
  };
}

describe("vision tools", () => {
  it("returns an error for screenshot capture when bot is not connected", async () => {
    const harness = createHarness(null);
    const result = await harness.call("capture_bot_view", {
      width: 800,
      height: 400,
      view_distance: 6,
      quality: 0.9,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not connected");
  });

  it("locates dropped items sorted by distance and supports max_results", async () => {
    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      entities: {
        1: {
          type: "object",
          objectType: "Item",
          name: "item",
          position: { x: 4, y: 64, z: 0 },
          getDroppedItem: () => ({ name: "oak_log", displayName: "Oak Log", type: 17, count: 3 }),
        },
        2: {
          type: "object",
          objectType: "Item",
          name: "item",
          position: { x: 1, y: 64, z: 0 },
          getDroppedItem: () => ({ name: "stone", displayName: "Stone", type: 1, count: 2 }),
        },
        3: {
          type: "player",
          name: "Steve",
          position: { x: 0, y: 64, z: 0 },
          getDroppedItem: () => null,
        },
      },
      findBlocks: vi.fn(),
      blockAt: vi.fn(),
    };

    const harness = createHarness(bot);
    const result = await harness.call("locate_dropped_items", {
      radius: 10,
      max_results: 1,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Returning 1");
    expect(result.content[0].text).toContain("stone x2");
    expect(result.content[0].text).not.toContain("oak_log x3");
  });

  it("detects dropped items by entity naming even without getDroppedItem payload", async () => {
    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      entities: {
        1: {
          type: "other",
          objectType: "item_stack",
          name: "item_stack",
          position: { x: 2, y: 64, z: 0 },
          getDroppedItem: () => null,
        },
      },
      findBlocks: vi.fn(),
      blockAt: vi.fn(),
    };

    const harness = createHarness(bot);
    const result = await harness.call("locate_dropped_items", {
      radius: 8,
      max_results: 5,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("item_stack x1");
  });

  it("locates blocks sorted by distance and respects max_results", async () => {
    const blocks = new Map<string, any>([
      ["1,64,0", { name: "oak_log", displayName: "Oak Log", type: 17 }],
      ["3,64,0", { name: "spruce_log", displayName: "Spruce Log", type: 17 }],
      ["5,64,0", { name: "stone", displayName: "Stone", type: 1 }],
    ]);

    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: vi.fn(({ matching }: any) => {
        return [new Vec3(3, 64, 0), new Vec3(1, 64, 0), new Vec3(5, 64, 0)].filter((pos) => {
          const b = blocks.get(`${pos.x},${pos.y},${pos.z}`);
          return matching(b);
        });
      }),
      blockAt: vi.fn((pos: Vec3) => blocks.get(`${pos.x},${pos.y},${pos.z}`) ?? null),
    };

    const harness = createHarness(bot);
    const result = await harness.call("locate_blocks_in_area", {
      query: "*log",
      radius: 16,
      max_results: 1,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Returning 1");
    expect(result.content[0].text).toContain("oak_log @ x=1, y=64, z=0");
    expect(result.content[0].text).not.toContain("spruce_log @ x=3, y=64, z=0");
  });
});
