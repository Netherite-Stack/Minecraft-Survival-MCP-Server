import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { z } from "zod";

const { Movements, goals } = pathfinderPkg;

type BotBlock = {
  name: string;
  position: { x: number; y: number; z: number };
  diggable: boolean;
  harvestTools?: Record<string, boolean>;
};

function floorPos(x: number, y: number, z: number) {
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
  };
}

function isTreeLogLike(name: string) {
  return (
    name.includes("log") ||
    name.includes("stem") ||
    name.includes("hyphae")
  );
}

function resolveBlockAt(bot: mineflayer.Bot, x: number, y: number, z: number): BotBlock | null {
  const p = floorPos(x, y, z);
  const block = bot.blockAt(new Vec3(p.x, p.y, p.z)) as BotBlock | null;

  if (!block) {
    return null;
  }

  if (block.name === "air" || block.name === "cave_air" || block.name === "void_air") {
    return null;
  }

  return block;
}

function hasRequiredHarvestTool(bot: mineflayer.Bot, block: BotBlock): boolean {
  const required = block.harvestTools ? Object.keys(block.harvestTools) : [];

  if (required.length === 0) {
    return true;
  }

  const items = bot.inventory.items();

  return required.some((toolKey) => {
    const asNumber = Number(toolKey);

    if (!Number.isNaN(asNumber)) {
      return items.some((item) => item.type === asNumber);
    }

    return items.some((item) => item.name === toolKey);
  });
}

async function equipBestTool(bot: mineflayer.Bot, block: BotBlock) {
  const bestTool = bot.pathfinder.bestHarvestTool(block as never);

  if (!bestTool) {
    return;
  }

  if (bot.heldItem?.type === bestTool.type) {
    return;
  }

  await bot.equip(bestTool, "hand");
}

function isMineableByCurrentInventory(bot: mineflayer.Bot, block: BotBlock) {
  if (!block.diggable) {
    return {
      ok: false,
      reason: `Block is not diggable: ${block.name}`,
    };
  }

  if (!bot.canDigBlock(block as never)) {
    return {
      ok: false,
      reason: `Bot cannot dig this block now: ${block.name}`,
    };
  }

  if (!hasRequiredHarvestTool(bot, block)) {
    return {
      ok: false,
      reason: `Missing required tool for block: ${block.name}`,
    };
  }

  return { ok: true };
}

