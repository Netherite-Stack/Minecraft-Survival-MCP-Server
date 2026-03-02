import type mineflayer from "mineflayer";

type RecipeItemLike = {
  id: number;
  metadata: number | null;
  count: number;
};

type RecipeLike = {
  result?: RecipeItemLike;
  ingredients?: RecipeItemLike[];
  inShape?: Array<Array<RecipeItemLike | null>>;
  delta?: RecipeItemLike[];
  requiresTable?: boolean;
};

export type CraftRequirement = {
  id: number;
  metadata: number | null;
  count: number;
};

export function getOutputCountForTarget(recipe: RecipeLike, targetItemId: number) {
  if (recipe.result?.id === targetItemId) {
    return Math.max(1, recipe.result.count || 1);
  }

  const fromDelta = (recipe.delta ?? [])
    .filter((entry) => entry.id === targetItemId && entry.count > 0)
    .reduce((sum, entry) => sum + entry.count, 0);

  return Math.max(1, fromDelta || 1);
}

function addRequirement(map: Map<string, CraftRequirement>, item: RecipeItemLike) {
  if (!item || item.id == null || item.count == null || item.count <= 0) {
    return;
  }

  const metadata = item.metadata ?? null;
  const key = `${item.id}:${metadata ?? "*"}`;
  const existing = map.get(key);

  if (existing) {
    existing.count += item.count;
    return;
  }

  map.set(key, {
    id: item.id,
    metadata,
    count: item.count,
  });
}

export function getRecipeRequirements(recipe: RecipeLike) {
  const requirements = new Map<string, CraftRequirement>();

  if (Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
    for (const item of recipe.ingredients) {
      addRequirement(requirements, item);
    }
    return Array.from(requirements.values());
  }

  if (Array.isArray(recipe.inShape) && recipe.inShape.length > 0) {
    for (const row of recipe.inShape) {
      for (const item of row ?? []) {
        if (item) {
          addRequirement(requirements, item);
        }
      }
    }
    return Array.from(requirements.values());
  }

  if (Array.isArray(recipe.delta) && recipe.delta.length > 0) {
    for (const item of recipe.delta) {
      if (item.count < 0) {
        addRequirement(requirements, {
          ...item,
          count: Math.abs(item.count),
        });
      }
    }
  }

  return Array.from(requirements.values());
}

export function scaleRequirements(requirements: CraftRequirement[], multiplier: number) {
  return requirements.map((req) => ({
    ...req,
    count: req.count * multiplier,
  }));
}

export function getInventoryCountsByItem(bot: mineflayer.Bot) {
  const items = bot.inventory.items() as Array<{ type: number; count: number }>;
  const counts = new Map<number, number>();

  for (const item of items) {
    counts.set(item.type, (counts.get(item.type) ?? 0) + item.count);
  }

  return counts;
}

export function formatRequirement(bot: mineflayer.Bot, req: CraftRequirement) {
  const item = (bot.registry as any)?.items?.[req.id] as { name?: string } | undefined;
  const name = item?.name ?? `item_${req.id}`;
  return `${name} x${req.count}`;
}
