import { describe, expect, it } from "vitest";
import { matchQuery } from "./query-matcher.js";

describe("matchQuery", () => {
  const candidates = [
    { name: "gold_ore", displayName: "Gold Ore", id: 42 },
    { name: "deepslate_gold_ore", displayName: "Deepslate Gold Ore", id: 43 },
  ];

  it("supports OR terms split by comma", () => {
    expect(matchQuery("gold_ore,deepslate_gold_ore", candidates)).toBe(true);
  });

  it("supports OR terms split by pipe", () => {
    expect(matchQuery("coal_ore|deepslate_gold_ore", candidates)).toBe(true);
  });

  it("supports wildcard matching", () => {
    expect(matchQuery("*gold*", candidates)).toBe(true);
  });
});
