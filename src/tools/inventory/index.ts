import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type mineflayer from "mineflayer";
import { z } from "zod";
import { matchQuery } from "../shared/query-matcher.js";

type InventoryItem = {
  name: string;
  displayName?: string;
  type: number;
  metadata?: number;
  count: number;
};

function getItemName(item: { type: number; name?: string }, bot: mineflayer.Bot) {
  const byId = (bot.registry as any)?.items?.[item.type] as { name?: string } | undefined;
  return item.name ?? byId?.name ?? `item_${item.type}`;
}

function findNearbyChest(bot: mineflayer.Bot) {
  const blocksByName = (bot.registry as any)?.blocksByName ?? {};
  const chestId = blocksByName.chest?.id;
  const trappedChestId = blocksByName.trapped_chest?.id;
  const validIds = [chestId, trappedChestId].filter((id): id is number => typeof id === "number");

  if (validIds.length === 0) {
    return null;
  }

  return bot.findBlock({
    maxDistance: 4,
    matching: (block) => Boolean(block && validIds.includes(block.type)),
  });
}

function getPlayerInventorySlots(bot: mineflayer.Bot) {
  const inventory = bot.inventory as unknown as {
    slots?: Array<InventoryItem | null>;
    inventoryStart?: number;
    inventoryEnd?: number;
  };

  const slots = inventory.slots ?? [];
  const start = inventory.inventoryStart;
  const end = inventory.inventoryEnd;

  if (typeof start !== "number" || typeof end !== "number" || start < 0 || end < start) {
    return slots;
  }

  return slots.slice(start, end + 1);
}

