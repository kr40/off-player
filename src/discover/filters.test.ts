import { describe, expect, it } from "vitest";
import { activeChips, DAILIES, DEFAULT_FILTERS, parseFilters, switchType, toParams, type BrowseFilters } from "./filters";

const TODAY = new Date("2026-11-17T12:00:00");
const f = (o: Partial<BrowseFilters> = {}): BrowseFilters => ({ ...DEFAULT_FILTERS, ...o });
const p = (o: Partial<BrowseFilters> = {}) => toParams(f(o), "IN", TODAY);

describe("toParams", () => {
  it("defaults: popularity, no floor; series hide daily shows", () => {
    expect(p()).toEqual({ sort_by: "popularity.desc" });
    expect(p({ type: "tv" })).toEqual({ sort_by: "popularity.desc", without_genres: DAILIES.join(",") });
  });
  it("genres: pipe for any, comma for all", () => {
    expect(p({ genres: [28, 35] }).with_genres).toBe("28|35");
    expect(p({ genres: [28, 35], genreMode: "all" }).with_genres).toBe("28,35");
  });
  it("picking a daily genre keeps it for series", () => {
    expect(p({ type: "tv", genres: [10764] }).without_genres).toBeUndefined();
  });
  it("anime = animation AND Japanese, other genres ANDed", () => {
    const x = p({ anime: true, genres: [35, 10749] });
    expect(x.with_genres).toBe("16,35,10749");
    expect(x.with_original_language).toBe("ja");
    expect(p({ anime: true, language: "ko" }).with_original_language).toBe("ja");
  });
  it("years use the right date field", () => {
    expect(p({ yearFrom: 2021, yearTo: 2026 })).toMatchObject({ "primary_release_date.gte": "2021-01-01", "primary_release_date.lte": "2026-12-31" });
    expect(p({ type: "tv", yearFrom: 2021 })).toMatchObject({ "first_air_date.gte": "2021-01-01" });
  });
  it("rating sort adds a vote floor; a minimum rating adds a smaller one", () => {
    expect(p({ sort: "rating" })).toMatchObject({ sort_by: "vote_average.desc", "vote_count.gte": 300 });
    expect(p({ type: "tv", sort: "rating" })["vote_count.gte"]).toBe(150);
    expect(p({ rating: 8 })).toMatchObject({ "vote_average.gte": 8, "vote_count.gte": 100 });
    expect(p({ wellKnown: true })["vote_count.gte"]).toBe(500);
  });
  it("newest is capped at today so announcements don't lead", () => {
    expect(p({ sort: "newest" })).toMatchObject({ sort_by: "primary_release_date.desc", "primary_release_date.lte": "2026-11-17" });
    expect(p({ sort: "newest", yearTo: 1999 })["primary_release_date.lte"]).toBe("1999-12-31");
  });
  it("runtime per type", () => {
    expect(p({ runtime: "short" })).toMatchObject({ "with_runtime.lte": 89 });
    expect(p({ runtime: "mid", type: "tv" })).toMatchObject({ "with_runtime.gte": 30, "with_runtime.lte": 60 });
  });
  it("series status and miniseries", () => {
    expect(p({ type: "tv", status: "ended" }).with_status).toBe("3|4");
    expect(p({ type: "tv", status: "mini" }).with_type).toBe("2");
    expect(p({ type: "movie", status: "ended" }).with_status).toBeUndefined();
  });
  it("streaming services carry the region; themes are keyword ids", () => {
    expect(p({ providers: [8, 119] })).toMatchObject({ with_watch_providers: "8|119", watch_region: "IN" });
    expect(p({ keywords: [{ id: 10391, name: "mafia" }] }).with_keywords).toBe("10391");
  });
  it("scenario 1: ended crime series 2021–2026 rated 8+, by rating", () => {
    expect(p({ type: "tv", genres: [80], yearFrom: 2021, yearTo: 2026, status: "ended", rating: 8, sort: "rating" })).toEqual({
      with_genres: "80",
      without_genres: DAILIES.join(","),
      "first_air_date.gte": "2021-01-01",
      "first_air_date.lte": "2026-12-31",
      "vote_average.gte": 8,
      with_status: "3|4",
      sort_by: "vote_average.desc",
      "vote_count.gte": 150,
    });
  });
});

describe("filter helpers", () => {
  it("switching type keeps shared genres and drops series-only filters", () => {
    const s = switchType(f({ type: "tv", genres: [80, 10765], status: "ended", sort: "rating" }), "movie", false);
    expect(s.genres).toEqual([80]);
    expect(s.status).toBeNull();
    expect(switchType(f({ sort: "revenue" }), "tv", false).sort).toBe("popularity");
  });
  it("chips describe and clear each filter", () => {
    const x = f({ genres: [80], rating: 8, yearFrom: 2021, yearTo: 2026 });
    const chips = activeChips(x, { genre: () => "Crime", language: (c) => c, provider: () => "P" });
    expect(chips.map((c) => c.label)).toEqual(["Crime", "2021–2026", "Rated 8+"]);
    expect(chips[1].clear(x).yearFrom).toBeNull();
  });
  it("saved filter state round-trips and tolerates new fields", () => {
    const x = f({ genres: [18], sort: "rating" });
    expect(parseFilters(JSON.stringify(x))).toEqual(x);
    expect(parseFilters('{"sort":"rating"}')).toEqual(f({ sort: "rating" }));
    expect(parseFilters("not json")).toEqual(DEFAULT_FILTERS);
  });
});
