import { describe, expect, it } from "vitest";
import type { Item } from "../discover/api";
import { filterSaved, isComingSoon, sortSaved, sortWatched } from "./mylist";

const NOW = new Date("2026-11-17T12:00:00").getTime();
const it_ = (id: number, o: Partial<Item & { addedAt: number }> = {}) => ({
  type: "tv" as const, id, name: `T${id}`, date: "2020-01-01", year: 2020, poster: null, backdrop: null,
  overview: "", rating: null, votes: 0, genreIds: [], addedAt: id, ...o,
});

describe("My List", () => {
  const list = [
    it_(1, { name: "banana", date: "2027-03-01", rating: 7, addedAt: 3 }),
    it_(2, { name: "Apple", date: "2019-05-01", rating: 8.5, addedAt: 1, type: "movie" as never }),
    it_(3, { name: "cherry", date: null, rating: null, addedAt: 2 }),
  ];

  it("coming soon = future date or none yet", () => {
    expect(isComingSoon("2027-01-01", NOW)).toBe(true);
    expect(isComingSoon("2026-11-01", NOW)).toBe(false);
    expect(isComingSoon(null, NOW)).toBe(true);
  });
  it("filters by type and status together", () => {
    expect(filterSaved(list, "all", "soon", NOW).map((i) => i.id)).toEqual([1, 3]);
    expect(filterSaved(list, "all", "released", NOW).map((i) => i.id)).toEqual([2]);
    expect(filterSaved(list, "tv", "released", NOW)).toEqual([]);
    expect(filterSaved(list, "tv", "all", NOW).map((i) => i.id)).toEqual([1, 3]);
  });
  it("sorts by date added, release date, name and rating", () => {
    expect(sortSaved(list, "added").map((i) => i.id)).toEqual([1, 3, 2]);
    expect(sortSaved(list, "release").map((i) => i.id)).toEqual([1, 2, 3]);
    expect(sortSaved(list, "name").map((i) => i.id)).toEqual([2, 1, 3]);
    expect(sortSaved(list, "rating").map((i) => i.id)).toEqual([2, 1, 3]);
  });
  it("sorts the watched tab", () => {
    const w = [
      { ...it_(1, { name: "b" }), seenAt: 1, reaction: 1 as const },
      { ...it_(2, { name: "a" }), seenAt: 3, reaction: -1 as const },
      { ...it_(3, { name: "c" }), seenAt: 2, reaction: 2 as const },
    ];
    expect(sortWatched(w, "marked").map((i) => i.id)).toEqual([2, 3, 1]);
    expect(sortWatched(w, "name").map((i) => i.id)).toEqual([2, 1, 3]);
    expect(sortWatched(w, "reaction").map((i) => i.id)).toEqual([3, 1, 2]);
  });
});