async function runWithTimeout<T>(operation: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function moveNearBlock(bot: mineflayer.Bot, block: BotBlock, timeoutMs: number) {
  const movement = new Movements(bot);
  movement.allowParkour = false;
  bot.pathfinder.setMovements(movement);

  const p = floorPos(block.position.x, block.position.y, block.position.z);
  const goal = new goals.GoalNear(p.x, p.y, p.z, 1);
  await runWithTimeout(bot.pathfinder.goto(goal), timeoutMs, "Move to block");
}

async function moveNearBlockNoBuild(bot: mineflayer.Bot, block: BotBlock, timeoutMs: number) {
  const movement = new Movements(bot);
  movement.allow1by1towers = false;
  movement.allowParkour = false;
  movement.allowSprinting = false;
  movement.scafoldingBlocks = [];
  bot.pathfinder.setMovements(movement);

  const p = floorPos(block.position.x, block.position.y, block.position.z);
  const goal = new goals.GoalNear(p.x, p.y, p.z, 1);
  await runWithTimeout(bot.pathfinder.goto(goal), timeoutMs, "Move to block (no-build)");
}

async function moveToBlockPosition(
  bot: mineflayer.Bot,
  x: number,
  y: number,
  z: number,
  timeoutMs: number
) {
  const movement = new Movements(bot);
  movement.canDig = false;
  movement.allow1by1towers = false;
  movement.allowParkour = false;
  movement.allowSprinting = false;
  movement.scafoldingBlocks = [];
  bot.pathfinder.setMovements(movement);

  const goal = new goals.GoalNear(x, y, z, 0);
  await runWithTimeout(bot.pathfinder.goto(goal), timeoutMs, "Move to stair step");

  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
}

async function digBlock(bot: mineflayer.Bot, block: BotBlock, timeoutMs: number) {
  await runWithTimeout(bot.dig(block as never), timeoutMs, `Dig ${block.name}`);
}

async function mineTargetBlock(
  bot: mineflayer.Bot,
  block: BotBlock,
  options: {
    timeoutMs: number;
  }
) {
  const status = isMineableByCurrentInventory(bot, block);
  if (!status.ok) {
    throw new Error(status.reason);
  }

  await moveNearBlock(bot, block, options.timeoutMs);
  await equipBestTool(bot, block);
  await digBlock(bot, block, options.timeoutMs);
}

async function mineBlockWithoutReposition(
  bot: mineflayer.Bot,
  block: BotBlock,
  options: {
    timeoutMs: number;
  }
) {
  await equipBestTool(bot, block);

  const status = isMineableByCurrentInventory(bot, block);
  if (!status.ok) {
    throw new Error(status.reason);
  }

  await digBlock(bot, block, options.timeoutMs);
}

async function mineTreeTargetBlock(
  bot: mineflayer.Bot,
  block: BotBlock,
  options: {
    timeoutMs: number;
    allowBuildUpIfNeeded: boolean;
  }
) {
  const status = isMineableByCurrentInventory(bot, block);
  if (!status.ok) {
    throw new Error(status.reason);
  }

  try {
    await moveNearBlockNoBuild(bot, block, options.timeoutMs);
    await equipBestTool(bot, block);
    await digBlock(bot, block, options.timeoutMs);
    return;
  } catch (error) {
    if (!options.allowBuildUpIfNeeded) {
      throw error;
    }
  }

  await moveNearBlock(bot, block, options.timeoutMs);
  await equipBestTool(bot, block);
  await digBlock(bot, block, options.timeoutMs);
}

function ensureProgress(timeoutMs: number, lastProgressAtMs: number) {
  const idle = Date.now() - lastProgressAtMs;

  if (idle >= timeoutMs) {
    throw new Error(`No block mined for ${timeoutMs}ms`);
  }
}

function getForwardDirection(bot: mineflayer.Bot) {
  const yaw = bot.entity?.yaw ?? 0;
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);

  let dirX = 0;
  let dirZ = 0;

  if (Math.abs(dx) >= Math.abs(dz)) {
    dirX = dx >= 0 ? 1 : -1;
  } else {
    dirZ = dz >= 0 ? 1 : -1;
  }

  if (dirX === 0 && dirZ === 0) {
    dirX = 1;
  }

  return { dirX, dirZ };
}

