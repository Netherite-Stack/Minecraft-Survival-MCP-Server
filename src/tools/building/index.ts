import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { z } from "zod";

const { Movements, goals } = pathfinderPkg;

type BotBlock = {
  name: string;
  position: { x: number; y: number; z: number };
};

type InventoryItem = {
  name: string;
  type: number;
  count: number;
};

const FACE_VECTORS = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 1, 0),
  new Vec3(0, -1, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

const REPLACEABLE_BLOCKS = new Set([
  "air",
  "cave_air",
  "void_air",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "vine",
  "dead_bush",
  "snow",
]);

function floorPos(x: number, y: number, z: number) {
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
  };
}

function blockKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function isReplaceable(block: BotBlock | null) {
  if (!block) {
    return true;
  }

  return REPLACEABLE_BLOCKS.has(block.name);
}

function resolveBlockAt(bot: mineflayer.Bot, x: number, y: number, z: number): BotBlock | null {
  const p = floorPos(x, y, z);
  return (bot.blockAt(new Vec3(p.x, p.y, p.z)) as BotBlock | null) ?? null;
}

function countInventoryBlocks(bot: mineflayer.Bot, blockName: string) {
  const items = bot.inventory.items() as InventoryItem[];
  return items
    .filter((item) => item.name === blockName)
    .reduce((sum, item) => sum + item.count, 0);
}

function getInventoryBlockItem(bot: mineflayer.Bot, blockName: string) {
  const items = bot.inventory.items() as InventoryItem[];
  return items.find((item) => item.name === blockName) ?? null;
}

function validateBlockName(bot: mineflayer.Bot, blockName: string) {
  const byName = (bot.registry as any)?.blocksByName;
  if (!byName) {
    return { ok: true as const };
  }

  if (!byName[blockName]) {
    return {
      ok: false as const,
      reason: `Unknown block name: ${blockName}`,
    };
  }

  return { ok: true as const };
}

function isEntityOccupyingTarget(bot: mineflayer.Bot, x: number, y: number, z: number) {
  const entities = Object.values(bot.entities ?? {});

  if (bot.entity) {
    entities.push(bot.entity as never);
  }

  return entities.some((entity: any) => {
    if (!entity?.position) {
      return false;
    }

    const ex = Math.floor(entity.position.x);
    const ez = Math.floor(entity.position.z);
    const baseY = Math.floor(entity.position.y);
    const height = Math.max(1, Math.ceil(entity.height ?? 1.8));

    return ex === x && ez === z && y >= baseY && y < baseY + height;
  });
}

