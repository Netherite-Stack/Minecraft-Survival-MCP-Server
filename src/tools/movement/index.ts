import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { z } from "zod";

const { Movements, goals } = pathfinderPkg;

type MovementOptions = {
  allow_block_breaking: boolean;
  allow_block_placement: boolean;
};

function createConfiguredMovements(bot: mineflayer.Bot, options: MovementOptions) {
  const movements = new Movements(bot);
  movements.canDig = options.allow_block_breaking;
  movements.allow1by1towers = false;
  movements.allowParkour = false;

  if (!options.allow_block_placement) {
    movements.scafoldingBlocks = [];
  }

  return movements;
}

async function runGoalWithTimeout(
  bot: mineflayer.Bot,
  goal: InstanceType<typeof goals.GoalBlock> | InstanceType<typeof goals.GoalNear>,
  timeoutMs: number
) {
  await new Promise<void>((resolve, reject) => {
    let done = false;

    const getPosition = () => {
      const pos = bot.entity?.position;

      return {
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        z: pos?.z ?? 0,
      };
    };

    const hasMoved = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number }
    ) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;

      return dx * dx + dy * dy + dz * dz >= 0.01;
    };

    let lastPos = getPosition();
    let lastProgressAt = Date.now();

    const progressTimer = setInterval(() => {
      if (done) {
        return;
      }

      const currentPos = getPosition();

      if (hasMoved(currentPos, lastPos)) {
        lastPos = currentPos;
        lastProgressAt = Date.now();
        return;
      }

      if (Date.now() - lastProgressAt >= timeoutMs) {
        done = true;
        clearInterval(progressTimer);
        bot.pathfinder.setGoal(null);
        reject(new Error(`No movement progress for ${timeoutMs}ms`));
      }
    }, 250);

    bot.pathfinder
      .goto(goal)
      .then(() => {
        if (done) {
          return;
        }

        done = true;
        clearInterval(progressTimer);
        resolve();
      })
      .catch((error: unknown) => {
        if (done) {
          return;
        }

        done = true;
        clearInterval(progressTimer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function isOpenableBlockName(name: string) {
  return name.endsWith("_door") || name.endsWith("_trapdoor");
}

function resolveOpenableIds(bot: mineflayer.Bot) {
  const blocksByName = ((bot.registry as any)?.blocksByName ?? {}) as Record<string, { id: number }>;

  return Object.entries(blocksByName)
    .filter(([name, value]) => Boolean(value?.id) && isOpenableBlockName(name))
    .map(([, value]) => value.id);
}

function getBlockOpenState(block: any): boolean | null {
  if (!block) {
    return null;
  }

  const props = block.getProperties?.();
  if (props && typeof props.open === "boolean") {
    return props.open;
  }

  if (typeof block.open === "boolean") {
    return block.open;
  }

  return null;
}

async function setOpenableState(
  bot: mineflayer.Bot,
  desiredOpen: boolean,
  options: { x?: number; y?: number; z?: number; max_distance: number }
) {
  const ids = resolveOpenableIds(bot);
  if (ids.length === 0) {
    throw new Error("No door/trapdoor block IDs available in registry for this version.");
  }

  let target = null as any;

  if (
    typeof options.x === "number" &&
    typeof options.y === "number" &&
    typeof options.z === "number"
  ) {
    target = bot.blockAt(new Vec3(Math.floor(options.x), Math.floor(options.y), Math.floor(options.z)));
  } else {
    target = bot.findBlock({
      maxDistance: options.max_distance,
      matching: (block) => Boolean(block && ids.includes(block.type)),
    });
  }

  if (!target) {
    throw new Error("No door or trapdoor found at target coordinates / in range.");
  }

  if (!isOpenableBlockName(target.name)) {
    throw new Error(`Target block is not a door/trapdoor: ${target.name}`);
  }

  const center = target.position.offset(0.5, 0.5, 0.5);
  await bot.lookAt(center, true);

  let state = getBlockOpenState(target);

  if (state === desiredOpen) {
    return {
      changed: false,
      blockName: target.name,
      position: target.position,
      state,
    };
  }

  await bot.activateBlock(target);

  const updated = bot.blockAt(target.position) ?? target;
  state = getBlockOpenState(updated);

  if (state !== desiredOpen) {
    throw new Error(
      `Failed to ${desiredOpen ? "open" : "close"} ${target.name} at x=${target.position.x}, y=${target.position.y}, z=${target.position.z}. It may be iron-powered or blocked.`
    );
  }

  return {
    changed: true,
    blockName: target.name,
    position: target.position,
    state,
  };
}

export function registerMovementTools(
  server: McpServer,
  getBot: () => mineflayer.Bot | null
) {
  server.registerTool(
    "get_own_position",
    {
      description: "Get the bot's current coordinates.",
    },
    async () => {
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

      if (!bot.entity) {
        return {
          content: [{ type: "text", text: "Bot entity is not available yet." }],
          isError: true,
        };
      }

      const { x, y, z: currentZ } = bot.entity.position;

      return {
        content: [
          {
            type: "text",
            text: `x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${currentZ.toFixed(2)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "move_to_coordinates",
    {
      description: "Move bot to coordinates with pathfinder and configurable dig/place behavior.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        timeout_ms: z.number().int().min(1000).max(300000).default(30000),
        allow_block_breaking: z.boolean().default(true),
        allow_block_placement: z.boolean().default(true),
      },
    },
    async ({ x, y, z: targetZ, timeout_ms, allow_block_breaking, allow_block_placement }) => {
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

      try {
        bot.pathfinder.setGoal(null);

        const movements = createConfiguredMovements(bot, {
          allow_block_breaking,
          allow_block_placement,
        });
        bot.pathfinder.setMovements(movements);

        const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(targetZ));
        await runGoalWithTimeout(bot, goal, timeout_ms);

        return {
          content: [
            {
              type: "text",
              text: `Reached target coordinates x=${x}, y=${y}, z=${targetZ}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed moving to coordinates: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "move_to_player",
    {
      description: "Move bot near a specific player with pathfinder and timeout control.",
      inputSchema: {
        username: z.string().min(1),
        range: z.number().int().min(1).max(16).default(1),
        timeout_ms: z.number().int().min(1000).max(300000).default(30000),
        allow_block_breaking: z.boolean().default(true),
        allow_block_placement: z.boolean().default(true),
      },
    },
    async ({ username, range, timeout_ms, allow_block_breaking, allow_block_placement }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const player = Object.values(bot.players).find(
        (p) => p.username.toLowerCase() === username.toLowerCase()
      );

      if (!player) {
        return {
          content: [{ type: "text", text: `Player not found: ${username}` }],
          isError: true,
        };
      }

      if (!player.entity) {
        return {
          content: [{ type: "text", text: `Player is not visible right now: ${player.username}` }],
          isError: true,
        };
      }

      try {
        bot.pathfinder.setGoal(null);

        const movements = createConfiguredMovements(bot, {
          allow_block_breaking,
          allow_block_placement,
        });
        bot.pathfinder.setMovements(movements);

        const { x, y, z: targetZ } = player.entity.position;
        const goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(targetZ), range);
        await runGoalWithTimeout(bot, goal, timeout_ms);

        return {
          content: [
            {
              type: "text",
              text: `Reached ${player.username} within ${range} block(s)`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed moving to player: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "open_door_or_trapdoor",
    {
      description:
        "Open a door/trapdoor at coordinates or nearest one in range. Useful when pathing does not auto-open reliably.",
      inputSchema: {
        x: z.number().optional(),
        y: z.number().optional(),
        z: z.number().optional(),
        max_distance: z.number().int().min(1).max(16).default(4),
      },
    },
    async ({ x, y, z: targetZ, max_distance }) => {
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

      try {
        const result = await setOpenableState(bot, true, { x, y, z: targetZ, max_distance });
        return {
          content: [
            {
              type: "text",
              text: result.changed
                ? `Opened ${result.blockName} at x=${result.position.x}, y=${result.position.y}, z=${result.position.z}`
                : `${result.blockName} is already open at x=${result.position.x}, y=${result.position.y}, z=${result.position.z}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to open door/trapdoor: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "close_door_or_trapdoor",
    {
      description:
        "Close a door/trapdoor at coordinates or nearest one in range. Useful to secure areas and control villager/pathing flows.",
      inputSchema: {
        x: z.number().optional(),
        y: z.number().optional(),
        z: z.number().optional(),
        max_distance: z.number().int().min(1).max(16).default(4),
      },
    },
    async ({ x, y, z: targetZ, max_distance }) => {
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

      try {
        const result = await setOpenableState(bot, false, { x, y, z: targetZ, max_distance });
        return {
          content: [
            {
              type: "text",
              text: result.changed
                ? `Closed ${result.blockName} at x=${result.position.x}, y=${result.position.y}, z=${result.position.z}`
                : `${result.blockName} is already closed at x=${result.position.x}, y=${result.position.y}, z=${result.position.z}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to close door/trapdoor: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
