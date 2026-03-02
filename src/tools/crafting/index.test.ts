import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCraftingTools } from "./index.js";

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

  registerCraftingTools(server, () => bot);

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

function createBot(overrides: Partial<any> = {}) {
  const defaultFurnaceBlock = { type: 61, name: "furnace", position: { x: 1, y: 64, z: 0 } };

  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    registry: {
      itemsByName: {
        stick: { id: 280, name: "stick", displayName: "Stick" },
        oak_planks: { id: 5, name: "oak_planks", displayName: "Oak Planks" },
        iron_ore: { id: 15, name: "iron_ore", displayName: "Iron Ore" },
        coal: { id: 263, name: "coal", displayName: "Coal" },
        crafting_table: { id: 58, name: "crafting_table", displayName: "Crafting Table" },
      },
      blocksByName: {
        crafting_table: { id: 58, name: "crafting_table" },
        furnace: { id: 61, name: "furnace" },
      },
      items: {
        5: { id: 5, name: "oak_planks" },
        15: { id: 15, name: "iron_ore" },
        263: { id: 263, name: "coal" },
        280: { id: 280, name: "stick" },
      },
    },
    inventory: {
      items: vi.fn(() => []),
    },
    findBlock: vi.fn(() => null),
    findBlocks: vi.fn(() => []),
    blockAt: vi.fn((pos: { x: number; y: number; z: number }) => ({ ...defaultFurnaceBlock, position: pos })),
    recipesFor: vi.fn(() => []),
    recipesAll: vi.fn(() => []),
    craft: vi.fn(async () => {}),
    openFurnace: vi.fn(async () => ({
      putInput: vi.fn(async () => {}),
      putFuel: vi.fn(async () => {}),
      outputItem: vi.fn(() => null),
      takeOutput: vi.fn(async () => ({ count: 0 })),
      close: vi.fn(),
    })),
    ...overrides,
  };
}

describe("crafting tools", () => {
  it("crafts item in inventory when recipe is available", async () => {
    const recipe = {
      result: { id: 280, metadata: 0, count: 4 },
      ingredients: [{ id: 5, metadata: 0, count: 2 }],
      requiresTable: false,
    };

    const bot = createBot({
      inventory: {
        items: vi.fn(() => [{ type: 5, count: 4 }]),
      },
      recipesFor: vi.fn(() => [recipe]),
    });

    const harness = createHarness(bot);
    const result = await harness.call("craft_item", { item: "stick", amount: 8 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Crafted stick x8");
    expect(bot.craft).toHaveBeenCalledTimes(1);
    expect(bot.craft).toHaveBeenCalledWith(recipe, 2, undefined);
  });

  it("returns table and missing resources error when both are needed", async () => {
    const tableRecipe = {
      result: { id: 280, metadata: 0, count: 4 },
      ingredients: [{ id: 5, metadata: 0, count: 2 }],
      requiresTable: true,
    };

    const bot = createBot({
      inventory: {
        items: vi.fn(() => [{ type: 5, count: 1 }]),
      },
      recipesAll: vi.fn((_itemId: number, _meta: number | null, table: unknown) => {
        if (table === true) {
          return [tableRecipe];
        }
        return [];
      }),
    });

    const harness = createHarness(bot);
    const result = await harness.call("craft_item", { item: "stick", amount: 8 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no crafting table in reach");
    expect(result.content[0].text).toContain("oak_planks x3");
  });

  it("returns only crafting table error when resources are sufficient", async () => {
    const tableRecipe = {
      result: { id: 280, metadata: 0, count: 4 },
      ingredients: [{ id: 5, metadata: 0, count: 2 }],
      requiresTable: true,
    };

    const bot = createBot({
      inventory: {
        items: vi.fn(() => [{ type: 5, count: 4 }]),
      },
      recipesAll: vi.fn((_itemId: number, _meta: number | null, table: unknown) => {
        if (table === true) {
          return [tableRecipe];
        }
        return [];
      }),
    });

    const harness = createHarness(bot);
    const result = await harness.call("craft_item", { item: "stick", amount: 8 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("crafting table in reach is required");
  });

  it("returns missing resources error when table is available", async () => {
    const tableRecipe = {
      result: { id: 280, metadata: 0, count: 4 },
      ingredients: [{ id: 5, metadata: 0, count: 2 }],
      requiresTable: true,
    };

    const bot = createBot({
      inventory: {
        items: vi.fn(() => [{ type: 5, count: 1 }]),
      },
      findBlock: vi.fn(() => ({ type: 58, name: "crafting_table" })),
      recipesAll: vi.fn(() => [tableRecipe]),
    });

    const harness = createHarness(bot);
    const result = await harness.call("craft_item", { item: "stick", amount: 8 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing resources");
    expect(result.content[0].text).toContain("oak_planks x3");
  });

  it("returns actionable smelting error for missing furnace/resources/fuel", async () => {
    const bot = createBot({
      inventory: {
        items: vi.fn(() => [{ type: 15, name: "iron_ore", count: 1 }]),
      },
      findBlocks: vi.fn(() => []),
    });

    const harness = createHarness(bot);
    const result = await harness.call("smelt_item", {
      item: "iron_ore",
      amount: 3,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no furnace in reach");
    expect(result.content[0].text).toContain("iron_ore x2");
    expect(result.content[0].text).toContain("missing usable fuel");
  });

  it("smelts items when furnace and fuel are available", async () => {
    const furnace = {
      progress: 0,
      inputItem: vi.fn(() => null),
      putInput: vi.fn(async () => {}),
      putFuel: vi.fn(async () => {}),
      outputItem: vi
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ count: 1 }),
      takeOutput: vi.fn(async () => ({ count: 1 })),
      close: vi.fn(),
    };

    const bot = createBot({
      inventory: {
        items: vi.fn(() => [
          { type: 15, name: "iron_ore", count: 2 },
          { type: 263, name: "coal", count: 1 },
        ]),
      },
      findBlocks: vi.fn(() => [{ x: 1, y: 64, z: 0 }]),
      blockAt: vi.fn(() => ({ type: 61, name: "furnace", position: { x: 1, y: 64, z: 0 } })),
      openFurnace: vi.fn(async () => furnace),
    });

    const harness = createHarness(bot);
    const result = await harness.call("smelt_item", {
      item: "iron_ore",
      amount: 2,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Smelted output");
    expect(furnace.putInput).toHaveBeenCalledWith(15, null, 2);
    expect(furnace.putFuel).toHaveBeenCalledWith(263, null, 1);
    expect(furnace.close).toHaveBeenCalled();
  });

  it("returns use-another-furnace message when all nearby furnaces are busy", async () => {
    const busyFurnace = {
      progress: 0.5,
      inputItem: vi.fn(() => ({ type: 15, count: 1 })),
      outputItem: vi.fn(() => null),
      close: vi.fn(),
    };

    const bot = createBot({
      inventory: {
        items: vi.fn(() => [
          { type: 15, name: "iron_ore", count: 2 },
          { type: 263, name: "coal", count: 1 },
        ]),
      },
      findBlocks: vi.fn(() => [{ x: 1, y: 64, z: 0 }]),
      blockAt: vi.fn(() => ({ type: 61, name: "furnace", position: { x: 1, y: 64, z: 0 } })),
      openFurnace: vi.fn(async () => busyFurnace),
    });

    const harness = createHarness(bot);
    const result = await harness.call("smelt_item", {
      item: "iron_ore",
      amount: 2,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Use another furnace");
  });
});
