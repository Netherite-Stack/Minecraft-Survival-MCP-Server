import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import { z } from "zod";

export function registerMultiplayerTools(
  server: McpServer,
  getBot: () => mineflayer.Bot | null
) {
  server.registerTool("list_players", {
    description: "List all currently known players on the server.",
  }, async () => {
    const bot = getBot();

    if (!bot) {
      return {
        content: [{ type: "text", text: "Bot is not connected yet." }],
        isError: true,
      };
    }

    const usernames = Object.keys(bot.players).sort();

    return {
      content: [
        {
          type: "text",
          text: usernames.length > 0 ? usernames.join(", ") : "No players found.",
        },
      ],
    };
  });

  server.registerTool(
    "find_player",
    {
      description: "Search players by partial username (case-insensitive).",
      inputSchema: {
        query: z.string().min(1),
      },
    },
    async ({ query }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const q = query.toLowerCase();
      const matches = Object.keys(bot.players)
        .filter((name) => name.toLowerCase().includes(q))
        .sort();

      return {
        content: [
          {
            type: "text",
            text: matches.length > 0 ? matches.join(", ") : `No player found for query: ${query}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_player_coordinates",
    {
      description: "Get exact coordinates of a visible player.",
      inputSchema: {
        username: z.string().min(1),
      },
    },
    async ({ username }) => {
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

      const { x, y, z } = player.entity.position;

      return {
        content: [
          {
            type: "text",
            text: `${player.username}: x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${z.toFixed(2)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "distance_to_player",
    {
      description: "Calculate 3D distance from bot to a player in blocks.",
      inputSchema: {
        username: z.string().min(1),
      },
    },
    async ({ username }) => {
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

      const dx = player.entity.position.x - bot.entity.position.x;
      const dy = player.entity.position.y - bot.entity.position.y;
      const dz = player.entity.position.z - bot.entity.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      return {
        content: [
          {
            type: "text",
            text: `Distance to ${player.username}: ${distance.toFixed(2)} blocks`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "find_nearest_players",
    {
      description: "Find the nearest X visible players to the bot.",
      inputSchema: {
        x_parameter: z.number().int().min(1).max(50).default(3),
      },
    },
    async ({ x_parameter }) => {
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

      const nearest = Object.values(bot.players)
        .filter((player) => player.entity && player.username !== bot.username)
        .map((player) => {
          const dx = player.entity!.position.x - bot.entity.position.x;
          const dy = player.entity!.position.y - bot.entity.position.y;
          const dz = player.entity!.position.z - bot.entity.position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          return { username: player.username, distance };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, x_parameter);

      if (nearest.length === 0) {
        return {
          content: [{ type: "text", text: "No visible players found." }],
        };
      }

      const lines = nearest.map(
        (p, index) => `${index + 1}. ${p.username} (${p.distance.toFixed(2)} blocks)`
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
