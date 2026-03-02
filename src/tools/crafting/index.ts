import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import { z } from "zod";
import { matchQuery } from "../shared/query-matcher.js";
import {
  formatRequirement,
  getInventoryCountsByItem,
  getOutputCountForTarget,
  getRecipeRequirements,
  scaleRequirements,
} from "../shared/crafting-recipe.js";

type RegistryItem = {
  id: number;
  name: string;
  displayName?: string;
};

type CraftCandidate = {
  recipe: any;
  craftsNeeded: number;
  missing: Array<{ id: number; count: number; metadata: number | null }>;
  missingTotal: number;
  outputCount: number;
};

const FUEL_ITEMS_PER_UNIT: Record<string, number> = {
  coal: 8,
  charcoal: 8,
  coal_block: 80,
  blaze_rod: 12,
  dried_kelp_block: 20,
  lava_bucket: 100,
  oak_planks: 1,
  spruce_planks: 1,
  birch_planks: 1,
  jungle_planks: 1,
  acacia_planks: 1,
  dark_oak_planks: 1,
  mangrove_planks: 1,
  cherry_planks: 1,
  bamboo_planks: 1,
  crimson_planks: 1,
  warped_planks: 1,
  oak_log: 1,
  spruce_log: 1,
  birch_log: 1,
  jungle_log: 1,
  acacia_log: 1,
  dark_oak_log: 1,
  mangrove_log: 1,
  cherry_log: 1,
  bamboo_block: 1,
  stick: 0.5,
};

const MINECRAFT_SMELT_TICKS_PER_ITEM = 200;
const TICK_DURATION_MS = 50;
const SMELT_PROGRESS_TIMEOUT_MS = MINECRAFT_SMELT_TICKS_PER_ITEM * TICK_DURATION_MS * 2;

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

function findNearbyCraftingTable(bot: mineflayer.Bot) {
  const craftingTableId = (bot.registry as any)?.blocksByName?.crafting_table?.id;

  if (typeof craftingTableId !== "number") {
    return null;
  }

  return bot.findBlock({
    maxDistance: 4,
    matching: (block) => block && block.type === craftingTableId,
  });
}

function buildCandidate(bot: mineflayer.Bot, recipe: any, amount: number, targetItemId: number): CraftCandidate {
  const outputCount = getOutputCountForTarget(recipe, targetItemId);
  const craftsNeeded = Math.max(1, Math.ceil(amount / outputCount));
  const requirements = scaleRequirements(getRecipeRequirements(recipe), craftsNeeded);
  const inventoryCounts = getInventoryCountsByItem(bot);

  const missing = requirements
    .map((req) => {
      const available = inventoryCounts.get(req.id) ?? 0;
      return {
        ...req,
        count: Math.max(0, req.count - available),
      };
    })
    .filter((req) => req.count > 0);

  const missingTotal = missing.reduce((sum, req) => sum + req.count, 0);

  return {
    recipe,
    craftsNeeded,
    missing,
    missingTotal,
    outputCount,
  };
}

function formatMissingList(bot: mineflayer.Bot, missing: Array<{ id: number; count: number; metadata: number | null }>) {
  if (missing.length === 0) {
    return "none";
  }

  return missing.map((entry) => formatRequirement(bot, entry)).join(", ");
}

function getFurnaceTypeIds(bot: mineflayer.Bot) {
  const blocksByName = (bot.registry as any)?.blocksByName ?? {};
  return ["furnace", "blast_furnace", "smoker"]
    .map((name) => blocksByName[name]?.id)
    .filter((id): id is number => typeof id === "number");
}

function findNearbyFurnaces(bot: mineflayer.Bot) {
  const candidates = getFurnaceTypeIds(bot);

  if (candidates.length === 0) {
    return [] as any[];
  }

  const positions = bot.findBlocks({
    maxDistance: 4,
    count: 20,
    point: bot.entity?.position,
    matching: (block) => Boolean(block && candidates.includes(block.type)),
  });

  return positions
    .map((pos) => bot.blockAt(pos))
    .filter((block): block is NonNullable<typeof block> => Boolean(block));
}

function isFurnaceBusy(furnace: any) {
  return Boolean(furnace.progress > 0 || furnace.inputItem?.() || furnace.outputItem?.());
}

