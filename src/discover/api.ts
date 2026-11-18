// TMDB browsing for things that are not in the library: trending, upcoming,
// popular, search and details. Needs the network; results are cached for the
// session so moving between pages doesn't refetch.
import { tmdb } from "../library/metadata";
import { CATEGORIES, type Category } from "./genres";
import { apiCached } from "./cache";

export { CATEGORIES, type Category };

export type MediaType = "tv" | "movie";

export type Item = {
  type: MediaType;
  id: number;
  name: string;
  date: string | null; // first air / release date, YYYY-MM-DD
  year: number | null;
  poster: string | null; // TMDB file paths
  posterLocal?: string | null; // cached copy on disk (watchlist, watched)
  backdrop: string | null;
  overview: string;
  rating: number | null;
  votes: number;
  genreIds: number[]; // TMDB genre ids (empty when unknown)
  lang?: string; // original language (ISO 639-1)
  imdbId?: string | null; // filled when known
};

const TTL = 30 * 60 * 1000;
const cache = new Map<string, { at: number; p: Promise<unknown> }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p as Promise<T>;
  const p = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), p });
  return p;
}
export const clearDiscoverCache = () => cache.clear();

export function toItem(raw: any, fallback?: MediaType): Item | null {
  const type: MediaType | undefined = raw.media_type === "tv" || raw.media_type === "movie" ? raw.media_type : fallback;
  if (!type || !raw.id) return null;
  const date: string | null = (type === "tv" ? raw.first_air_date : raw.release_date) || null;
  return {
    type,
    id: raw.id,
    name: (type === "tv" ? raw.name : raw.title) ?? raw.name ?? raw.title ?? "Untitled",
    date,
    year: date ? Number(date.slice(0, 4)) : null,
    poster: raw.poster_path ?? null,
    backdrop: raw.backdrop_path ?? null,
    overview: raw.overview ?? "",
    rating: raw.vote_count > 0 && raw.vote_average > 0 ? raw.vote_average : null,
    votes: raw.vote_count ?? 0,
    // List responses carry genre_ids; detail responses carry genres [{id, name}].
    genreIds: raw.genre_ids ?? (raw.genres ?? []).map((g: any) => g.id),
    lang: raw.original_language ?? undefined,
  };
}

/** Anime = animation (genre 16) originally in Japanese. */
export const ANIME_PARAMS = { with_genres: "16", with_original_language: "ja" } as const;
export const isAnime = (i: { genreIds: number[]; lang?: string }) => i.genreIds.includes(16) && i.lang === "ja";

export type Page = { items: Item[]; page: number; totalPages: number };

/** One page of /discover/{type}, without posterless or duplicate titles. */
export function discoverPage(type: MediaType, params: Record<string, string | number>, page = 1): Promise<Page> {
  const key = `/discover/${type}?${JSON.stringify(params)}&p=${page}`;
  return cached(key, async () => {
    const res = await tmdb<{ results: any[]; page: number; total_pages: number }>(`/discover/${type}`, {
      include_adult: "false",
      ...params,
      page,
    });
    return {
      items: (res.results ?? []).map((r) => toItem(r, type)).filter((i): i is Item => !!i && !!i.poster),
      page: res.page ?? page,
      totalPages: Math.min(res.total_pages ?? 1, 500),
    };
  });
}

/** One page of any TMDB list endpoint (top rated, trending…). */
export function listPage(path: string, params: Record<string, string | number>, type: MediaType | undefined, page = 1): Promise<Page> {
  const key = `${path}?${JSON.stringify(params)}&p=${page}`;
  return cached(key, async () => {
    const res = await tmdb<{ results: any[]; page: number; total_pages: number }>(path, { include_adult: "false", ...params, page });
    return {
      items: (res.results ?? []).map((r) => toItem(r, type)).filter((i): i is Item => !!i && !!i.poster),
      page: res.page ?? page,
      totalPages: Math.min(res.total_pages ?? 1, 500),
    };
  });
}

// ---------------------------------------------------------------------------
// Collections, people, external ids, keywords, providers

export type CollectionInfo = {
  id: number;
  name: string;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  parts: Item[]; // release order
};

const WEEK = 7 * 86_400_000;