function findPlacementReference(bot: mineflayer.Bot, target: Vec3) {
  for (const face of FACE_VECTORS) {
    const referencePos = target.minus(face);
    const referenceBlock = resolveBlockAt(bot, referencePos.x, referencePos.y, referencePos.z);

    if (!referenceBlock) {
      continue;
    }

    if (isReplaceable(referenceBlock)) {
      continue;
    }

    return {
      referenceBlock,
      faceVector: face,
    };
  }

  return null;
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

async function moveNearPosition(bot: mineflayer.Bot, position: Vec3, timeoutMs: number) {
  const movement = new Movements(bot);
  movement.canDig = false;
  movement.allow1by1towers = false;
  movement.allowParkour = false;
  movement.allowSprinting = false;
  movement.scafoldingBlocks = [];
  bot.pathfinder.setMovements(movement);

  const goal = new goals.GoalNear(position.x, position.y, position.z, 2);
  await runWithTimeout(bot.pathfinder.goto(goal), timeoutMs, "Move to build position");
}

function ensureProgress(timeoutMs: number, lastProgressAtMs: number, label: string) {
  const idle = Date.now() - lastProgressAtMs;

  if (idle >= timeoutMs) {
    throw new Error(`No ${label} progress for ${timeoutMs}ms`);
  }
}

function validatePlacementTarget(bot: mineflayer.Bot, target: Vec3, blockName: string) {
  const existing = resolveBlockAt(bot, target.x, target.y, target.z);

  if (existing && existing.name === blockName) {
    return { ok: true as const, alreadyPlaced: true as const };
  }

  if (!isReplaceable(existing)) {
    return {
      ok: false as const,
      reason: `Target is occupied by non-replaceable block '${existing?.name}' at x=${target.x}, y=${target.y}, z=${target.z}`,
    };
  }

  if (isEntityOccupyingTarget(bot, target.x, target.y, target.z)) {
    return {
      ok: false as const,
      reason: `An entity is occupying x=${target.x}, y=${target.y}, z=${target.z}`,
    };
  }

  const reference = findPlacementReference(bot, target);
  if (!reference) {
    return {
      ok: false as const,
      reason: `No adjacent support block to place against at x=${target.x}, y=${target.y}, z=${target.z}`,
    };
  }

  return {
    ok: true as const,
    alreadyPlaced: false as const,
    reference,
  };
}

async function placeSingleBlock(
  bot: mineflayer.Bot,
  blockName: string,
  target: Vec3,
  timeoutMs: number
) {
  const item = getInventoryBlockItem(bot, blockName);
  if (!item) {
    throw new Error(`Missing block item in inventory: ${blockName}`);
  }

  const validation = validatePlacementTarget(bot, target, blockName);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  if (validation.alreadyPlaced) {
    return {
      placed: false,
      skipped: true,
      reason: `Block already present at x=${target.x}, y=${target.y}, z=${target.z}`,
    };
  }

  await moveNearPosition(bot, target, timeoutMs);

  if (bot.heldItem?.type !== item.type) {
    await runWithTimeout(bot.equip(item as never, "hand"), timeoutMs, `Equip ${blockName}`);
  }

  await runWithTimeout(
    bot.placeBlock(validation.reference.referenceBlock as never, validation.reference.faceVector),
    timeoutMs,
    `Place ${blockName}`
  );

  const after = resolveBlockAt(bot, target.x, target.y, target.z);
  if (!after || after.name !== blockName) {
    throw new Error(
      `Placement did not result in '${blockName}' at x=${target.x}, y=${target.y}, z=${target.z}`
    );
  }

  return {
    placed: true,
    skipped: false,
  };
}

function buildWallTargets(
  start: Vec3,
  xLength: number,
  yHeight: number,
  zLength: number,
  xDirection: number,
  yDirection: number,
  zDirection: number
) {
  const targets: Vec3[] = [];

  for (let yStep = 0; yStep < yHeight; yStep += 1) {
    for (let zStep = 0; zStep < zLength; zStep += 1) {
      for (let xStep = 0; xStep < xLength; xStep += 1) {
        targets.push(
          new Vec3(
            start.x + xStep * xDirection,
            start.y + yStep * yDirection,
            start.z + zStep * zDirection
          )
        );
      }
    }
  }

  return targets;
}

function buildCeilingTargets(
  start: Vec3,
  xLength: number,
  zLength: number,
  xDirection: number,
  zDirection: number
) {
  const targets: Vec3[] = [];

  for (let zStep = 0; zStep < zLength; zStep += 1) {
    const xForward = zStep % 2 === 0;

    for (let xStep = 0; xStep < xLength; xStep += 1) {
      const xIndex = xForward ? xStep : xLength - 1 - xStep;
      targets.push(new Vec3(start.x + xIndex * xDirection, start.y, start.z + zStep * zDirection));
    }
  }

  return targets;
}

function computeRequiredPlacements(bot: mineflayer.Bot, blockName: string, targets: Vec3[]) {
  return targets.reduce((count, target) => {
    const existing = resolveBlockAt(bot, target.x, target.y, target.z);
    if (existing && existing.name === blockName) {
      return count;
    }

    return count + 1;
  }, 0);
}

function summarizeFailures(failures: string[]) {
  if (failures.length === 0) {
    return "none";
  }

  return failures.slice(0, 5).join(" | ");
}

export function registerBuildingTools(
  server: McpServer,
  getBot: () => mineflayer.Bot | null
) {
  server.registerTool(
    "place_block_at",
    {
      description:
        "Place one block at exact coordinates after validating support, occupancy, and inventory.",
      inputSchema: {
        block_name: z.string().min(1),
        x: z.number(),
        y: z.number(),
        z: z.number(),
        timeout_ms: z.number().int().min(1000).max(600000).default(30000),
      },
    },
    async ({ block_name, x, y, z: targetZ, timeout_ms }) => {
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

      const blockName = block_name.trim().toLowerCase();
      const nameStatus = validateBlockName(bot, blockName);
      if (!nameStatus.ok) {
        return {
          content: [{ type: "text", text: nameStatus.reason }],
          isError: true,
        };
      }

      const target = new Vec3(Math.floor(x), Math.floor(y), Math.floor(targetZ));

      try {
        const result = await placeSingleBlock(bot, blockName, target, timeout_ms);

        if (result.skipped) {
          return {
            content: [
              {
                type: "text",
                text:
                  result.reason ??
                  `Block already present at x=${target.x}, y=${target.y}, z=${target.z}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Placed ${blockName} at x=${target.x}, y=${target.y}, z=${target.z}`,
            },
          ],
        };
      } catch (error: unknown) {
        bot.pathfinder.setGoal(null);

        return {
          content: [
            {
              type: "text",
              text: `Failed to place block: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "place_wall",
    {
      description:
        "Place a rectangular wall from a start coordinate. Wall is a plane: either x_length or z_length must be 1.",
      inputSchema: {
        block_name: z.string().min(1),
        start_x: z.number(),
        start_y: z.number(),
        start_z: z.number(),
        x_length: z.number().int().min(1).max(128),
        y_height: z.number().int().min(1).max(128),
        z_length: z.number().int().min(1).max(128),
        x_direction: z.union([z.literal(-1), z.literal(1)]).default(1),
        y_direction: z.union([z.literal(-1), z.literal(1)]).default(1),
        z_direction: z.union([z.literal(-1), z.literal(1)]).default(1),
        timeout_ms: z.number().int().min(1000).max(600000).default(180000),
      },
    },
    async ({
      block_name,
      start_x,
      start_y,
      start_z,
      x_length,
      y_height,
      z_length,
      x_direction,
      y_direction,
      z_direction,
      timeout_ms,
    }) => {
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

      const blockName = block_name.trim().toLowerCase();
      const nameStatus = validateBlockName(bot, blockName);
      if (!nameStatus.ok) {
        return {
          content: [{ type: "text", text: nameStatus.reason }],
          isError: true,
        };
      }

      if (x_length > 1 && z_length > 1) {
        return {
          content: [
            {
              type: "text",
              text: "Invalid wall dimensions: x_length and z_length cannot both be greater than 1. Use one horizontal axis for a wall plane.",
            },
          ],
          isError: true,
        };
      }

      const start = new Vec3(Math.floor(start_x), Math.floor(start_y), Math.floor(start_z));
      const targets = buildWallTargets(
        start,
        x_length,
        y_height,
        z_length,
        x_direction,
        y_direction,
        z_direction
      );

      const required = computeRequiredPlacements(bot, blockName, targets);
      const available = countInventoryBlocks(bot, blockName);
      const missing = Math.max(0, required - available);

      if (missing > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Not enough resources for wall '${blockName}': required=${required}, available=${available}, missing=${missing}`,
            },
          ],
          isError: true,
        };
      }

      if (required === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Wall already complete with '${blockName}'. required=${required}, available=${available}, missing=${missing}`,
            },
          ],
        };
      }

      let lastProgressAt = Date.now();
      let placed = 0;
      let skipped = 0;
      let failed = 0;
      const failures: string[] = [];

      try {
        for (const target of targets) {
          ensureProgress(timeout_ms, lastProgressAt, "wall placement");

          try {
            const result = await placeSingleBlock(bot, blockName, target, Math.min(15000, timeout_ms));

            if (result.skipped) {
              skipped += 1;
            } else {
              placed += 1;
              lastProgressAt = Date.now();
            }
          } catch (error: unknown) {
            failed += 1;
            failures.push(
              `x=${target.x}, y=${target.y}, z=${target.z} -> ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Wall placement finished. placed=${placed}, skipped=${skipped}, failed=${failed}, required=${required}, available=${available}, missing=${missing}. failures=${summarizeFailures(failures)}`,
            },
          ],
        };
      } catch (error: unknown) {
        bot.pathfinder.setGoal(null);

        return {
          content: [
            {
              type: "text",
              text: `Wall placement stopped: ${error instanceof Error ? error.message : String(error)}. placed=${placed}, skipped=${skipped}, failed=${failed}, required=${required}, available=${available}, missing=${missing}. failures=${summarizeFailures(failures)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "place_ceiling",
    {
      description:
        "Place a rectangular ceiling plane from a start coordinate along x/z directions at a fixed y level.",
      inputSchema: {
        block_name: z.string().min(1),
        start_x: z.number(),
        start_y: z.number(),
        start_z: z.number(),
        x_length: z.number().int().min(1).max(128),
        z_length: z.number().int().min(1).max(128),
        x_direction: z.union([z.literal(-1), z.literal(1)]).default(1),
        z_direction: z.union([z.literal(-1), z.literal(1)]).default(1),
        timeout_ms: z.number().int().min(1000).max(600000).default(180000),
      },
    },
    async ({
      block_name,
      start_x,
      start_y,
      start_z,
      x_length,
      z_length,
      x_direction,
      z_direction,
      timeout_ms,
    }) => {
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

      const blockName = block_name.trim().toLowerCase();
      const nameStatus = validateBlockName(bot, blockName);
      if (!nameStatus.ok) {
        return {
          content: [{ type: "text", text: nameStatus.reason }],
          isError: true,
        };
      }

      const start = new Vec3(Math.floor(start_x), Math.floor(start_y), Math.floor(start_z));
      const targets = buildCeilingTargets(start, x_length, z_length, x_direction, z_direction);

      const required = computeRequiredPlacements(bot, blockName, targets);
      const available = countInventoryBlocks(bot, blockName);
      const missing = Math.max(0, required - available);

      if (missing > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Not enough resources for ceiling '${blockName}': required=${required}, available=${available}, missing=${missing}`,
            },
          ],
          isError: true,
        };
      }

      if (required === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Ceiling already complete with '${blockName}'. required=${required}, available=${available}, missing=${missing}`,
            },
          ],
        };
      }

      let lastProgressAt = Date.now();
      let placed = 0;
      let skipped = 0;
      let failed = 0;
      const failures: string[] = [];

      try {
        for (const target of targets) {
          ensureProgress(timeout_ms, lastProgressAt, "ceiling placement");

          try {
            const result = await placeSingleBlock(bot, blockName, target, Math.min(15000, timeout_ms));

            if (result.skipped) {
              skipped += 1;
            } else {
              placed += 1;
              lastProgressAt = Date.now();
            }
          } catch (error: unknown) {
            failed += 1;
            failures.push(
              `x=${target.x}, y=${target.y}, z=${target.z} -> ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Ceiling placement finished. placed=${placed}, skipped=${skipped}, failed=${failed}, required=${required}, available=${available}, missing=${missing}. failures=${summarizeFailures(failures)}`,
            },
          ],
        };
      } catch (error: unknown) {
        bot.pathfinder.setGoal(null);

        return {
          content: [
            {
              type: "text",
              text: `Ceiling placement stopped: ${error instanceof Error ? error.message : String(error)}. placed=${placed}, skipped=${skipped}, failed=${failed}, required=${required}, available=${available}, missing=${missing}. failures=${summarizeFailures(failures)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