export function registerMiningTools(
  server: McpServer,
  getBot: () => mineflayer.Bot | null
) {
  server.registerTool(
    "mine_block_by_coords",
    {
      description: "Mine one block by coordinates after mineability and tool checks.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        timeout_ms: z.number().int().min(1000).max(600000).default(30000),
      },
    },
    async ({ x, y, z: targetZ, timeout_ms }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const block = resolveBlockAt(bot, x, y, targetZ);

      if (!block) {
        return {
          content: [{ type: "text", text: `No breakable block at x=${x}, y=${y}, z=${targetZ}` }],
          isError: true,
        };
      }

      try {
        await mineTargetBlock(bot, block, { timeoutMs: timeout_ms });

        return {
          content: [{ type: "text", text: `Mined ${block.name} at x=${x}, y=${y}, z=${targetZ}` }],
        };
      } catch (error: unknown) {
        bot.pathfinder.setGoal(null);

        return {
          content: [
            {
              type: "text",
              text: `Failed to mine block: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "mine_room",
    {
      description: "Mine all blocks in a rectangular area from start coordinates.",
      inputSchema: {
        start_x: z.number(),
        start_y: z.number(),
        start_z: z.number(),
        length: z.number().int().min(1).max(128),
        width: z.number().int().min(1).max(128),
        depth: z.number().int().min(1).max(128),
        timeout_ms: z.number().int().min(1000).max(600000).default(180000),
      },
    },
    async ({ start_x, start_y, start_z, length, width, depth, timeout_ms }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      let lastProgressAt = Date.now();
      let mined = 0;
      let skipped = 0;
      let failed = 0;

      try {
        // Mine layer-by-layer (top to bottom), serpentine within each layer.
        for (let dy = 0; dy < depth; dy += 1) {
          for (let dz = 0; dz < width; dz += 1) {
            const xForward = dz % 2 === 0;

            for (let step = 0; step < length; step += 1) {
              ensureProgress(timeout_ms, lastProgressAt);

              const dx = xForward ? step : length - 1 - step;
              const x = start_x + dx;
              const zCoord = start_z + dz;

              const y = start_y - dy;

              const block = resolveBlockAt(bot, x, y, zCoord);
              if (!block) {
                skipped += 1;
                continue;
              }

              try {
                await mineTargetBlock(bot, block, { timeoutMs: Math.min(15000, timeout_ms) });
                mined += 1;
                lastProgressAt = Date.now();
              } catch {
                failed += 1;
              }
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Room mining finished. mined=${mined}, skipped=${skipped}, failed=${failed}`,
            },
          ],
        };
      } catch (error: unknown) {
        bot.pathfinder.setGoal(null);

        return {
          content: [
            {
              type: "text",
              text: `Room mining stopped: ${error instanceof Error ? error.message : String(error)}. mined=${mined}, skipped=${skipped}, failed=${failed}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "break_tree",
    {
      description: "Break all connected logs starting from one tree log block.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        timeout_ms: z.number().int().min(1000).max(600000).default(90000),
        allow_build_up_if_needed: z.boolean().default(true),
      },
    },
    async ({ x, y, z: targetZ, timeout_ms, allow_build_up_if_needed }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const root = resolveBlockAt(bot, x, y, targetZ);
      if (!root) {
        return {
          content: [{ type: "text", text: `No block at x=${x}, y=${y}, z=${targetZ}` }],
          isError: true,
        };
      }

      if (!isTreeLogLike(root.name)) {
        return {
          content: [{ type: "text", text: `Selected block is not a log-like block: ${root.name}` }],
          isError: true,
        };
      }

      let lastProgressAt = Date.now();
      const queue = [floorPos(x, y, targetZ)];
      const visited = new Set<string>();
      const connected: Array<{ x: number; y: number; z: number }> = [];
      const maxNodes = 512;

      while (queue.length > 0 && connected.length < maxNodes) {
        const node = queue.shift()!;
        const key = `${node.x},${node.y},${node.z}`;

        if (visited.has(key)) {
          continue;
        }
        visited.add(key);

        const block = resolveBlockAt(bot, node.x, node.y, node.z);
        if (!block || !isTreeLogLike(block.name)) {
          continue;
        }

        connected.push(node);

        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let oz = -1; oz <= 1; oz += 1) {
              if (ox === 0 && oy === 0 && oz === 0) {
                continue;
              }

              queue.push({
                x: node.x + ox,
                y: node.y + oy,
                z: node.z + oz,
              });
            }
          }
        }
      }

      const remaining = new Map<string, { x: number; y: number; z: number }>();
      for (const node of connected) {
        remaining.set(`${node.x},${node.y},${node.z}`, node);
      }

      let mined = 0;
      let failed = 0;

      try {
        while (remaining.size > 0) {
          ensureProgress(timeout_ms, lastProgressAt);

          let passProgress = false;
          const candidates = Array.from(remaining.values()).sort((a, b) => {
            const da = Math.sqrt(
              (a.x - bot.entity.position.x) ** 2 +
                (a.y - bot.entity.position.y) ** 2 +
                (a.z - bot.entity.position.z) ** 2
            );
            const db = Math.sqrt(
              (b.x - bot.entity.position.x) ** 2 +
                (b.y - bot.entity.position.y) ** 2 +
                (b.z - bot.entity.position.z) ** 2
            );
            return da - db;
          });

          for (const node of candidates) {
            const key = `${node.x},${node.y},${node.z}`;
            const block = resolveBlockAt(bot, node.x, node.y, node.z);

            if (!block || !isTreeLogLike(block.name)) {
              remaining.delete(key);
              continue;
            }

            try {
              await mineTreeTargetBlock(bot, block, {
                timeoutMs: Math.min(15000, timeout_ms),
                allowBuildUpIfNeeded: allow_build_up_if_needed,
              });
              mined += 1;
              lastProgressAt = Date.now();
              passProgress = true;
              remaining.delete(key);
            } catch {
              failed += 1;
            }
          }

          if (!passProgress) {
            break;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Tree break finished. logs_mined=${mined}, failed=${failed}, remaining=${remaining.size}`,
            },
          ],
        };
      } catch (error: unknown) {
        bot.pathfinder.setGoal(null);

        return {
          content: [
            {
              type: "text",
              text: `Tree break stopped: ${error instanceof Error ? error.message : String(error)}. logs_mined=${mined}, failed=${failed}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "mine_stairs",
    {
      description: "Create a mineshaft stair path to a target depth.",
      inputSchema: {
        depth: z.number().int().min(1).max(128),
        timeout_ms: z.number().int().min(1000).max(600000).default(180000),
      },
    },
    async ({ depth, timeout_ms }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      if (!bot.entity) {
        return {
          content: [{ type: "text", text: "Bot entity is not available yet." }],
          isError: true,
        };
      }

      let currentX = Math.floor(bot.entity.position.x);
      let currentY = Math.floor(bot.entity.position.y);
      let currentZ = Math.floor(bot.entity.position.z);
      const { dirX, dirZ } = getForwardDirection(bot);

      let lastProgressAt = Date.now();
      let mined = 0;
      let skipped = 0;
      let failed = 0;

      try {
        for (let step = 0; step < depth; step += 1) {
          ensureProgress(timeout_ms, lastProgressAt);

          const frontX = currentX + dirX;
          const frontZ = currentZ + dirZ;
          const targets = [
            { x: frontX, y: currentY + 1, z: frontZ },
            { x: frontX, y: currentY, z: frontZ },
            { x: frontX, y: currentY - 1, z: frontZ },
          ];

          for (const node of targets) {
            const block = resolveBlockAt(bot, node.x, node.y, node.z);

            if (!block) {
              skipped += 1;
              continue;
            }

            try {
              await mineBlockWithoutReposition(bot, block, {
                timeoutMs: Math.min(15000, timeout_ms),
              });
              mined += 1;
              lastProgressAt = Date.now();
            } catch {
              failed += 1;
            }
          }

          const support = resolveBlockAt(bot, frontX, currentY - 2, frontZ);
          if (!support) {
            throw new Error(
              `No support block below next stair step at x=${frontX}, y=${currentY - 2}, z=${frontZ}`
            );
          }

          try {
            await moveToBlockPosition(
              bot,
              frontX,
              currentY - 1,
              frontZ,
              Math.min(15000, timeout_ms)
            );
          } catch {
            failed += 1;
            break;
          }

          currentX = frontX;
          currentY -= 1;
          currentZ = frontZ;
        }

        return {
          content: [
            {
              type: "text",
              text: `Stair mining finished to depth=${depth}. mined=${mined}, skipped=${skipped}, failed=${failed}`,
            },
          ],
        };
      } catch (error: unknown) {
        bot.pathfinder.setGoal(null);

        return {
          content: [
            {
              type: "text",
              text: `Stair mining stopped: ${error instanceof Error ? error.message : String(error)}. mined=${mined}, skipped=${skipped}, failed=${failed}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
