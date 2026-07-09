export type SerializedItem = {
  id: number;
  name: string;
  count: number;
};

type ItemLike = {
  type: number;
  name?: string;
  count: number;
};

export function serializeItem(item: ItemLike | null | undefined): SerializedItem | null {
  if (!item) {
    return null;
  }

  return {
    id: item.type,
    name: item.name ?? `item_${item.type}`,
    count: item.count,
  };
}
