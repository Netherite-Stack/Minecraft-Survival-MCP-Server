import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("mineflayer-pathfinder", () => {
  class MockMovements {
    canDig = true;
    allow1by1towers = true;
    scafoldingBlocks = [1];

    constructor(public readonly bot: unknown) {}
  }

  class GoalBlock {
    constructor(
      public readonly x: number,
      public readonly y: number,
      public readonly z: number
    ) {}
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
      goals: { GoalBlock, GoalNear },
    },
    Movements: MockMovements,
    goals: { GoalBlock, GoalNear },
  };
});

import { registerMovementTools } from "./index.js";

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

  registerMovementTools(server, () => bot);

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

function createBot(overrides: Partial<any> = {}) {
  return {
    username: "MCP-Bot",
    entity: { position: { x: 0, y: 64, z: 0 } },
    players: {},
    pathfinder: {
      setGoal: vi.fn(),
      setMovements: vi.fn(),
      goto: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe("movement tools", () => {
  it("returns own position coordinates", async () => {
    const bot = createBot({
      entity: { position: { x: 12.345, y: 70, z: -4.5 } },
    });
    const harness = createHarness(bot);

    const result = await harness.call("get_own_position");

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("x=12.35, y=70.00, z=-4.50");
  });

  it("returns an error when bot is not connected", async () => {
    const harness = createHarness(null);

    const result = await harness.call("move_to_coordinates", {
      x: 1,
      y: 64,
      z: 1,
      timeout_ms: 5000,
      allow_block_breaking: true,
      allow_block_placement: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not connected");
  });

  it("moves to coordinates and configures movement flags", async () => {
    const bot = createBot();
    const harness = createHarness(bot);

    const result = await harness.call("move_to_coordinates", {
      x: 10.8,
      y: 65.2,
      z: -2.9,
      timeout_ms: 5000,
      allow_block_breaking: false,
      allow_block_placement: false,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Reached target coordinates");
    expect(bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
    expect(bot.pathfinder.setMovements).toHaveBeenCalledTimes(1);

    const movement = bot.pathfinder.setMovements.mock.calls[0][0];
    expect(movement.canDig).toBe(false);
    expect(movement.allow1by1towers).toBe(false);
    expect(movement.scafoldingBlocks).toEqual([]);
  });

  it("returns pathfinder failures with readable error text", async () => {
    const bot = createBot({
      pathfinder: {
        setGoal: vi.fn(),
        setMovements: vi.fn(),
        goto: vi.fn().mockRejectedValue(new Error("no path")),
      },
    });

    const harness = createHarness(bot);
    const result = await harness.call("move_to_coordinates", {
      x: 1,
      y: 64,
      z: 1,
      timeout_ms: 5000,
      allow_block_breaking: true,
      allow_block_placement: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no path");
  });

  it("moves to player and validates player visibility", async () => {
    const bot = createBot({
      players: {
        Steve: {
          username: "Steve",
          entity: { position: { x: 5, y: 64, z: 5 } },
        },
      },
    });

    const harness = createHarness(bot);
    const ok = await harness.call("move_to_player", {
      username: "steve",
      range: 2,
      timeout_ms: 5000,
      allow_block_breaking: true,
      allow_block_placement: true,
    });

    expect(ok.isError).toBeUndefined();
    expect(ok.content[0].text).toContain("Reached Steve within 2 block(s)");

    const missing = await harness.call("move_to_player", {
      username: "Alex",
      range: 1,
      timeout_ms: 5000,
      allow_block_breaking: true,
      allow_block_placement: true,
    });

    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("Player not found");

    harness.setBot(
      createBot({
        players: {
          Ghost: {
            username: "Ghost",
            entity: undefined,
          },
        },
      })
    );

    const invisible = await harness.call("move_to_player", {
      username: "Ghost",
      range: 1,
      timeout_ms: 5000,
      allow_block_breaking: true,
      allow_block_placement: true,
    });

    expect(invisible.isError).toBe(true);
    expect(invisible.content[0].text).toContain("not visible");
  });

  it("times out movement and stops current goal", async () => {
    vi.useFakeTimers();

    try {
      const pendingGoto = vi.fn(
        () =>
          new Promise<void>(() => {
            // intentionally never resolve
          })
      );

      const bot = createBot({
        pathfinder: {
          setGoal: vi.fn(),
          setMovements: vi.fn(),
          goto: pendingGoto,
        },
      });

      const harness = createHarness(bot);
      const promise = harness.call("move_to_coordinates", {
        x: 0,
        y: 64,
        z: 0,
        timeout_ms: 1000,
        allow_block_breaking: true,
        allow_block_placement: true,
      });

      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No movement progress");
      expect(bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });
});