function findFuelCandidate(
  bot: mineflayer.Bot,
  amount: number,
  fuelQuery?: string
): { item: { type: number; metadata?: number; name: string; count: number }; requiredFuelItems: number } | null {
  const items = bot.inventory.items() as Array<{ type: number; metadata?: number; name: string; count: number }>;

  const filtered = items.filter((item) => {
    if (fuelQuery && !matchQuery(fuelQuery, [{ name: item.name, id: item.type }])) {
      return false;
    }

    return (FUEL_ITEMS_PER_UNIT[item.name] ?? 0) > 0;
  });

  if (filtered.length === 0) {
    return null;
  }

  const ranked = filtered
    .map((item) => {
      const perFuel = FUEL_ITEMS_PER_UNIT[item.name] ?? 0;
      const requiredFuelItems = Math.ceil(amount / perFuel);
      return {
        item,
        perFuel,
        requiredFuelItems,
        isEnough: item.count >= requiredFuelItems,
      };
    })
    .sort((a, b) => {
      if (a.isEnough !== b.isEnough) {
        return a.isEnough ? -1 : 1;
      }
      if (a.requiredFuelItems !== b.requiredFuelItems) {
        return a.requiredFuelItems - b.requiredFuelItems;
      }
      return b.perFuel - a.perFuel;
    });

  const best = ranked[0];
  return {
    item: best.item,
    requiredFuelItems: best.requiredFuelItems,
  };
}