export function collection(id: number): Promise<CollectionInfo> {
  return apiCached(`collection:${id}`, WEEK, async () => {
    const d = await tmdb<any>(`/collection/${id}`);
    const parts = (d.parts ?? [])
      .map((p: any) => toItem({ ...p, media_type: "movie" }, "movie"))
      .filter((i: Item | null): i is Item => !!i)
      .sort((a: Item, b: Item) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
    return { id: d.id, name: d.name, overview: d.overview ?? "", poster: d.poster_path ?? null, backdrop: d.backdrop_path ?? null, parts };
  });
}

export type CollectionHit = { id: number; name: string; poster: string | null; backdrop: string | null };
export function searchCollections(query: string): Promise<CollectionHit[]> {
  return cached(`/search/collection?${query}`, async () => {
    const res = await tmdb<{ results: any[] }>("/search/collection", { query, include_adult: "false" });
    return (res.results ?? []).map((c) => ({ id: c.id, name: c.name, poster: c.poster_path ?? null, backdrop: c.backdrop_path ?? null }));
  });
}

export type PersonHit = { id: number; name: string; photo: string | null; dept: string; knownFor: string[] };
export function searchPeople(query: string): Promise<PersonHit[]> {
  return cached(`/search/person?${query}`, async () => {
    const res = await tmdb<{ results: any[] }>("/search/person", { query, include_adult: "false" });
    return (res.results ?? [])
      // People without a photo are almost always obscure name matches.
      .filter((p) => p.profile_path)
      .map((p) => ({
        id: p.id,
        name: p.name,
        photo: p.profile_path ?? null,
        dept: p.known_for_department ?? "",
        knownFor: (p.known_for ?? []).map((k: any) => k.title ?? k.name).filter(Boolean).slice(0, 3),
      }));
  });
}

export type PersonDetail = {
  id: number;
  name: string;
  photo: string | null;
  bio: string;
  dept: string;
  born: string | null;
  place: string | null;
  acting: (Item & { role: string })[];
  making: (Item & { role: string })[];
};

export function person(id: number): Promise<PersonDetail> {
  return apiCached(`person:v2:${id}`, WEEK, async () => {
    const d = await tmdb<any>(`/person/${id}`, { append_to_response: "combined_credits" });
    const credit = (c: any) => {
      const it = toItem(c, c.media_type === "tv" ? "tv" : "movie");
      return it && it.poster ? { ...it, role: c.character || c.job || "" } : null;
    };
    const uniq = (xs: (Item & { role: string })[]) => {
      const m = new Map<string, Item & { role: string }>();
      for (const x of xs) {
        const k = `${x.type}:${x.id}`;
        const had = m.get(k);
        if (!had) m.set(k, x);
        else if (x.role && !had.role.includes(x.role)) had.role = `${had.role}, ${x.role}`;
      }
      return [...m.values()];
    };
    const byPop = (a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0);
    const cast = [...(d.combined_credits?.cast ?? [])].sort(byPop);
    const crew = [...(d.combined_credits?.crew ?? [])]
      .filter((c: any) => ["Director", "Creator", "Writer", "Screenplay", "Producer", "Executive Producer"].includes(c.job))
      .sort(byPop);
    return {
      id: d.id,
      name: d.name,
      photo: d.profile_path ?? null,
      bio: d.biography ?? "",
      dept: d.known_for_department ?? "",
      born: d.birthday ?? null,
      place: d.place_of_birth ?? null,
      // Talk shows, reality, news and award ceremonies (appearances as themselves) drown out real roles.
      acting: uniq(
        cast
          .filter((c: any) => !(c.genre_ids ?? []).some((g: number) => [10763, 10764, 10767].includes(g)))
          .filter((c: any) => !/^(self|himself|herself|themselves|host|narrator)\b/i.test(c.character ?? "") || c.media_type === "movie" && /narrator/i.test(c.character ?? ""))
          .map(credit)
          .filter(Boolean) as any,
      ),
      making: uniq(crew.map(credit).filter(Boolean) as any),
    };
  });
}

/** IMDb id for a TMDB title, or null when TMDB has none. */
export async function externalImdbId(type: MediaType, id: number): Promise<string | null> {
  const d = await tmdb<{ imdb_id?: string | null }>(`/${type}/${id}/external_ids`);
  return d.imdb_id || null;
}

/** TMDB title for an IMDb id, or null. */
export async function findByImdb(tconst: string): Promise<Item | null> {
  const d = await tmdb<{ movie_results: any[]; tv_results: any[] }>(`/find/${tconst}`, { external_source: "imdb_id" });
  const m = d.movie_results?.[0];
  if (m) return toItem(m, "movie");
  const t = d.tv_results?.[0];
  return t ? toItem(t, "tv") : null;
}

export type Keyword = { id: number; name: string };
export function searchKeywords(query: string): Promise<Keyword[]> {
  return cached(`/search/keyword?${query}`, async () => {
    const res = await tmdb<{ results: Keyword[] }>("/search/keyword", { query });
    return (res.results ?? []).slice(0, 12);
  });
}

export type WatchProvider = { id: number; name: string; logo: string | null; priority: number };
export function watchProviders(type: MediaType, region: string): Promise<WatchProvider[]> {
  return apiCached(`providers:${type}:${region}`, WEEK, async () => {
    const res = await tmdb<{ results: any[] }>(`/watch/providers/${type}`, { watch_region: region });
    return (res.results ?? [])
      .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path ?? null, priority: p.display_priorities?.[region] ?? p.display_priority ?? 999 }))
      .sort((a, b) => a.priority - b.priority);
  });
}

