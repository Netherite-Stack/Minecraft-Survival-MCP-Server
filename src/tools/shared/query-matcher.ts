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

  const terms = q
    .split(/[|,]/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

  const queryTerms = terms.length > 0 ? terms : [q];

  return queryTerms.some((term) => {
    const numericId = Number(term);
    const hasNumericId = !Number.isNaN(numericId) && String(numericId) === term;

    if (hasNumericId && candidates.some((c) => c.id === numericId)) {
      return true;
    }

    if (term.includes("*")) {
      const regex = new RegExp(`^${term.split("*").map(escapeRegex).join(".*")}$`, "i");
      return candidates.some(
        (c) => regex.test(c.name) || (c.displayName ? regex.test(c.displayName) : false)
      );
    }

    return candidates.some((c) => {
      const byName = c.name.toLowerCase().includes(term);
      const byDisplayName = c.displayName ? c.displayName.toLowerCase().includes(term) : false;
      return byName || byDisplayName;
    });
  });
}
