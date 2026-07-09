import type { Request, Response } from "express";
import type mineflayer from "mineflayer";

export function createRespawnHandler(getBot: () => mineflayer.Bot | null) {
  return (_req: Request, res: Response) => {
    const bot = getBot();

    if (!bot) {
      res.status(503).json({ error: "Bot is not connected yet." });
      return;
    }

    const isAlive = (bot as unknown as { isAlive: boolean }).isAlive;

    if (isAlive) {
      res.status(409).json({ error: "Respawn is only allowed after the bot has died." });
      return;
    }

    bot.respawn();
    res.json({ status: "respawned" });
  };
}
