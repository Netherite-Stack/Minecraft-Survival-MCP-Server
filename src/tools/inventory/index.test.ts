import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInventoryTools } from "./index.js";

type RegisteredTool = {
  cb: (args?: Record<string, unknown>, extra?: unknown) => Promise<any>;
};

type Item = {
  name: string;
  displayName?: string;
  type: number;
  metadata?: number;
  count: number;
};

function createBot(options: {
  items?: Item[];
  slots?: Array<Item | null>;
  inventoryStart?: number;
  inventoryEnd?: number;
  findBlockResult?: any;
  chest?: any;
} = {}) {
  const items = options.items ?? [];
  const slots = options.slots ?? [];

  return {
    registry: {
      blocksByName: {
        chest: { id: 54, name: "chest" },
        trapped_chest: { id: 146, name: "trapped_chest" },
      },
      items: {
        1: { id: 1, name: "stone" },
        17: { id: 17, name: "oak_log" },
        260: { id: 260, name: "apple" },
      },
    },
    inventory: {
      items: vi.fn(() => items),
      slots,
      inventoryStart: options.inventoryStart ?? 0,
      inventoryEnd: options.inventoryEnd ?? Math.max(0, slots.length - 1),
    },
    toss: vi.fn(async () => {}),
    findBlock: vi.fn(() => options.findBlockResult ?? null),
    openChest: vi.fn(async () =>
      options.chest ?? {
        deposit: vi.fn(async () => {}),
        withdraw: vi.fn(async () => {}),
        containerItems: vi.fn(() => []),
        close: vi.fn(),
        inventoryStart: 27,
        slots: Array.from({ length: 27 }, () => null),
      }
    ),
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

  registerInventoryTools(server, () => bot);

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
  };
}

describe("inventory tools", () => {
  it("returns inventory contents", async () => {
    const bot = createBot({
      items: [
        { name: "oak_log", type: 17, count: 12 },
        { name: "stone", type: 1, count: 64 },
      ],
    });
    const harness = createHarness(bot);

    const result = await harness.call("get_inventory_contents");

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("2 stack(s), 76 item(s)");
    expect(result.content[0].text).toContain("oak_log x12");
    expect(result.content[0].text).toContain("stone x64");
  });

  it("returns inventory slot status", async () => {
    const item = { name: "stone", type: 1, count: 64 };
    const bot = createBot({
      slots: [item, null, null, item],
      inventoryStart: 0,
      inventoryEnd: 3,
    });
    const harness = createHarness(bot);

    const result = await harness.call("get_inventory_status");

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("used=2");
    expect(result.content[0].text).toContain("free=2");
    expect(result.content[0].text).toContain("total=4");
  });

  it("returns clear error when drop item is missing", async () => {
    const bot = createBot({
      items: [{ name: "stone", type: 1, count: 64 }],
    });
    const harness = createHarness(bot);

    const result = await harness.call("drop_inventory_item", {
      query: "gold_ore",
      count: 2,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("item not found in inventory");
  });

  it("returns clear error when drop count exceeds available", async () => {
    const bot = createBot({
      items: [{ name: "gold_ore", type: 42, count: 3 }],
    });
    const harness = createHarness(bot);

    const result = await harness.call("drop_inventory_item", {
      query: "gold_ore",
      count: 5,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only 3 available");
  });

  it("drops requested count across multiple matching stacks", async () => {
    const bot = createBot({
      items: [
        { name: "apple", type: 260, metadata: 0, count: 3 },
        { name: "apple", type: 260, metadata: 0, count: 2 },
      ],
    });
    const harness = createHarness(bot);

    const result = await harness.call("drop_inventory_item", {
      query: "apple",
      count: 4,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Dropped 4");
    expect(bot.toss).toHaveBeenCalledTimes(2);
    expect(bot.toss).toHaveBeenNthCalledWith(1, 260, 0, 3);
    expect(bot.toss).toHaveBeenNthCalledWith(2, 260, 0, 1);
  });

  it("puts inventory items into nearby chest", async () => {
    const chest = {
      deposit: vi.fn(async () => {}),
      withdraw: vi.fn(async () => {}),
      containerItems: vi.fn(() => []),
      close: vi.fn(),
      inventoryStart: 27,
      slots: Array.from({ length: 27 }, () => null),
    };

    const bot = createBot({
      items: [{ name: "stone", type: 1, count: 10 }],
      findBlockResult: { type: 54, name: "chest" },
      chest,
    });
    const harness = createHarness(bot);

    const result = await harness.call("put_item_in_chest", {
      query: "stone",
      count: 4,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Put 4");
    expect(chest.deposit).toHaveBeenCalledWith(1, null, 4);
    expect(chest.close).toHaveBeenCalled();
  });

  it("returns chest contents and status", async () => {
    const chest = {
      deposit: vi.fn(async () => {}),
      withdraw: vi.fn(async () => {}),
      containerItems: vi.fn(() => [
        { type: 1, count: 32, name: "stone" },
        { type: 17, count: 8, name: "oak_log" },
      ]),
      close: vi.fn(),
      inventoryStart: 4,
      slots: [{ type: 1 }, null, { type: 17 }, null],
    };

    const bot = createBot({
      findBlockResult: { type: 54, name: "chest" },
      chest,
    });
    const harness = createHarness(bot);

    const contents = await harness.call("get_chest_contents");
    expect(contents.isError).toBeUndefined();
    expect(contents.content[0].text).toContain("stone x32");
    expect(contents.content[0].text).toContain("oak_log x8");

    const status = await harness.call("get_chest_status");
    expect(status.isError).toBeUndefined();
    expect(status.content[0].text).toContain("used=2");
    expect(status.content[0].text).toContain("free=2");
    expect(status.content[0].text).toContain("total=4");
  });

  it("takes items from nearby chest", async () => {
    const chest = {
      deposit: vi.fn(async () => {}),
      withdraw: vi.fn(async () => {}),
      containerItems: vi.fn(() => [{ type: 1, count: 10, name: "stone" }]),
      close: vi.fn(),
      inventoryStart: 27,
      slots: Array.from({ length: 27 }, () => null),
    };

    const bot = createBot({
      findBlockResult: { type: 54, name: "chest" },
      chest,
    });
    const harness = createHarness(bot);

    const result = await harness.call("take_item_from_chest", {
      query: "stone",
      count: 4,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Took 4");
    expect(chest.withdraw).toHaveBeenCalledWith(1, null, 4);
    expect(chest.close).toHaveBeenCalled();
  });

  it("returns clear error when chest item amount is too low", async () => {
    const chest = {
      deposit: vi.fn(async () => {}),
      withdraw: vi.fn(async () => {}),
      containerItems: vi.fn(() => [{ type: 1, count: 2, name: "stone" }]),
      close: vi.fn(),
      inventoryStart: 27,
      slots: Array.from({ length: 27 }, () => null),
    };

    const bot = createBot({
      findBlockResult: { type: 54, name: "chest" },
      chest,
    });
    const harness = createHarness(bot);

    const result = await harness.call("take_item_from_chest", {
      query: "stone",
      count: 5,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only 2 available");
  });
});
