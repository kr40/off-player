// Browse filter state and its translation into TMDB /discover parameters.
// Pure (no network, no React) so every rule is unit-tested.
import type { MediaType } from "./api";

export type Sort = "popularity" | "rating" | "newest" | "oldest" | "votes" | "revenue" | "name";
export type Runtime = "short" | "mid" | "long";
export type Status = "ongoing" | "ended" | "mini";

export type BrowseFilters = {
  type: MediaType;
  anime: boolean;
  genres: number[];
  genreMode: "any" | "all";
  yearFrom: number | null;
  yearTo: number | null;
  rating: number | null; // minimum TMDB rating
  wellKnown: boolean;
  runtime: Runtime | null;
  language: string | null; // ISO 639-1
  status: Status | null; // series only
  providers: number[];
  keywords: { id: number; name: string }[];
  hideWatched: boolean;
  hideOwned: boolean;
  hideSaved: boolean;
  sort: Sort;
};

export const DEFAULT_FILTERS: BrowseFilters = {
  type: "movie",
  anime: false,
  genres: [],
  genreMode: "any",
  yearFrom: null,
  yearTo: null,
  rating: null,
  wellKnown: false,
  runtime: null,
  language: null,
  status: null,
  providers: [],
  keywords: [],
  hideWatched: false,
  hideOwned: false,
  hideSaved: false,
  sort: "popularity",
};

// News, Reality, Soap and Talk flood series lists unless asked for.
export const DAILIES = [10763, 10764, 10766, 10767];
/** Vote floors applied when ranking by rating, so a 10/10 from three votes doesn't lead. */
export const RATING_FLOOR: Record<MediaType, number> = { movie: 300, tv: 150 };
export const WELL_KNOWN: Record<MediaType, number> = { movie: 500, tv: 200 };

export const DECADES: { label: string; from: number | null; to: number }[] = [
  { label: "Before 1970", from: null, to: 1969 },
  { label: "70s", from: 1970, to: 1979 },
  { label: "80s", from: 1980, to: 1989 },
  { label: "90s", from: 1990, to: 1999 },
  { label: "2000s", from: 2000, to: 2009 },
  { label: "2010s", from: 2010, to: 2019 },
  { label: "2020s", from: 2020, to: 2029 },
];

const RUNTIMES: Record<MediaType, Record<Runtime, [number | null, number | null]>> = {
  movie: { short: [null, 89], mid: [90, 120], long: [121, null] },
  tv: { short: [null, 29], mid: [30, 60], long: [61, null] },
};
export const RUNTIME_LABEL: Record<MediaType, Record<Runtime, string>> = {
  movie: { short: "Under 90 min", mid: "90–120 min", long: "Over 2 hours" },
  tv: { short: "Under 30 min", mid: "30–60 min", long: "Over an hour" },
};

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** TMDB /discover/{type} parameters for a filter state. `today` is injectable for tests. */
export function toParams(f: BrowseFilters, region: string, today: Date = new Date()): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  const movie = f.type === "movie";
  const dateKey = movie ? "primary_release_date" : "first_air_date";

  const genres = f.anime ? [16, ...f.genres.filter((g) => g !== 16)] : f.genres;
  if (genres.length) {
    // Anime needs Animation AND the rest; "any" can't express that, so anime always matches all.
    p.with_genres = genres.join(f.genreMode === "all" || f.anime ? "," : "|");
  }
  if (f.anime) p.with_original_language = "ja";
  else if (f.language) p.with_original_language = f.language;

  if (!movie && !genres.some((g) => DAILIES.includes(g))) p.without_genres = DAILIES.join(",");

  if (f.yearFrom) p[`${dateKey}.gte`] = `${f.yearFrom}-01-01`;
  if (f.yearTo) p[`${dateKey}.lte`] = `${f.yearTo}-12-31`;

  let floor = f.wellKnown ? WELL_KNOWN[f.type] : 0;
  if (f.rating) {
    p["vote_average.gte"] = f.rating;
    floor = Math.max(floor, Math.round(RATING_FLOOR[f.type] / 3));
  }

  if (f.runtime) {
    const [lo, hi] = RUNTIMES[f.type][f.runtime];
    if (lo) p["with_runtime.gte"] = lo;
    if (hi) p["with_runtime.lte"] = hi;
  }

  if (!movie && f.status) {
    if (f.status === "ongoing") p.with_status = "0|2"; // returning, in production
    if (f.status === "ended") p.with_status = "3|4"; // ended, cancelled
    if (f.status === "mini") p.with_type = "2"; // miniseries
  }

  if (f.providers.length) {
    p.with_watch_providers = f.providers.join("|");
    p.watch_region = region;
    p.with_watch_monetization_types = "flatrate|free|ads";
  }
  if (f.keywords.length) p.with_keywords = f.keywords.map((k) => k.id).join("|");

  switch (f.sort) {
    case "popularity":
      p.sort_by = "popularity.desc";
      break;
    case "rating":
      p.sort_by = "vote_average.desc";
      floor = Math.max(floor, RATING_FLOOR[f.type]);
      break;
    case "newest":
      p.sort_by = `${dateKey}.desc`;
      // Without a cap, far-future announcements would come first.
      if (!f.yearTo || f.yearTo >= today.getFullYear()) p[`${dateKey}.lte`] = isoDate(today);
      floor = Math.max(floor, 5);
      break;
    case "oldest":
      p.sort_by = `${dateKey}.asc`;
      floor = Math.max(floor, 50);
      break;
    case "votes":
      p.sort_by = "vote_count.desc";
      break;
    case "revenue":
      p.sort_by = movie ? "revenue.desc" : "popularity.desc";
      break;
    case "name":
      p.sort_by = movie ? "title.asc" : "name.asc";
      floor = Math.max(floor, 50);
      break;
  }
  if (floor) p["vote_count.gte"] = floor;
  return p;
}

