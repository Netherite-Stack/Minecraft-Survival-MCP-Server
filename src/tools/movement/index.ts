import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { z } from "zod";

const { Movements, goals } = pathfinderPkg;

type MovementOptions = {
  allow_block_breaking: boolean;
  allow_block_placement: boolean;
};

function createConfiguredMovements(bot: mineflayer.Bot, options: MovementOptions) {
  const movements = new Movements(bot);
  movements.canDig = options.allow_block_breaking;

  if (!options.allow_block_placement) {
    movements.allow1by1towers = false;
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
}
