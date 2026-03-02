import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Vec3 } from "vec3";
import { registerVisionTools } from "./index.js";

type RegisteredTool = {
  cb: (args?: Record<string, unknown>, extra?: unknown) => Promise<any>;
};

function createHarness(initialBot: any = null, options: { enableImages?: boolean } = {}) {
  const tools = new Map<string, RegisteredTool>();
  let bot = initialBot;

  const previousEnableImages = process.env.ENABLE_IMAGES;
  if (options.enableImages ?? true) {
    process.env.ENABLE_IMAGES = "true";
  } else {
    delete process.env.ENABLE_IMAGES;
  }

  const server = {
    registerTool(name: string, _config: unknown, cb: RegisteredTool["cb"]) {
      tools.set(name, { cb });
      return {} as any;
    },
  } as unknown as McpServer;

  registerVisionTools(server, () => bot);

  if (previousEnableImages === undefined) {
    delete process.env.ENABLE_IMAGES;
  } else {
    process.env.ENABLE_IMAGES = previousEnableImages;
  }

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
  it("does not register capture tool unless ENABLE_IMAGES is set", async () => {
    const harness = createHarness(null, { enableImages: false });

    await expect(
      harness.call("capture_bot_view", {
        width: 800,
        height: 400,
        view_distance: 6,
        quality: 0.9,
        look_at_x: 0,
        look_at_y: 64,
        look_at_z: 0,
      })
    ).rejects.toThrow("Tool not registered");
  });

  it("returns an error for screenshot capture when bot is not connected", async () => {
    const harness = createHarness(null);
    const result = await harness.call("capture_bot_view", {
      width: 800,
      height: 400,
      view_distance: 6,
      quality: 0.9,
      look_at_x: 0,
      look_at_y: 64,
      look_at_z: 0,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not connected");
  });

  it("returns biome info for current position", async () => {
    const bot = {
      entity: { position: { x: 10, y: 64, z: -3 } },
      blockAt: vi.fn(() => ({ biome: { name: "plains", id: 1 } })),
      findBlocks: vi.fn(),
      entities: {},
      time: { timeOfDay: 0, isDay: true, doDaylightCycle: true, day: 0 },
    };

    const harness = createHarness(bot);
    const result = await harness.call("get_biome_info");

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("name=plains");
    expect(result.content[0].text).toContain("display_name=plains");
    expect(result.content[0].text).toContain("id=1");
  });

  it("falls back to minecraft-data when biome name is missing", async () => {
    const bot = {
      version: "1.21.4",
      entity: { position: { x: -140, y: 71, z: -506 } },
      blockAt: vi.fn(() => ({ biome: { name: "", id: 40 } })),
      findBlocks: vi.fn(),
      entities: {},
      time: { timeOfDay: 0, isDay: true, doDaylightCycle: true, day: 0 },
    };

    const harness = createHarness(bot);
    const result = await harness.call("get_biome_info", { x: -140, y: 71, z: -506 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("name=plains");
    expect(result.content[0].text).toContain("display_name=Plains");
    expect(result.content[0].text).toContain("id=40");
  });

  it("returns daytime info with ticks until sleep", async () => {
    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: vi.fn(),
      findBlocks: vi.fn(),
      entities: {},
      time: { timeOfDay: 6000, isDay: true, doDaylightCycle: true, day: 5 },
    };

    const harness = createHarness(bot);
    const result = await harness.call("get_daytime_info");

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("time_of_day=6000");
    expect(result.content[0].text).toContain("can_sleep_now=false");
    expect(result.content[0].text).toContain("ticks_until_sleep=6542");
  });

  it("sleeps in nearest bed with timeout guard", async () => {
    const bed = { type: 26, name: "red_bed", position: { x: 1, y: 64, z: 0 } };
    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      registry: { blocksByName: { red_bed: { id: 26 } } },
      blockAt: vi.fn(() => bed),
      findBlocks: vi.fn(),
      findBlock: vi.fn(() => bed),
      entities: {},
      time: { timeOfDay: 13000, isDay: false, doDaylightCycle: true, day: 5 },
      isABed: vi.fn(() => true),
      sleep: vi.fn(async () => {}),
    };

    const harness = createHarness(bot);
    const result = await harness.call("sleep_in_bed", {
      max_distance: 6,
      timeout_ms: 5000,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("now sleeping");
    expect(bot.sleep).toHaveBeenCalledWith(bed);
  });

  it("returns timeout error when sleeping hangs", async () => {
    vi.useFakeTimers();

    try {
      const bed = { type: 26, name: "red_bed", position: { x: 1, y: 64, z: 0 } };
      const bot = {
        entity: { position: { x: 0, y: 64, z: 0 } },
        registry: { blocksByName: { red_bed: { id: 26 } } },
        blockAt: vi.fn(() => bed),
        findBlocks: vi.fn(),
        findBlock: vi.fn(() => bed),
        entities: {},
        time: { timeOfDay: 13000, isDay: false, doDaylightCycle: true, day: 5 },
        isABed: vi.fn(() => true),
        sleep: vi.fn(
          () =>
            new Promise<void>(() => {
              // never resolves
            })
        ),
      };

      const harness = createHarness(bot);
      const promise = harness.call("sleep_in_bed", {
        max_distance: 6,
        timeout_ms: 1000,
      });

      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns clear error when bed is occupied", async () => {
    const bed = { type: 26, name: "red_bed", position: { x: 1, y: 64, z: 0 } };
    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      registry: { blocksByName: { red_bed: { id: 26 } } },
      blockAt: vi.fn(() => bed),
      findBlocks: vi.fn(),
      findBlock: vi.fn(() => bed),
      entities: {},
      time: { timeOfDay: 13000, isDay: false, doDaylightCycle: true, day: 5 },
      isABed: vi.fn(() => true),
      sleep: vi.fn(async () => {
        throw new Error("Bed is occupied");
      }),
    };

    const harness = createHarness(bot);
    const result = await harness.call("sleep_in_bed", {
      max_distance: 6,
      timeout_ms: 5000,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Bed is occupied");
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

  it("supports OR queries with commas for block names", async () => {
    const blocks = new Map<string, any>([
      ["-1,64,0", { name: "gold_ore", displayName: "Gold Ore", type: 42 }],
      ["-2,64,0", { name: "deepslate_gold_ore", displayName: "Deepslate Gold Ore", type: 43 }],
      ["-3,64,0", { name: "iron_ore", displayName: "Iron Ore", type: 41 }],
    ]);

    const bot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      findBlocks: vi.fn(({ matching }: any) => {
        return [new Vec3(-1, 64, 0), new Vec3(-2, 64, 0), new Vec3(-3, 64, 0)].filter((pos) => {
          const b = blocks.get(`${pos.x},${pos.y},${pos.z}`);
          return matching(b);
        });
      }),
      blockAt: vi.fn((pos: Vec3) => blocks.get(`${pos.x},${pos.y},${pos.z}`) ?? null),
    };

    const harness = createHarness(bot);
    const result = await harness.call("locate_blocks_in_area", {
      query: "gold_ore,deepslate_gold_ore",
      radius: 16,
      max_results: 5,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("gold_ore");
    expect(result.content[0].text).toContain("deepslate_gold_ore");
    expect(result.content[0].text).not.toContain("iron_ore");
  });
});