/** Sorts that make sense for the type (no box office for series). */
export const SORTS: { id: Sort; label: string; movieOnly?: boolean }[] = [
  { id: "popularity", label: "Popularity" },
  { id: "rating", label: "Rating" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "votes", label: "Most votes" },
  { id: "revenue", label: "Box office", movieOnly: true },
  { id: "name", label: "A–Z" },
];

/** Human labels for the active filters, each with a function that removes it. */
export function activeChips(f: BrowseFilters, names: { genre: (id: number) => string; language: (code: string) => string; provider: (id: number) => string }) {
  const chips: { key: string; label: string; clear: (f: BrowseFilters) => BrowseFilters }[] = [];
  for (const g of f.genres) chips.push({ key: `g${g}`, label: names.genre(g), clear: (x) => ({ ...x, genres: x.genres.filter((y) => y !== g) }) });
  if (f.yearFrom || f.yearTo) {
    const label = f.yearFrom && f.yearTo ? (f.yearFrom === f.yearTo ? `${f.yearFrom}` : `${f.yearFrom}–${f.yearTo}`) : f.yearFrom ? `From ${f.yearFrom}` : `Until ${f.yearTo}`;
    chips.push({ key: "year", label, clear: (x) => ({ ...x, yearFrom: null, yearTo: null }) });
  }
  if (f.rating) chips.push({ key: "rating", label: `Rated ${f.rating}+`, clear: (x) => ({ ...x, rating: null }) });
  if (f.wellKnown) chips.push({ key: "wk", label: "Well known", clear: (x) => ({ ...x, wellKnown: false }) });
  if (f.runtime) chips.push({ key: "rt", label: RUNTIME_LABEL[f.type][f.runtime], clear: (x) => ({ ...x, runtime: null }) });
  if (f.language && !f.anime) chips.push({ key: "lang", label: names.language(f.language), clear: (x) => ({ ...x, language: null }) });
  if (f.status && f.type === "tv")
    chips.push({ key: "st", label: f.status === "ongoing" ? "Ongoing" : f.status === "ended" ? "Ended" : "Miniseries", clear: (x) => ({ ...x, status: null }) });
  for (const id of f.providers) chips.push({ key: `p${id}`, label: names.provider(id), clear: (x) => ({ ...x, providers: x.providers.filter((y) => y !== id) }) });
  for (const k of f.keywords) chips.push({ key: `k${k.id}`, label: k.name, clear: (x) => ({ ...x, keywords: x.keywords.filter((y) => y.id !== k.id) }) });
  if (f.hideWatched) chips.push({ key: "hw", label: "Hiding watched", clear: (x) => ({ ...x, hideWatched: false }) });
  if (f.hideOwned) chips.push({ key: "ho", label: "Hiding owned", clear: (x) => ({ ...x, hideOwned: false }) });
  if (f.hideSaved) chips.push({ key: "hs", label: "Hiding saved", clear: (x) => ({ ...x, hideSaved: false }) });
  return chips;
}

/** Reset filters that don't apply when the type changes. */
export function switchType(f: BrowseFilters, type: MediaType, anime: boolean): BrowseFilters {
  const same = f.type === type;
  return {
    ...f,
    type,
    anime,
    genres: same ? f.genres : f.genres.filter((g) => [16, 35, 80, 99, 18, 10751, 9648, 37].includes(g)), // ids shared by both lists
    status: type === "tv" ? f.status : null,
    runtime: same ? f.runtime : null,
    sort: f.sort === "revenue" && type === "tv" ? "popularity" : f.sort,
    language: anime ? null : f.language,
  };
}

/** Saved state → filters, tolerating fields added in later versions. */
export function parseFilters(json: string | null): BrowseFilters {
  if (!json) return DEFAULT_FILTERS;
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(json) };
  } catch {
    return DEFAULT_FILTERS;
  }
}
