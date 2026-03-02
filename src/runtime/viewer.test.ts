import { describe, expect, it, vi } from "vitest";
import { buildHudState, startViewerIfEnabled } from "./viewer.js";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("viewer runtime", () => {
  it("does not start viewer when ENABLE_VIEWER is disabled", () => {
    const logger = createLogger();

    const started = startViewerIfEnabled(
      {} as any,
      {},
      { ENABLE_VIEWER: "false", VIEWER_PORT: "8080" },
      logger
    );

    expect(started).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("builds HUD state with hotbar and hearts info", () => {
    const bot = {
      health: 17,
      food: 14,
      quickBarSlot: 2,
      heldItem: { name: "netherite_pickaxe" },
      currentWindow: { type: "minecraft:chest" },
      inventory: {
        hotbarStart: 0,
        slots: [
          { type: 1, name: "stone", count: 32 },
          { type: 5, name: "oak_planks", count: 16 },
          { type: 260, name: "apple", count: 3 },
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      },
      registry: {
        items: {
          1: { id: 1, name: "stone" },
          5: { id: 5, name: "oak_planks" },
          260: { id: 260, name: "apple" },
        },
      },
    } as any;

    const hud = buildHudState(bot);

    expect(hud.health).toBe(17);
    expect(hud.food).toBe(14);
    expect(hud.selected_slot).toBe(2);
    expect(hud.held_item).toBe("Netherite Pickaxe");
    expect(hud.open_window).toBe("minecraft:chest");
  });
});
