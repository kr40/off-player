import { describe, expect, it } from "vitest";
import type { Item, MediaType } from "./api";
import {
  deriveLibrarySeeds, diversify, forYou, keyOf, pickSeeds, rank, reasonText,
  type LibraryWatchRow, type Reaction, type Scored, type SeedInput,
} from "./recommend";

const item = (id: number, type: MediaType = "tv", extra: Partial<Item> = {}): Item => ({
  type, id, name: `T${id}`, date: "2020-01-01", year: 2020, poster: `/p${id}.jpg`, backdrop: null,
  overview: "", rating: null, votes: 0, genreIds: [], ...extra,
});
const seed = (id: number, extra: Partial<SeedInput> = {}): SeedInput => ({
  type: "tv", id, name: `Seed${id}`, source: "manual", reaction: 1, at: id, genreIds: [], ...extra,
});
const lists = (m: Record<number, Item[]>) => new Map(Object.entries(m).map(([id, l]) => [`tv:${id}`, l]));
const none = new Set<string>();

describe("pickSeeds", () => {
  it("puts loved first, then most recent, and caps at 40", () => {
    const inputs = Array.from({ length: 50 }, (_, i) => seed(i + 1, { at: i + 1 }));
    inputs[3].reaction = 2; // id 4, old
    const s = pickSeeds(inputs);
    expect(s).toHaveLength(40);
    expect(s[0].id).toBe(4);
    expect(s[1].id).toBe(50);
    expect(s.some((x) => x.id === 5)).toBe(false); // oldest fell off
  });
  it("weights by source and reaction", () => {
    const s = pickSeeds([
      seed(1, { reaction: 2 }),
      seed(2, { source: "progress" }),
      seed(3, { reaction: -1 }),
      seed(4, { source: "finished" }),
    ]);
    const w = Object.fromEntries(s.map((x) => [x.id, x.weight]));
    expect(w).toEqual({ 1: 2, 2: 0.6, 3: -1, 4: 1 });
  });
  it("prefers a manual mark over a library entry for the same title", () => {
    const s = pickSeeds([seed(1, { source: "progress", at: 9 }), seed(1, { source: "manual", reaction: 2, at: 1 })]);
    expect(s).toHaveLength(1);
    expect(s[0].weight).toBe(2);
  });
});

describe("rank", () => {
  it("orders by position in the seed's list", () => {
    const r = rank(pickSeeds([seed(1)]), lists({ 1: [item(10), item(11), item(12)] }), none);
    expect(r.map((x) => x.item.id)).toEqual([10, 11, 12]);
    expect(r[0].score).toBeCloseTo(1);
    expect(r[1].score).toBeCloseTo(1 / (1 + 1 / 8));
  });
  it("boosts titles recommended by several seeds and names both as reasons", () => {
    const r = rank(
      pickSeeds([seed(1), seed(2)]),
      lists({ 1: [item(10), item(20)], 2: [item(11), item(20)] }),
      none,
    );
    expect(r[0].item.id).toBe(20);
    expect(r[0].reasons.map((x) => x.name).sort()).toEqual(["Seed1", "Seed2"]);
    expect(reasonText(r[0].reasons)).toMatch(/^Because you watched Seed\d and Seed\d$/);
  });
  it("skips excluded titles", () => {
    const r = rank(pickSeeds([seed(1)]), lists({ 1: [item(10), item(11)] }), new Set(["tv:10"]));
    expect(r.map((x) => x.item.id)).toEqual([11]);
  });
  it("a 'Not for me' seed removes titles that only it recommends (C4)", () => {
    const l = lists({ 1: [item(30), item(10)], 2: [item(20), item(30)] });
    const before = rank(pickSeeds([seed(1), seed(2)]), l, none);
    expect(before.some((x) => x.item.id === 20)).toBe(true);
    const after = rank(pickSeeds([seed(1), seed(2, { reaction: -1 as Reaction })]), l, none);
    expect(after.some((x) => x.item.id === 20)).toBe(false); // only from the disliked seed: gone
    const shared = (s: Scored[]) => s.find((x) => x.item.id === 30)!.score;
    expect(shared(after)).toBeLessThan(shared(before)); // shared title: lowered
    // Even a well-rated title in a liked genre is not rescued by genre or rating.
    const good = item(40, "tv", { rating: 9, votes: 5000, genreIds: [18] });
    const r = rank(pickSeeds([seed(1, { genreIds: [18] }), seed(2, { reaction: -1 })]), lists({ 1: [item(10)], 2: [good] }), none);
    expect(r.some((x) => x.item.id === 40)).toBe(false);
  });
  it("adds genre affinity and quality on top", () => {
    const plain = item(10);
    const drama = item(11, "tv", { genreIds: [18] });
    const rated = item(12, "tv", { rating: 9, votes: 1000 });
    const fewVotes = item(13, "tv", { rating: 9, votes: 50 });
    const s = pickSeeds([seed(1, { genreIds: [18] }), seed(2), seed(3)]);
    const score = (it: Item) => rank(s, lists({ 1: [it] }), none)[0].score;
    expect(score(drama)).toBeCloseTo(score(plain) + 0.5);
    expect(score(rated)).toBeCloseTo(score(plain) + 0.3);
    expect(score(fewVotes)).toBeCloseTo(score(plain));
  });
  it("matches genres across series and movies", () => {
    // Seed is a sci-fi series (10765), candidate a sci-fi movie (878).
    const s = pickSeeds([seed(1, { genreIds: [10765] })]);
    const r = rank(s, lists({ 1: [item(10, "movie", { genreIds: [878] })] }), none);
    expect(r[0].score).toBeCloseTo(1.5);
  });
});

