import { describe, expect, it, vi } from "vitest";
import { createRespawnHandler } from "./respawn.js";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("POST /api/respawn", () => {
  it("returns 503 when bot is not connected", () => {
    const handler = createRespawnHandler(() => null);
    const res = mockRes();

    handler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Bot is not connected yet." });
  });

  it("returns 409 when the bot is still alive", () => {
    const respawn = vi.fn();
    const bot: any = { isAlive: true, respawn };

    const handler = createRespawnHandler(() => bot);
    const res = mockRes();

    handler({} as any, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "Respawn is only allowed after the bot has died.",
    });
    expect(respawn).not.toHaveBeenCalled();
  });

  it("respawns the bot when it has died", () => {
    const respawn = vi.fn();
    const bot: any = { isAlive: false, respawn };

    const handler = createRespawnHandler(() => bot);
    const res = mockRes();

    handler({} as any, res);

    expect(respawn).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ status: "respawned" });
  });
});