async function list(path: string, params: Record<string, string | number> = {}, type?: MediaType): Promise<Item[]> {
  const key = `${path}?${JSON.stringify(params)}`;
  return cached(key, async () => {
    const res = await tmdb<{ results: any[] }>(path, { include_adult: "false", ...params });
    const seen = new Set<string>();
    return (res.results ?? [])
      .map((r) => toItem(r, type))
      .filter((i): i is Item => !!i && !!i.poster && !seen.has(`${i.type}:${i.id}`) && !!seen.add(`${i.type}:${i.id}`));
  });
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n: number) => iso(new Date(Date.now() + n * 86400000));

// News, Reality, Soap and Talk shows otherwise flood TMDB's popularity lists.
const NO_DAILIES = "10763,10764,10766,10767";

export const lists = {
  trending: () => list("/trending/all/week"),
  upcomingTv: () =>
    list("/discover/tv", {
      "first_air_date.gte": inDays(1), "first_air_date.lte": inDays(240),
      sort_by: "popularity.desc", without_genres: NO_DAILIES,
    }, "tv"),
  upcomingMovies: () =>
    list("/discover/movie", {
      "primary_release_date.gte": inDays(1), "primary_release_date.lte": inDays(240), sort_by: "popularity.desc",
    }, "movie"),
  airingThisWeek: () =>
    list("/discover/tv", {
      "air_date.gte": inDays(0), "air_date.lte": inDays(7),
      sort_by: "popularity.desc", without_genres: NO_DAILIES, "vote_count.gte": 30,
    }, "tv"),
  popularTv: () => list("/trending/tv/week", {}, "tv"),
  topTv: () => list("/tv/top_rated", {}, "tv"),
  inCinemas: () => list("/movie/now_playing", {}, "movie"),
  popularMovies: () => list("/movie/popular", {}, "movie"),
  topMovies: () => list("/movie/top_rated", {}, "movie"),
  similar: (type: MediaType, id: number) => list(`/${type}/${id}/recommendations`, {}, type),
  /** Everything, or only series / movies when a filter is on. */
  search: (query: string, only?: MediaType) => list(only ? `/search/${only}` : "/search/multi", { query }, only),
};

// ---------------------------------------------------------------------------
// Categories (definitions live in genres.ts).

export type CategoryMode = "popular" | "top" | "new" | "soon";

/** Titles in a category: most popular, best rated, recent releases or coming soon. */
export function byCategory(cat: Category, type: MediaType, mode: CategoryMode): Promise<Item[]> {
  const ids = cat[type];
  if (!ids?.length) return Promise.resolve([]);
  const dateKey = type === "tv" ? "first_air_date" : "primary_release_date";
  const params: Record<string, string | number> = { with_genres: ids.join("|"), sort_by: "popularity.desc" };
  if (type === "tv") params.without_genres = NO_DAILIES;
  if (mode === "top") {
    params.sort_by = "vote_average.desc";
    params["vote_count.gte"] = type === "tv" ? 250 : 800;
  } else if (mode === "new") {
    params[`${dateKey}.gte`] = inDays(-150);
    params[`${dateKey}.lte`] = inDays(0);
  } else if (mode === "soon") {
    params[`${dateKey}.gte`] = inDays(1);
    params[`${dateKey}.lte`] = inDays(300);
  }
  return list(`/discover/${type}`, params, type);
}