export function registerInventoryTools(server: McpServer, getBot: () => mineflayer.Bot | null) {
  server.registerTool(
    "get_inventory_contents",
    {
      description: "List the bot inventory contents with item names and counts.",
    },
    async () => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const items = (bot.inventory.items() as InventoryItem[]).slice();

      if (items.length === 0) {
        return {
          content: [{ type: "text", text: "Inventory is empty." }],
        };
      }

      const totalItems = items.reduce((sum, item) => sum + item.count, 0);
      const lines = items
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item, index) => `${index + 1}. ${item.name} x${item.count}`);

      return {
        content: [
          {
            type: "text",
            text: `Inventory contains ${items.length} stack(s), ${totalItems} item(s):\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_inventory_status",
    {
      description: "Get inventory slot usage (used/free/total slots).",
    },
    async () => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const slots = getPlayerInventorySlots(bot);
      const total = slots.length;
      const used = slots.filter((slot) => Boolean(slot)).length;
      const free = total - used;

      return {
        content: [
          {
            type: "text",
            text: `Inventory slots: used=${used}, free=${free}, total=${total}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "drop_inventory_item",
    {
      description:
        "Drop an item from inventory by name/query and amount. Returns clear errors when item is missing or amount is too high.",
      inputSchema: {
        query: z.string().min(1),
        count: z.number().int().min(1).default(1),
      },
    },
    async ({ query, count }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const items = bot.inventory.items() as InventoryItem[];
      const matching = items.filter((item) =>
        matchQuery(query, [
          {
            name: item.name,
            displayName: item.displayName,
            id: item.type,
          },
        ])
      );

      if (matching.length === 0) {
        const preview = items.slice(0, 10).map((item) => item.name);
        return {
          content: [
            {
              type: "text",
              text:
                preview.length > 0
                  ? `Cannot drop '${query}': item not found in inventory. Available examples: ${preview.join(", ")}`
                  : `Cannot drop '${query}': inventory is empty.`,
            },
          ],
          isError: true,
        };
      }

      const available = matching.reduce((sum, item) => sum + item.count, 0);

      if (count > available) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot drop ${count} of '${query}': only ${available} available in inventory.`,
            },
          ],
          isError: true,
        };
      }

      try {
        let remaining = count;

        for (const stack of matching) {
          if (remaining <= 0) {
            break;
          }

          const dropFromStack = Math.min(remaining, stack.count);
          await bot.toss(stack.type, stack.metadata ?? null, dropFromStack);
          remaining -= dropFromStack;
        }

        return {
          content: [
            {
              type: "text",
              text: `Dropped ${count} of '${query}'.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to drop '${query}': ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "put_item_in_chest",
    {
      description:
        "Put an item from inventory into the nearest chest in reach (within 4 blocks). Returns clear errors when chest/item is missing or amount is too high.",
      inputSchema: {
        query: z.string().min(1),
        count: z.number().int().min(1).default(1),
      },
    },
    async ({ query, count }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const chestBlock = findNearbyChest(bot);

      if (!chestBlock) {
        return {
          content: [{ type: "text", text: "No chest in reach. Move closer to a chest first." }],
          isError: true,
        };
      }

      const items = bot.inventory.items() as InventoryItem[];
      const matching = items.filter((item) =>
        matchQuery(query, [
          {
            name: item.name,
            displayName: item.displayName,
            id: item.type,
          },
        ])
      );

      if (matching.length === 0) {
        const preview = items.slice(0, 10).map((item) => item.name);
        return {
          content: [
            {
              type: "text",
              text:
                preview.length > 0
                  ? `Cannot put '${query}' into chest: item not found in inventory. Available examples: ${preview.join(", ")}`
                  : `Cannot put '${query}' into chest: inventory is empty.`,
            },
          ],
          isError: true,
        };
      }

      const available = matching.reduce((sum, item) => sum + item.count, 0);

      if (count > available) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot put ${count} of '${query}' into chest: only ${available} available in inventory.`,
            },
          ],
          isError: true,
        };
      }

      let chest: any = null;

      try {
        chest = await bot.openChest(chestBlock);
        let remaining = count;

        for (const stack of matching) {
          if (remaining <= 0) {
            break;
          }

          const toDeposit = Math.min(remaining, stack.count);
          await chest.deposit(stack.type, stack.metadata ?? null, toDeposit);
          remaining -= toDeposit;
        }

        return {
          content: [
            {
              type: "text",
              text: `Put ${count} of '${query}' into chest.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to put '${query}' into chest: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      } finally {
        chest?.close?.();
      }
    }
  );

  server.registerTool(
    "get_chest_contents",
    {
      description: "List the nearest chest contents (within 4 blocks) with item names and counts.",
    },
    async () => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const chestBlock = findNearbyChest(bot);

      if (!chestBlock) {
        return {
          content: [{ type: "text", text: "No chest in reach. Move closer to a chest first." }],
          isError: true,
        };
      }

      let chest: any = null;

      try {
        chest = await bot.openChest(chestBlock);
        const items = (chest.containerItems() as Array<{ type: number; count: number; name?: string }>).slice();

        if (items.length === 0) {
          return {
            content: [{ type: "text", text: "Chest is empty." }],
          };
        }

        const totalItems = items.reduce((sum, item) => sum + item.count, 0);
        const lines = items
          .sort((a, b) => getItemName(a, bot).localeCompare(getItemName(b, bot)))
          .map((item, index) => `${index + 1}. ${getItemName(item, bot)} x${item.count}`);

        return {
          content: [
            {
              type: "text",
              text: `Chest contains ${items.length} stack(s), ${totalItems} item(s):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed reading chest contents: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      } finally {
        chest?.close?.();
      }
    }
  );

  server.registerTool(
    "get_chest_status",
    {
      description: "Get nearest chest slot usage (used/free/total slots) within 4 blocks.",
    },
    async () => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const chestBlock = findNearbyChest(bot);

      if (!chestBlock) {
        return {
          content: [{ type: "text", text: "No chest in reach. Move closer to a chest first." }],
          isError: true,
        };
      }

      let chest: any = null;

      try {
        chest = await bot.openChest(chestBlock);
        const total = Math.max(0, Number(chest.inventoryStart ?? 0));
        const containerSlots = (chest.slots ?? []).slice(0, total);
        const used = containerSlots.filter((slot: unknown) => Boolean(slot)).length;
        const free = Math.max(0, total - used);

        return {
          content: [
            {
              type: "text",
              text: `Chest slots: used=${used}, free=${free}, total=${total}`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed reading chest status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      } finally {
        chest?.close?.();
      }
    }
  );

  server.registerTool(
    "take_item_from_chest",
    {
      description:
        "Take an item from the nearest chest in reach (within 4 blocks) into inventory. Returns clear errors when chest/item is missing or amount is too high.",
      inputSchema: {
        query: z.string().min(1),
        count: z.number().int().min(1).default(1),
      },
    },
    async ({ query, count }) => {
      const bot = getBot();

      if (!bot) {
        return {
          content: [{ type: "text", text: "Bot is not connected yet." }],
          isError: true,
        };
      }

      const chestBlock = findNearbyChest(bot);

      if (!chestBlock) {
        return {
          content: [{ type: "text", text: "No chest in reach. Move closer to a chest first." }],
          isError: true,
        };
      }

      let chest: any = null;

      try {
        chest = await bot.openChest(chestBlock);
        const chestItems = (chest.containerItems() as Array<{
          type: number;
          metadata?: number;
          count: number;
          name?: string;
        }>).slice();

        const matching = chestItems.filter((item) =>
          matchQuery(query, [
            {
              name: getItemName(item, bot),
              id: item.type,
            },
          ])
        );

        if (matching.length === 0) {
          const preview = chestItems.slice(0, 10).map((item) => getItemName(item, bot));
          return {
            content: [
              {
                type: "text",
                text:
                  preview.length > 0
                    ? `Cannot take '${query}' from chest: item not found. Chest examples: ${preview.join(", ")}`
                    : "Cannot take item from chest: chest is empty.",
              },
            ],
            isError: true,
          };
        }

        const available = matching.reduce((sum, item) => sum + item.count, 0);

        if (count > available) {
          return {
            content: [
              {
                type: "text",
                text: `Cannot take ${count} of '${query}' from chest: only ${available} available.`,
              },
            ],
            isError: true,
          };
        }

        let remaining = count;

        for (const stack of matching) {
          if (remaining <= 0) {
            break;
          }

          const toWithdraw = Math.min(remaining, stack.count);
          await chest.withdraw(stack.type, stack.metadata ?? null, toWithdraw);
          remaining -= toWithdraw;
        }

        return {
          content: [
            {
              type: "text",
              text: `Took ${count} of '${query}' from chest.`,
            },
          ],
        };
      } catch (error: unknown) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to take '${query}' from chest: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      } finally {
        chest?.close?.();
      }
    }
  );
}
