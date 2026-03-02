import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import { z } from "zod";
import { matchQuery } from "../shared/query-matcher.js";
import {
  formatRequirement,
  getOutputCountForTarget,
  getRecipeRequirements,
  scaleRequirements,
} from "../shared/crafting-recipe.js";

type RegistryItem = {
  id: number;
  name: string;
  displayName?: string;
};

function resolveTargetItem(bot: mineflayer.Bot, query: string): RegistryItem | null {
  const items = Object.values((bot.registry as any).itemsByName ?? {}) as RegistryItem[];
  const matches = items
    .filter((item) =>
      matchQuery(query, [
        {
          name: item.name,
          displayName: item.displayName,
          id: item.id,
        },
      ])
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (matches.length === 0) {
    return null;
  }

  const exact = matches.find((item) => item.name.toLowerCase() === query.trim().toLowerCase());
  return exact ?? matches[0];
}

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

  server.registerTool(
    "get_crafting_recipe",
    {
      description:
        "Get crafting recipe requirements for an item and amount, including whether a crafting table is required.",
      inputSchema: {
        item: z.string().min(1),
        amount: z.number().int().min(1).max(256).default(1),
      },
    },
    async ({ item, amount }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const targetItem = resolveTargetItem(bot, item);

      if (!targetItem) {
        return {
          content: [{ type: "text", text: `No item found for query '${item}'.` }],
          isError: true,
        };
      }

      const recipes = bot.recipesAll(targetItem.id, null, true);

      if (recipes.length === 0) {
        return {
          content: [{ type: "text", text: `No crafting recipe found for '${targetItem.name}'.` }],
        };
      }

      const lines = recipes.slice(0, 10).map((recipe, index) => {
        const outputCount = getOutputCountForTarget(recipe as any, targetItem.id);
        const craftsNeeded = Math.max(1, Math.ceil(amount / outputCount));
        const reqs = scaleRequirements(getRecipeRequirements(recipe as any), craftsNeeded);
        const reqText = reqs.length > 0 ? reqs.map((req) => formatRequirement(bot, req)).join(", ") : "none";

        return `${index + 1}. ${targetItem.name} x${amount} -> requires: ${reqText}; crafting_table_required=${recipe.requiresTable ? "yes" : "no"}; output_per_craft=${outputCount}; crafts_needed=${craftsNeeded}`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