export type Person = { id: number; name: string; role: string; photo: string | null };
export type Provider = { id: number; name: string; logo: string | null };
export type SeasonInfo = { number: number; name: string; episodes: number; year: number | null; poster: string | null };

export type Detail = Item & {
  logo: string | null;
  tagline: string;
  genres: string[];
  status: string;
  runtime: number | null; // minutes (movies)
  seasons: SeasonInfo[];
  endYear: number | null;
  nextEpisode: { season: number; episode: number; date: string; name: string } | null;
  trailer: string | null; // YouTube key
  cast: Person[];
  makers: string[]; // creators or directors
  similar: Item[];
  /** Where to watch, per country code. */
  providers: Record<string, { link: string; stream: Provider[]; buy: Provider[] }>;
  /** The TMDB movie collection it belongs to, if any. */
  collection: { id: number; name: string } | null;
  imdbId: string | null;
  lastAir: string | null; // series: last episode date
};

const uniq = <T extends { id: number }>(xs: T[]) => [...new Map(xs.map((x) => [x.id, x])).values()];

export function details(type: MediaType, id: number): Promise<Detail> {
  return cached(`detail:${type}:${id}`, async () => {
    const d = await tmdb<any>(`/${type}/${id}`, {
      append_to_response: `videos,recommendations,watch/providers,images,external_ids,${type === "tv" ? "aggregate_credits" : "credits"}`,
      include_image_language: "en,null",
    });
    const base = toItem(d, type)!;
    const vids: any[] = (d.videos?.results ?? []).filter((v: any) => v.site === "YouTube");
    const trailer =
      vids.find((v) => v.type === "Trailer" && v.official) ?? vids.find((v) => v.type === "Trailer") ?? vids.find((v) => v.type === "Teaser");
    const logos: any[] = (d.images?.logos ?? []).filter((l: any) => l.file_path?.endsWith(".png"));
    const logo = (logos.find((l) => l.iso_639_1 === "en") ?? logos[0])?.file_path ?? null;
    const castRaw: any[] = (type === "tv" ? d.aggregate_credits?.cast : d.credits?.cast) ?? [];
    const prov = (list: any[] | undefined): Provider[] =>
      (list ?? []).map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path ?? null }));
    const providers: Detail["providers"] = {};
    for (const [cc, v] of Object.entries<any>(d["watch/providers"]?.results ?? {})) {
      providers[cc] = {
        link: v.link,
        stream: uniq([...prov(v.flatrate), ...prov(v.free), ...prov(v.ads)]),
        buy: uniq([...prov(v.rent), ...prov(v.buy)]),
      };
    }
    const next = d.next_episode_to_air;
    return {
      ...base,
      logo,
      tagline: d.tagline ?? "",
      genres: (d.genres ?? []).map((g: any) => g.name),
      status: d.status ?? "",
      runtime: d.runtime || null,
      seasons: (d.seasons ?? [])
        .filter((s: any) => s.season_number > 0)
        .map((s: any) => ({
          number: s.season_number, name: s.name, episodes: s.episode_count ?? 0,
          year: s.air_date ? Number(s.air_date.slice(0, 4)) : null, poster: s.poster_path ?? null,
        })),
      endYear: type === "tv" && d.status === "Ended" && d.last_air_date ? Number(d.last_air_date.slice(0, 4)) : null,
      nextEpisode: next?.air_date
        ? { season: next.season_number, episode: next.episode_number, date: next.air_date, name: next.name ?? "" }
        : null,
      trailer: trailer?.key ?? null,
      cast: castRaw.slice(0, 14).map((c) => ({
        id: c.id, name: c.name, role: (type === "tv" ? c.roles?.[0]?.character : c.character) ?? "", photo: c.profile_path ?? null,
      })),
      makers:
        type === "tv"
          ? (d.created_by ?? []).map((p: any) => p.name)
          : (d.credits?.crew ?? []).filter((p: any) => p.job === "Director").map((p: any) => p.name),
      similar: (d.recommendations?.results ?? []).map((r: any) => toItem(r, type)).filter((i: Item | null): i is Item => !!i && !!i.poster),
      providers,
      collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name } : null,
      imdbId: d.imdb_id || d.external_ids?.imdb_id || null,
      lastAir: d.last_air_date ?? null,
    };
  });
}

/** "12 Dec" this year, "3 Mar 2027" otherwise. */
export function niceDate(date: string | null): string {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
export const isFuture = (date: string | null) => !!date && new Date(`${date}T00:00:00`).getTime() > Date.now();
