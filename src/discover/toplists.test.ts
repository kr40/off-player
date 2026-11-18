import { describe, expect, it } from "vitest";
import { pagesFor, TOP_LISTS } from "./toplists";
import { KEYWORDS } from "./keywords";

describe("Top List definitions", () => {
  it("have unique ids, a size and a TMDB source", () => {
    const ids = TOP_LISTS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of TOP_LISTS) {
      expect([50, 100, 250]).toContain(l.size);
      expect(l.tmdb.path || Object.keys(l.tmdb.params).length).toBeTruthy();
      expect(l.title.length).toBeGreaterThan(3);
    }
  });
  it("rank by rating always with a vote floor", () => {
    for (const l of TOP_LISTS.filter((x) => x.tmdb.params.sort_by === "vote_average.desc")) {
      expect(Number(l.tmdb.params["vote_count.gte"])).toBeGreaterThan(0);
    }
  });
  it("theme lists have resolved keyword ids", () => {
    for (const [k, ids] of Object.entries(KEYWORDS)) expect(ids.length, k).toBeGreaterThan(0);
    for (const l of TOP_LISTS.filter((x) => x.group === "theme")) expect(String(l.tmdb.params.with_keywords)).toMatch(/^\d+(\|\d+)*$/);
  });
  it("a 250 list is 13 pages", () => {
    expect(pagesFor(TOP_LISTS.find((l) => l.id === "top-movies")!)).toBe(13);
  });
  it("anime lists are Japanese animation", () => {
    for (const l of TOP_LISTS.filter((x) => x.anime && !x.tmdb.path)) {
      expect(l.tmdb.params.with_genres).toBe("16");
      expect(l.tmdb.params.with_original_language).toBe("ja");
    }
  });
});
