import type { Request, Response } from "express";
import type mineflayer from "mineflayer";
import { serializeItem } from "./item.js";

type InventoryItem = {
  type: number;
  name?: string;
  count: number;
  slot: number;
};

export function createInventoryHandler(getBot: () => mineflayer.Bot | null) {
  return (_req: Request, res: Response) => {
    const bot = getBot();

    if (!bot) {
      res.status(503).json({ error: "Bot is not connected yet." });
      return;
    }

    const items = (bot.inventory.items() as InventoryItem[]).map((item) => ({
      slot: item.slot,
      ...serializeItem(item),
    }));

    res.json({ items });
  };
}
