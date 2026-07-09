import { describe, expect, it, vi } from "vitest";
import { createStatusHandler } from "./status.js";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("GET /api/status", () => {
  it("returns 503 when bot is not connected", () => {
    const handler = createStatusHandler(() => null);
    const res = mockRes();

    handler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Bot is not connected yet." });
  });

  it("returns username, health, hunger, position, and armor", () => {
    const bot: any = {
      username: "MCP-Bot",
      health: 18,
      food: 15,
      entity: { position: { x: 1, y: 64, z: -2 } },
      inventory: {
        slots: {
          5: { type: 100, name: "diamond_helmet", count: 1 },
          6: null,
          7: null,
          8: { type: 200, name: "iron_boots", count: 1 },
        },
      },
    };

    const handler = createStatusHandler(() => bot);
    const res = mockRes();

    handler({} as any, res);

    expect(res.json).toHaveBeenCalledWith({
      username: "MCP-Bot",
      health: 18,
      hunger: 15,
      position: { x: 1, y: 64, z: -2 },
      armor: {
        helmet: { id: 100, name: "diamond_helmet", count: 1 },
        chestplate: null,
        leggings: null,
        boots: { id: 200, name: "iron_boots", count: 1 },
      },
    });
  });
});
