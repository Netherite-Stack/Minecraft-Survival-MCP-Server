import { describe, expect, it, vi } from "vitest";
import { createInventoryHandler } from "./inventory.js";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("GET /api/inventory", () => {
  it("returns 503 when bot is not connected", () => {
    const handler = createInventoryHandler(() => null);
    const res = mockRes();

    handler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Bot is not connected yet." });
  });

  it("returns items with minecraft id and name", () => {
    const bot: any = {
      inventory: {
        items: () => [
          { slot: 9, type: 264, name: "diamond", count: 3 },
          { slot: 10, type: 322, name: "golden_apple", count: 1 },
        ],
      },
    };

    const handler = createInventoryHandler(() => bot);
    const res = mockRes();

    handler({} as any, res);

    expect(res.json).toHaveBeenCalledWith({
      items: [
        { slot: 9, id: 264, name: "diamond", count: 3 },
        { slot: 10, id: 322, name: "golden_apple", count: 1 },
      ],
    });
  });
});
