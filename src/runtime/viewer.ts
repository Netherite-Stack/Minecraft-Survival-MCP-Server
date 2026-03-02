import type mineflayer from "mineflayer";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { LoggerLike } from "../observability/logger.js";

type ViewerModule = {
  mineflayer?: unknown;
  viewer?: {
    mineflayer?: unknown;
  };
};

type HudState = {
  health: number;
  food: number;
  selected_slot: number;
  held_item: string;
  open_window: string | null;
};

const require = createRequire(import.meta.url);

function isTruthyEnv(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getSlotName(bot: mineflayer.Bot, slot: any) {
  if (!slot) {
    return null;
  }

  const byId = (bot.registry as any)?.items?.[slot.type] as { name?: string } | undefined;
  return slot.name ?? byId?.name ?? `item_${slot.type}`;
}

function toDisplayItemName(raw: string) {
  return raw
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildHudState(bot: mineflayer.Bot): HudState {
  const inventory = bot.inventory as unknown as {
    slots?: Array<any | null>;
    hotbarStart?: number;
  };

  const slots = inventory.slots ?? [];
  const hotbarStart = typeof inventory.hotbarStart === "number" ? inventory.hotbarStart : 36;
  const selectedSlot = clamp(bot.quickBarSlot ?? 0, 0, 8);

  const selectedSlotItem = slots[hotbarStart + selectedSlot] ?? null;
  const selectedItemName = getSlotName(bot, selectedSlotItem);
  const heldItemName = bot.heldItem?.displayName ?? bot.heldItem?.name ?? selectedItemName ?? "empty";

  return {
    health: clamp(Math.round((bot.health ?? 20) * 2) / 2, 0, 20),
    food: clamp(Math.round((bot.food ?? 20) * 2) / 2, 0, 20),
    selected_slot: selectedSlot,
    held_item: heldItemName === "empty" ? "Empty" : toDisplayItemName(String(heldItemName)),
    open_window: (bot.currentWindow as any)?.type ?? null,
  };
}

function renderViewerHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Bot Viewer</title>
    <style>
      html, body { height: 100%; margin: 0; overflow: hidden; background: #090b10; color: #fff; font-family: monospace; }
      #stats { position: fixed; left: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
      .badge { background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 6px 8px; font-size: 12px; }
      #hearts { color: #ff5d73; letter-spacing: 1px; }
    </style>
  </head>
  <body>
    <div id="stats">
      <div id="hearts" class="badge">Hearts: ?</div>
      <div id="held" class="badge">Hand: ?</div>
    </div>

    <script src="/index.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      const socket = io({ path: '/socket.io' });
      const heartsEl = document.getElementById('hearts');
      const heldEl = document.getElementById('held');

      function hearts(health) {
        const full = Math.floor(health / 2);
        const half = health % 2 === 0 ? 0 : 1;
        const empty = Math.max(0, 10 - full - half);
        return '❤'.repeat(full) + (half ? '♡' : '') + '·'.repeat(empty);
      }

      socket.on('hud', (hud) => {
        heartsEl.textContent = 'Hearts: ' + hearts(hud.health);
        heldEl.textContent = 'Hand: ' + hud.held_item;
      });
    </script>
  </body>
</html>`;
}

export function startViewerIfEnabled(
  bot: mineflayer.Bot,
  _viewerModule: ViewerModule,
  env: NodeJS.ProcessEnv,
  logger: LoggerLike
) {
  if (!isTruthyEnv(env.ENABLE_VIEWER)) {
    return false;
  }

  const viewerPort = parseInt(env.VIEWER_PORT || "3000", 10);
  const botAny = bot as any;

  try {
    const express = require("express");
    const http = require("node:http");
    const socketio = require("socket.io");
    const { WorldView } = require("prismarine-viewer/viewer");
    const { setupRoutes } = require("prismarine-viewer/lib/common");

    const app = express();
    const server = http.createServer(app);
    const io = socketio(server, { path: "/socket.io" });

    app.get("/", (_req: any, res: any) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.send(renderViewerHtml());
    });

    setupRoutes(app, "");

    const sockets: any[] = [];
    const primitives: Record<string, unknown> = {};

    const viewerBus = new EventEmitter();
    (bot as any).viewer = viewerBus;

    (bot as any).viewer.erase = (id: string) => {
      delete primitives[id];
      for (const socket of sockets) {
        socket.emit("primitive", { id });
      }
    };

    (bot as any).viewer.drawBoxGrid = (id: string, start: unknown, end: unknown, color = "aqua") => {
      primitives[id] = { type: "boxgrid", id, start, end, color };
      for (const socket of sockets) {
        socket.emit("primitive", primitives[id]);
      }
    };

    (bot as any).viewer.drawLine = (id: string, points: unknown, color = 0xff0000) => {
      primitives[id] = { type: "line", id, points, color };
      for (const socket of sockets) {
        socket.emit("primitive", primitives[id]);
      }
    };

    (bot as any).viewer.drawPoints = (
      id: string,
      points: unknown,
      color = 0xff0000,
      size = 5
    ) => {
      primitives[id] = { type: "points", id, points, color, size };
      for (const socket of sockets) {
        socket.emit("primitive", primitives[id]);
      }
    };

    function broadcastHud() {
      const hud = buildHudState(bot);
      for (const socket of sockets) {
        socket.emit("hud", hud);
      }
    }

    io.on("connection", (socket: any) => {
      socket.emit("version", bot.version);
      sockets.push(socket);

      const worldView = new WorldView(bot.world, 6, bot.entity.position, socket);
      worldView.init(bot.entity.position);

      worldView.on("blockClicked", (block: unknown, face: unknown, button: unknown) => {
        (bot as any).viewer.emit("blockClicked", block, face, button);
      });

      for (const id in primitives) {
        socket.emit("primitive", primitives[id]);
      }

      function botPosition() {
        socket.emit("position", {
          pos: bot.entity.position,
          yaw: bot.entity.yaw,
          pitch: bot.entity.pitch,
          addMesh: true,
        });
        worldView.updatePosition(bot.entity.position);
      }

      function onHudUpdate() {
        socket.emit("hud", buildHudState(bot));
      }

      bot.on("move", botPosition);
      bot.on("health", onHudUpdate);
      botAny.on("heldItemChanged", onHudUpdate);
      botAny.on("windowOpen", onHudUpdate);
      botAny.on("windowClose", onHudUpdate);
      worldView.listenToBot(bot);

      botPosition();
      onHudUpdate();

      socket.on("disconnect", () => {
        bot.removeListener("move", botPosition);
        bot.removeListener("health", onHudUpdate);
        botAny.removeListener("heldItemChanged", onHudUpdate);
        botAny.removeListener("windowOpen", onHudUpdate);
        botAny.removeListener("windowClose", onHudUpdate);
        worldView.removeListenersFromBot(bot);
        sockets.splice(sockets.indexOf(socket), 1);
      });
    });

    bot.on("spawn", broadcastHud);

    server.listen(viewerPort, () => {
      logger.info({ port: viewerPort }, "viewer.started");
    });

    (bot as any).viewer.close = () => {
      server.close();
      for (const socket of sockets) {
        socket.disconnect();
      }
    };

    return true;
  } catch (error: unknown) {
    logger.error({ err: error, port: viewerPort }, "viewer.start_failed");
    return false;
  }
}
