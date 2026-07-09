import type { Express } from "express";
import type mineflayer from "mineflayer";
import { createStatusHandler } from "./status.js";
import { createInventoryHandler } from "./inventory.js";
import { createRespawnHandler } from "./respawn.js";

export function registerRestRoutes(app: Express, getBot: () => mineflayer.Bot | null) {
  app.get("/api/status", createStatusHandler(getBot));
  app.get("/api/inventory", createInventoryHandler(getBot));
  app.post("/api/respawn", createRespawnHandler(getBot));
}