async function waitForSmeltingOutput(furnace: any, targetAmount: number, timeoutMs: number) {
  let collected = 0;
  let lastTakeAt = Date.now();

  while (collected < targetAmount) {
    if (Date.now() - lastTakeAt >= timeoutMs) {
      break;
    }

    const output = furnace.outputItem?.();

    if (output && output.count > 0) {
      const taken = await furnace.takeOutput();
      const takenCount = taken?.count ?? 0;
      if (takenCount > 0) {
        collected += takenCount;
        lastTakeAt = Date.now();
      }
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return collected;
}

export function registerCraftingTools(server: McpServer, getBot: () => mineflayer.Bot | null) {
  server.registerTool(
    "craft_item",
    {
      description:
        "Craft an item by name and amount. Uses inventory crafting or a nearby crafting table when available, and returns actionable error messages with missing resources.",
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
          content: [{ type: "text", text: `Unknown craft target: '${item}'.` }],
          isError: true,
        };
      }

      const nearbyTable = findNearbyCraftingTable(bot);
      const craftContext = nearbyTable ?? null;
      const craftContextForCraft = nearbyTable ?? undefined;

      const craftableNow = bot.recipesFor(targetItem.id, null, amount, craftContext);

      if (craftableNow.length > 0) {
        const candidateNow = craftableNow
          .map((recipe) => buildCandidate(bot, recipe, amount, targetItem.id))
          .sort((a, b) => a.craftsNeeded - b.craftsNeeded)[0];

        try {
          await bot.craft(candidateNow.recipe, candidateNow.craftsNeeded, craftContextForCraft);
          const craftedAmount = candidateNow.craftsNeeded * candidateNow.outputCount;

          return {
            content: [
              {
                type: "text",
                text: `Crafted ${targetItem.name} x${craftedAmount}${nearbyTable ? " using nearby crafting table" : " in inventory"}.`,
              },
            ],
          };
        } catch (error: unknown) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to craft '${targetItem.name}': ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }

      const allWithoutTable = bot.recipesAll(targetItem.id, null, null);
      const allWithTable = bot.recipesAll(targetItem.id, null, true);

      const bestWithoutTable = allWithoutTable
        .map((recipe) => buildCandidate(bot, recipe, amount, targetItem.id))
        .sort((a, b) => a.missingTotal - b.missingTotal)[0];

      const bestWithTable = allWithTable
        .map((recipe) => buildCandidate(bot, recipe, amount, targetItem.id))
        .sort((a, b) => a.missingTotal - b.missingTotal)[0];

      if (!bestWithoutTable && !bestWithTable) {
        return {
          content: [
            {
              type: "text",
              text: `No known recipe found for '${targetItem.name}'.`,
            },
          ],
          isError: true,
        };
      }

      const chosen = [bestWithoutTable, bestWithTable]
        .filter((candidate): candidate is CraftCandidate => Boolean(candidate))
        .sort((a, b) => a.missingTotal - b.missingTotal)[0];

      const needsTable = Boolean(chosen.recipe?.requiresTable);
      const missingText = formatMissingList(bot, chosen.missing);

      if (needsTable && !nearbyTable) {
        if (chosen.missing.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Cannot craft '${targetItem.name}' x${amount}: no crafting table in reach and missing resources: ${missingText}.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Cannot craft '${targetItem.name}' x${amount}: a crafting table in reach is required.`,
            },
          ],
          isError: true,
        };
      }

      if (chosen.missing.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot craft '${targetItem.name}' x${amount}: missing resources ${missingText}${
                needsTable && !nearbyTable ? " and a crafting table in reach" : ""
              }.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Cannot craft '${targetItem.name}' x${amount}: no craftable recipe is currently available.`,
          },
        ],
        isError: true,
      };
    }
  );

  server.registerTool(
    "smelt_item",
    {
      description:
        "Smelt an item in a nearby furnace-like block. Returns actionable errors for missing furnace, missing input resources, or missing fuel.",
      inputSchema: {
        item: z.string().min(1),
        amount: z.number().int().min(1).max(256).default(1),
        fuel_query: z.string().min(1).optional(),
      },
    },
    async ({ item, amount, fuel_query }) => {
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
          content: [{ type: "text", text: `Unknown smelt input item: '${item}'.` }],
          isError: true,
        };
      }

      const inputAvailable = (bot.inventory.items() as Array<{ type: number; count: number }>)
        .filter((entry) => entry.type === targetItem.id)
        .reduce((sum, entry) => sum + entry.count, 0);

      const missingInput = Math.max(0, amount - inputAvailable);
      const fuel = findFuelCandidate(bot, amount, fuel_query);
      const nearbyFurnaces = findNearbyFurnaces(bot);

      const issues: string[] = [];
      if (nearbyFurnaces.length === 0) {
        issues.push("no furnace in reach");
      }
      if (missingInput > 0) {
        issues.push(`missing resources: ${targetItem.name} x${missingInput}`);
      }
      if (!fuel) {
        issues.push(
          fuel_query
            ? `missing fuel matching '${fuel_query}'`
            : "missing usable fuel (for example: coal, charcoal, planks, logs, or sticks)"
        );
      } else if (fuel.item.count < fuel.requiredFuelItems) {
        issues.push(
          `missing fuel: ${fuel.item.name} x${Math.max(0, fuel.requiredFuelItems - fuel.item.count)}`
        );
      }

      if (issues.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot smelt '${targetItem.name}' x${amount}: ${issues.join("; ")}.`,
            },
          ],
          isError: true,
        };
      }

      const ensuredFuel = fuel!;

      let furnace: any = null;

      try {
        for (const candidate of nearbyFurnaces) {
          const opened = await bot.openFurnace(candidate);
          if (isFurnaceBusy(opened)) {
            opened.close?.();
            continue;
          }

          furnace = opened;
          break;
        }

        if (!furnace) {
          return {
            content: [
              {
                type: "text",
                text: "Cannot smelt right now: all nearby furnaces are in use. Use another furnace.",
              },
            ],
            isError: true,
          };
        }

        await furnace.putInput(targetItem.id, null, amount);
        await furnace.putFuel(
          ensuredFuel.item.type,
          ensuredFuel.item.metadata ?? null,
          ensuredFuel.requiredFuelItems
        );

        const collected = await waitForSmeltingOutput(furnace, amount, SMELT_PROGRESS_TIMEOUT_MS);

        if (collected < amount) {
          return {
            content: [
              {
                type: "text",
                text: `Smelting incomplete for '${targetItem.name}': produced ${collected}/${amount}. This usually means missing smelting recipe, not enough fuel, or timeout reached.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Smelted output from '${targetItem.name}' x${amount} using ${ensuredFuel.item.name} x${ensuredFuel.requiredFuelItems}.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to smelt '${targetItem.name}': ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      } finally {
        furnace?.close?.();
      }
    }
  );
}
