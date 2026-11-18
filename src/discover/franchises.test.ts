import { describe, expect, it } from "vitest";
import { FRANCHISES, inOrder, nextUpIndex, ordersOf, progress, releaseOrder, validate, type FEntry, type Franchise } from "./franchises";

const e = (ref: string, date: string | null, o: Partial<FEntry> = {}): FEntry => ({
  ref, type: "movie", id: ref.charCodeAt(0), title: ref, year: date ? Number(date.slice(0, 4)) : null, date, poster: null, backdrop: null, ...o,
});
const fr = (entries: FEntry[], story: string[]): Franchise => ({
  key: "t", name: "T", blurb: "", group: "film", sources: ["https://example.org"], backdrop: null, entries, orders: [{ id: "story", label: "Story order", refs: story }],
});

describe("franchise ordering", () => {
  const f = fr([e("b", "2024-03-01"), e("a", "2021-10-22"), e("p", "2024-11-17", { type: "tv" }), e("x", null)], ["p", "a", "b", "x"]);
  it("release order is by date, undated last", () => {
    expect(releaseOrder(f.entries)).toEqual(["a", "b", "p", "x"]);
  });
  it("orders always start with release order and keep every entry", () => {
    expect(ordersOf(f).map((o) => o.id)).toEqual(["release", "story"]);
    expect(inOrder(f, "story").map((x) => x.ref)).toEqual(["p", "a", "b", "x"]);
    expect(inOrder(f, "nope").map((x) => x.ref)).toEqual(["a", "b", "p", "x"]);
  });
  it("next up is the first released, unwatched entry", () => {
    const s = (w: boolean, r = true) => ({ watched: w, released: r });
    expect(nextUpIndex([s(true), s(false), s(false)])).toBe(1);
    expect(nextUpIndex([s(true), s(false, false), s(false)])).toBe(2);
    expect(nextUpIndex([s(true), s(true), s(false, false)])).toBe(-1);
    expect(progress([s(true), s(false), s(false, false)])).toEqual({ watched: 1, total: 2 });
  });
  it("validation catches orders that drop or repeat entries, and missing sources", () => {
    expect(validate(f)).toEqual([]);
    expect(validate(fr(f.entries, ["p", "a", "b"]))[0]).toMatch(/permutation/);
    expect(validate({ ...f, sources: [] })[0]).toMatch(/source/);
    expect(validate({ ...f, sources: [], orders: [] })).toEqual([]); // release order only needs no source
  });
});

describe("built franchise data", () => {
  it("every franchise is valid, sourced, and has resolved entries", () => {
    for (const f of FRANCHISES) {
      expect(validate(f), f.key).toEqual([]);
      for (const x of f.entries) expect(x.id, `${f.key}/${x.ref}`).toBeGreaterThan(0);
    }
  });
  it("at least 25 franchises ship", () => {
    expect(FRANCHISES.length).toBeGreaterThanOrEqual(25);
  });
  it("release order is ascending by date", () => {
    for (const f of FRANCHISES) {
      const dates = inOrder(f, "release").map((x) => x.date ?? "9999");
      expect([...dates].sort(), f.key).toEqual(dates);
    }
  });
});