describe("diversify", () => {
  const scored = (id: number, type: MediaType, top = "tv:1"): Scored => ({ item: item(id, type), score: 100 - id, reasons: [], top });
  it("allows at most 3 in a row of one type while the other type remains", () => {
    const list = [1, 2, 3, 4, 5].map((i) => scored(i, "tv")).concat([scored(6, "movie"), scored(7, "movie")]);
    const out = diversify(list, 3, 99).map((s) => s.item.id);
    expect(out).toEqual([1, 2, 3, 6, 4, 5, 7]);
  });
  it("relaxes the run rule when only one type is left", () => {
    const out = diversify([1, 2, 3, 4, 5].map((i) => scored(i, "tv")), 3, 99);
    expect(out).toHaveLength(5);
  });
  it("caps cards that share the same strongest seed at 5", () => {
    const list = Array.from({ length: 8 }, (_, i) => scored(i + 1, i % 2 ? "tv" : "movie", "tv:1"))
      .concat([scored(20, "tv", "tv:2")]);
    const out = diversify(list);
    expect(out.filter((s) => s.top === "tv:1")).toHaveLength(5);
    expect(out.some((s) => s.item.id === 20)).toBe(true);
  });
});

describe("forYou", () => {
  const ex = (o: Partial<Record<"watched" | "library" | "dismissed" | "watchlist", string[]>> = {}) => ({
    watched: new Set(o.watched ?? []), library: new Set(o.library ?? []),
    dismissed: new Set(o.dismissed ?? []), watchlist: new Set(o.watchlist ?? []),
  });
  it("asks for more seeds below 3", () => {
    const r = forYou(pickSeeds([seed(1), seed(2)]), lists({ 1: [item(10)] }), ex());
    expect(r.status).toBe("few");
    expect(r.picks).toEqual([]);
  });
  it("excludes watched, library, dismissed and seeds; watchlist only from Top picks", () => {
    const big = (from: number) => Array.from({ length: 8 }, (_, i) => item(from + i));
    const s = pickSeeds([seed(1), seed(2), seed(3)]);
    const l = lists({ 1: [item(2), item(10), item(11), item(12), item(13), ...big(100)], 2: big(200), 3: big(300) });
    const r = forYou(s, l, ex({ watched: ["tv:10"], library: ["tv:11"], dismissed: ["tv:12"], watchlist: ["tv:13"] }));
    const ids = r.picks.map((p) => p.item.id);
    for (const gone of [2, 10, 11, 12, 13]) expect(ids).not.toContain(gone);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    const row1 = r.because.find((b) => b.seed.id === 1)!;
    expect(row1.items.map((i) => i.id)).toContain(13); // watchlist allowed here
    expect(row1.items.map((i) => i.id)).not.toContain(10);
  });
  it("builds 'Because you watched' rows from the three most recent seeds with weight ≥ 1", () => {
    const l = new Map<string, Item[]>();
    const inputs = [1, 2, 3, 4, 5].map((id) => seed(id, { at: id, source: id === 5 ? "progress" : "manual" }));
    for (const s of inputs) l.set(keyOf(s), Array.from({ length: 6 }, (_, i) => item(s.id * 100 + i)));
    const r = forYou(pickSeeds(inputs), l, ex());
    expect(r.because.map((b) => b.seed.id)).toEqual([4, 3, 2]); // 5 is in progress (0.6)
  });
});

describe("deriveLibrarySeeds", () => {
  const row = (o: Partial<LibraryWatchRow>): LibraryWatchRow => ({
    title_id: 1, kind: "show", tmdb_type: "tv", tmdb_id: 655, name: "Show", genres: '["Drama","Sci-Fi & Fantasy"]',
    owned: 10, watched: 0, last: 5, ...o,
  });
  it("finished series, in-progress thresholds, movies, and unmatched titles", () => {
    const s = deriveLibrarySeeds([
      row({ title_id: 1, watched: 10 }), // finished
      row({ title_id: 2, tmdb_id: 2, owned: 100, watched: 3 }), // ≥ 3 episodes
      row({ title_id: 3, tmdb_id: 3, owned: 5, watched: 1 }), // 20 %
      row({ title_id: 4, tmdb_id: 4, owned: 100, watched: 2 }), // not enough
      row({ title_id: 5, tmdb_id: 5, watched: 0 }), // nothing watched
      row({ title_id: 6, kind: "movie", tmdb_type: "movie", tmdb_id: 6, owned: 1, watched: 1 }),
      row({ title_id: 7, tmdb_id: null, watched: 10 }), // unmatched
    ]);
    expect(s.map((x) => [x.titleId, x.source])).toEqual([[1, "finished"], [2, "progress"], [3, "progress"], [6, "finished"]]);
    expect(s[0].genreIds).toEqual([18, 10765]);
  });
  it("drops a finished series back when an episode is marked unwatched", () => {
    expect(deriveLibrarySeeds([row({ owned: 4, watched: 4 })])[0].source).toBe("finished");
    expect(deriveLibrarySeeds([row({ owned: 4, watched: 3 })])[0].source).toBe("progress");
    expect(deriveLibrarySeeds([row({ owned: 40, watched: 2 })])).toEqual([]);
  });
});
