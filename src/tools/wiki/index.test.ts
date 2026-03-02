import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWikiTools } from "./index.js";

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

  registerWikiTools(server, () => bot);

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

describe("wiki tools", () => {
  it("searches blocks by wildcard and id", async () => {
    const bot = {
      registry: {
        blocksByName: {
          oak_log: { id: 17, name: "oak_log", displayName: "Oak Log" },
          spruce_log: { id: 162, name: "spruce_log", displayName: "Spruce Log" },
          stone: { id: 1, name: "stone", displayName: "Stone" },
        },
        itemsByName: {},
      },
    };

    const harness = createHarness(bot);
    const wildcard = await harness.call("search_blocks_wiki", { query: "*log", max_results: 10 });
    const byId = await harness.call("search_blocks_wiki", { query: "1", max_results: 10 });

    expect(wildcard.content[0].text).toContain("oak_log");
    expect(wildcard.content[0].text).toContain("spruce_log");
    expect(byId.content[0].text).toContain("stone (id=1");
  });

  it("searches items by substring", async () => {
    const bot = {
      registry: {
        blocksByName: {},
        itemsByName: {
          iron_pickaxe: { id: 257, name: "iron_pickaxe", displayName: "Iron Pickaxe" },
          diamond_pickaxe: { id: 278, name: "diamond_pickaxe", displayName: "Diamond Pickaxe" },
          bread: { id: 297, name: "bread", displayName: "Bread" },
        },
      },
    };

    const harness = createHarness(bot);
    const result = await harness.call("search_items_wiki", { query: "pickaxe", max_results: 10 });

    expect(result.content[0].text).toContain("iron_pickaxe");
    expect(result.content[0].text).toContain("diamond_pickaxe");
    expect(result.content[0].text).not.toContain("bread");
  });

  it("returns crafting requirements for target amount", async () => {
    const bot = {
      registry: {
        blocksByName: {},
        itemsByName: {
          stick: { id: 280, name: "stick", displayName: "Stick" },
          oak_planks: { id: 5, name: "oak_planks", displayName: "Oak Planks" },
        },
        items: {
          5: { id: 5, name: "oak_planks" },
          280: { id: 280, name: "stick" },
        },
      },
      recipesAll: vi.fn(() => [
        {
          result: { id: 280, metadata: 0, count: 4 },
          ingredients: [{ id: 5, metadata: 0, count: 2 }],
          requiresTable: false,
        },
      ]),
    };

    const harness = createHarness(bot);
    const result = await harness.call("get_crafting_recipe", { item: "stick", amount: 8 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("requires: oak_planks x4");
    expect(result.content[0].text).toContain("crafting_table_required=no");
    expect(result.content[0].text).toContain("crafts_needed=2");
  });
});
