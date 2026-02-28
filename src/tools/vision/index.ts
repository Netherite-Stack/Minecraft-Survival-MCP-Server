import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import { Vec3 } from "vec3";
import { z } from "zod";
import { matchQuery } from "../shared/query-matcher.js";

export function registerVisionTools(
  server: McpServer,
  getBot: () => mineflayer.Bot | null
) {
  server.registerTool(
    "locate_dropped_items",
    {
      description:
        "Locate dropped item entities in a radius and return nearest matches with optional result limit.",
      inputSchema: {
        radius: z.number().int().min(1).max(128).default(32),
        max_results: z.number().int().min(1).max(200).default(20),
        query: z.string().optional(),
      },
    },
    async ({ radius, max_results, query }) => {
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

      const q = query?.trim() || "*";
      const entities = Object.values(bot.entities ?? {});

      const items = entities
        .map((entity) => {
          const dropped = entity.getDroppedItem?.() ?? null;
          const entityName = (entity.name ?? "").toLowerCase();
          const objectType = (entity.objectType ?? "").toLowerCase();
          const isDroppedItem =
            dropped !== null ||
            entityName === "item" ||
            entityName === "item_stack" ||
            objectType === "item" ||
            objectType === "item_stack";

          if (!isDroppedItem) {
            return null;
          }

          const dx = entity.position.x - bot.entity.position.x;
          const dy = entity.position.y - bot.entity.position.y;
          const dz = entity.position.z - bot.entity.position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (distance > radius) {
            return null;
          }

          const itemName = dropped?.name ?? (entityName || "unknown_item");
          const itemDisplayName = dropped?.displayName ?? entity.displayName ?? itemName;
          const itemId = dropped?.type;
          const itemCount = dropped?.count ?? entity.count ?? 1;

          if (!matchQuery(q, [{ name: itemName, displayName: itemDisplayName, id: itemId }])) {
            return null;
          }

          return {
            itemName,
            itemDisplayName,
            itemCount,
            x: entity.position.x,
            y: entity.position.y,
            z: entity.position.z,
            distance,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .sort((a, b) => a.distance - b.distance);

      const limited = items.slice(0, max_results);

      if (limited.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No dropped items found in radius ${radius}${q !== "*" ? ` for query '${q}'` : ""}.`,
            },
          ],
        };
      }

      const lines = limited.map(
        (item, index) =>
          `${index + 1}. ${item.itemName} x${item.itemCount} @ x=${item.x.toFixed(2)}, y=${item.y.toFixed(2)}, z=${item.z.toFixed(2)} (${item.distance.toFixed(2)} blocks)`
      );

      return {
        content: [
          {
            type: "text",
            text: `Found ${items.length} dropped item matches. Returning ${limited.length}:\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "locate_blocks_in_area",
    {
      description:
        "Locate blocks by query in an area and return nearest matches with optional result limit.",
      inputSchema: {
        query: z.string().min(1),
        radius: z.number().int().min(1).max(128).default(32),
        max_results: z.number().int().min(1).max(200).default(20),
        center_x: z.number().optional(),
        center_y: z.number().optional(),
        center_z: z.number().optional(),
      },
    },
    async ({ query, radius, max_results, center_x, center_y, center_z }) => {
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

      const center = new Vec3(
        Math.floor(center_x ?? bot.entity.position.x),
        Math.floor(center_y ?? bot.entity.position.y),
        Math.floor(center_z ?? bot.entity.position.z)
      );

      const rawPositions = bot.findBlocks({
        point: center,
        maxDistance: radius,
        count: 5000,
        matching: (block) => {
          if (!block) {
            return false;
          }

          if (block.name === "air" || block.name === "cave_air" || block.name === "void_air") {
            return false;
          }

          return matchQuery(query, [
            {
              name: block.name,
              displayName: block.displayName,
              id: block.type,
            },
          ]);
        },
      });

      const matches = rawPositions
        .map((pos) => {
          const block = bot.blockAt(pos);
          if (!block) {
            return null;
          }

          const dx = pos.x - bot.entity.position.x;
          const dy = pos.y - bot.entity.position.y;
          const dz = pos.z - bot.entity.position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          return {
            name: block.name,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            distance,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, max_results);

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No blocks found for query '${query}' in radius ${radius}.`,
            },
          ],
        };
      }

      const lines = matches.map(
        (m, index) =>
          `${index + 1}. ${m.name} @ x=${m.x}, y=${m.y}, z=${m.z} (${m.distance.toFixed(2)} blocks)`
      );

      return {
        content: [
          {
            type: "text",
            text: `Found ${rawPositions.length} matching blocks. Returning ${matches.length}:\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );
}
