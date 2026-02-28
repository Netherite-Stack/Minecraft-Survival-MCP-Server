function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchQuery(
  query: string,
  candidates: Array<{ name: string; displayName?: string; id?: number }>
) {
  const q = query.trim().toLowerCase();

  if (!q || q === "*") {
    return true;
  }

  const numericId = Number(q);
  const hasNumericId = !Number.isNaN(numericId) && String(numericId) === q;

  if (hasNumericId && candidates.some((c) => c.id === numericId)) {
    return true;
  }

  if (q.includes("*")) {
    const regex = new RegExp(`^${q.split("*").map(escapeRegex).join(".*")}$`, "i");
    return candidates.some((c) => regex.test(c.name) || (c.displayName ? regex.test(c.displayName) : false));
  }

  return candidates.some((c) => {
    const byName = c.name.toLowerCase().includes(q);
    const byDisplayName = c.displayName ? c.displayName.toLowerCase().includes(q) : false;
    return byName || byDisplayName;
  });
}
