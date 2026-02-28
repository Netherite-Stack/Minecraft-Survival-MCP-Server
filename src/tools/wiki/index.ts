import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import { z } from "zod";
import { matchQuery } from "../shared/query-matcher.js";

export function registerWikiTools(
  server: McpServer,
  getBot: () => mineflayer.Bot | null
) {
  server.registerTool(
    "search_blocks_wiki",
    {
      description: "Search Minecraft blocks by name, wildcard, or numeric id.",
      inputSchema: {
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(200).default(20),
      },
    },
    async ({ query, max_results }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const entries = Object.values(bot.registry.blocksByName)
        .filter((block) =>
          matchQuery(query, [
            {
              name: block.name,
              displayName: block.displayName,
              id: block.id,
            },
          ])
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, max_results);

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: `No blocks found for query '${query}'.` }],
        };
      }

      const lines = entries.map((block, index) => {
        return `${index + 1}. ${block.name} (id=${block.id}, display='${block.displayName}')`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  server.registerTool(
    "search_items_wiki",
    {
      description: "Search Minecraft items by name, wildcard, or numeric id.",
      inputSchema: {
        query: z.string().min(1),
        max_results: z.number().int().min(1).max(200).default(20),
      },
    },
    async ({ query, max_results }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const entries = Object.values(bot.registry.itemsByName)
        .filter((item) =>
          matchQuery(query, [
            {
              name: item.name,
              displayName: item.displayName,
              id: item.id,
            },
          ])
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, max_results);

      if (entries.length === 0) {
        return {
          content: [{ type: "text", text: `No items found for query '${query}'.` }],
        };
      }

      const lines = entries.map((item, index) => {
        return `${index + 1}. ${item.name} (id=${item.id}, display='${item.displayName}')`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
