import type { Request, Response } from "express";
import type mineflayer from "mineflayer";
import { serializeItem } from "./item.js";

const ARMOR_SLOTS = {
  helmet: 5,
  chestplate: 6,
  leggings: 7,
  boots: 8,
} as const;

export function createStatusHandler(getBot: () => mineflayer.Bot | null) {
  return (_req: Request, res: Response) => {
    const bot = getBot();

    if (!bot || !bot.entity) {
      res.status(503).json({ error: "Bot is not connected yet." });
      return;
    }

    const { x, y, z } = bot.entity.position;
    const armor = Object.fromEntries(
      Object.entries(ARMOR_SLOTS).map(([slot, index]) => [
        slot,
        serializeItem(bot.inventory.slots[index]),
      ])
    );

    res.json({
      username: bot.username,
      health: bot.health,
      hunger: bot.food,
      position: { x, y, z },
      armor,
    });
  };
}
