// Every Top List is defined here and nowhere else (PRD 2.0 §7.2).
// Ranking is TMDB's rating with a vote floor, or (when IMDb data is installed
// and the list has an `imdb` definition) IMDb's weighted rating.
import { CATEGORIES } from "./genres";
import { KEYWORDS } from "./keywords";
import { DAILIES, isoDate } from "./filters";

export type ListGroup = "essentials" | "genre" | "era" | "theme" | "world" | "short" | "gems";

export type TopList = {
  id: string;
  group: ListGroup;
  title: string;
  blurb: string;
  type: "movie" | "tv";
  anime?: boolean;
  size: 50 | 100 | 250;
  /** TMDB source: a list endpoint, or /discover with these parameters. */
  tmdb: { path?: string; params: Record<string, string | number> };
  /** IMDb ranking, when IMDb data is installed. */
  imdb?: { kind: "movie" | "series"; genres?: string[]; yearFrom?: number; yearTo?: number; minVotes: number };
};

export const GROUPS: { id: ListGroup; title: string; blurb: string }[] = [
  { id: "essentials", title: "The essentials", blurb: "The best-rated and most-watched of all time." },
  { id: "genre", title: "By genre", blurb: "The top 100 in each genre." },
  { id: "era", title: "By era", blurb: "The best of every decade." },
  { id: "theme", title: "By theme", blurb: "Mafia, heists, time travel and more." },
  { id: "world", title: "Around the world", blurb: "Top films and series by country and language." },
  { id: "short", title: "Short on time", blurb: "Great things that don't take a weekend." },
  { id: "gems", title: "Hidden gems", blurb: "Rated highly by the few who found them." },
];

const T = (type: "movie" | "tv") => (type === "movie" ? "Movies" : "Series");
const t = (type: "movie" | "tv") => (type === "movie" ? "movies" : "series");
const noDailies = { without_genres: DAILIES.join(",") };
const rated = (type: "movie" | "tv", floor: number, extra: Record<string, string | number> = {}) => ({
  params: { sort_by: "vote_average.desc", "vote_count.gte": floor, ...(type === "tv" ? noDailies : {}), ...extra },
});
const dateKey = (type: "movie" | "tv") => (type === "movie" ? "primary_release_date" : "first_air_date");

// IMDb genre names for each category (IMDb uses its own genre list).
const IMDB_GENRES: Record<string, string[]> = {
  "Action & Adventure": ["Action", "Adventure"],
  Animation: ["Animation"],
  Comedy: ["Comedy"],
  Crime: ["Crime"],
  Documentary: ["Documentary"],
  Drama: ["Drama"],
  "Family & Kids": ["Family"],
  "Fantasy & Sci-Fi": ["Fantasy", "Sci-Fi"],
  History: ["History"],
  Horror: ["Horror"],
  Music: ["Music", "Musical"],
  Mystery: ["Mystery"],
  Romance: ["Romance"],
  Thriller: ["Thriller"],
  War: ["War"],
  Western: ["Western"],
};

const lists: TopList[] = [];
const add = (l: TopList) => lists.push(l);

// --- Essentials --------------------------------------------------------------
// New releases enter the all-time lists once their ratings have settled (early votes run high).
const settled = (type: "movie" | "tv") => ({ [`${dateKey(type)}.lte`]: isoDate(new Date(Date.now() - 120 * 86_400_000)) });
add({ id: "top-movies", group: "essentials", title: "Top 250 movies", blurb: "The highest-rated films of all time.", type: "movie", size: 250, tmdb: rated("movie", 5000, settled("movie")), imdb: { kind: "movie", minVotes: 25000 } });
add({ id: "top-series", group: "essentials", title: "Top 250 series", blurb: "The highest-rated TV of all time.", type: "tv", size: 250, tmdb: rated("tv", 1500, settled("tv")), imdb: { kind: "series", minVotes: 25000 } });
add({ id: "top-anime-series", group: "essentials", title: "Top 100 anime series", blurb: "The best-rated Japanese animated series.", type: "tv", anime: true, size: 100, tmdb: rated("tv", 150, { with_genres: "16", with_original_language: "ja" }) });
add({ id: "top-anime-movies", group: "essentials", title: "Top 50 anime movies", blurb: "The best-rated Japanese animated films.", type: "movie", anime: true, size: 50, tmdb: rated("movie", 300, { with_genres: "16", with_original_language: "ja" }) });
add({ id: "popular-movies-week", group: "essentials", title: "Popular movies this week", blurb: "What everyone is watching right now.", type: "movie", size: 100, tmdb: { path: "/trending/movie/week", params: {} } });
add({ id: "popular-series-week", group: "essentials", title: "Popular series this week", blurb: "The shows people can't stop talking about.", type: "tv", size: 100, tmdb: { path: "/trending/tv/week", params: {} } });
add({ id: "popular-anime-now", group: "essentials", title: "Popular anime now", blurb: "The anime series getting the most attention.", type: "tv", anime: true, size: 100, tmdb: { params: { sort_by: "popularity.desc", with_genres: "16", with_original_language: "ja", "vote_count.gte": 20 } } });
add({ id: "most-voted-movies", group: "essentials", title: "Most popular movies of all time", blurb: "Ranked by how many people have rated them.", type: "movie", size: 250, tmdb: { params: { sort_by: "vote_count.desc" } }, imdb: undefined });
add({ id: "most-voted-series", group: "essentials", title: "Most popular series of all time", blurb: "Ranked by how many people have rated them.", type: "tv", size: 250, tmdb: { params: { sort_by: "vote_count.desc", ...noDailies } } });

// --- By genre ------------------------------------------------------------------
for (const c of CATEGORIES) {
  for (const type of ["movie", "tv"] as const) {
    const ids = c[type];
    if (!ids?.length) continue;
    add({
      id: `genre-${c.name.toLowerCase().replace(/[^a-z]+/g, "-")}-${type}`,
      group: "genre",
      title: `Top ${c.name} ${t(type)}`,
      blurb: `The 100 best-rated ${c.name.toLowerCase()} ${t(type)}.`,
      type,
      size: 100,
      tmdb: rated(type, type === "movie" ? 1000 : 400, { with_genres: ids.join("|") }),
      imdb: { kind: type === "movie" ? "movie" : "series", genres: IMDB_GENRES[c.name], minVotes: 5000 },
    });
  }
}

// --- By era --------------------------------------------------------------------
const ERAS: { id: string; title: string; from?: number; to: number }[] = [
  { id: "classics", title: "Classics", to: 1969 },
  { id: "1970s", title: "1970s", from: 1970, to: 1979 },
  { id: "1980s", title: "1980s", from: 1980, to: 1989 },
  { id: "1990s", title: "1990s", from: 1990, to: 1999 },
  { id: "2000s", title: "2000s", from: 2000, to: 2009 },
  { id: "2010s", title: "2010s", from: 2010, to: 2019 },
  { id: "2020s", title: "2020s", from: 2020, to: 2029 },
];
for (const e of ERAS) {
  for (const type of ["movie", "tv"] as const) {
    const old = e.to < 1980;
    const floor = type === "movie" ? (old ? 300 : 1000) : old ? 60 : 300;
    const params: Record<string, string | number> = { [`${dateKey(type)}.lte`]: `${e.to}-12-31` };
    if (e.from) params[`${dateKey(type)}.gte`] = `${e.from}-01-01`;
    add({
      id: `era-${e.id}-${type}`,
      group: "era",
      title: e.id === "classics" ? `Classic ${t(type)}` : `Best ${t(type)} of the ${e.title}`,
      blurb: e.id === "classics" ? `The best ${t(type)} from before 1970.` : `The best-rated ${t(type)} released in the ${e.title}.`,
      type,
      size: 100,
      tmdb: rated(type, floor, params),
      imdb: { kind: type === "movie" ? "movie" : "series", yearFrom: e.from, yearTo: e.to, minVotes: old ? 2000 : 5000 },
    });
  }
}

// --- By theme (TMDB keywords; ids resolved by scripts/resolve-keywords.mjs) ---
const THEMES: { key: keyof typeof KEYWORDS; title: string; blurb: string; tv?: boolean }[] = [
  { key: "mafia", title: "Mafia & organised crime", blurb: "Families, bosses and the people who cross them.", tv: true },
  { key: "heist", title: "Heists", blurb: "The plan, the crew, the job that goes wrong.", tv: true },
  { key: "timeTravel", title: "Time travel", blurb: "Loops, paradoxes and second chances.", tv: true },
  { key: "space", title: "Space", blurb: "Out past the atmosphere.", tv: true },
  { key: "dystopia", title: "Dystopias", blurb: "Futures nobody wanted.", tv: true },
  { key: "superhero", title: "Superheroes", blurb: "Capes, powers and origin stories.", tv: true },
  { key: "spy", title: "Spies", blurb: "Agents, double agents and dead drops.", tv: true },
  { key: "courtroom", title: "Courtroom", blurb: "Trials, lawyers and verdicts.", tv: true },
  { key: "trueStory", title: "Based on a true story", blurb: "It really happened (more or less).", tv: true },
  { key: "comingOfAge", title: "Coming of age", blurb: "Growing up, on screen.", tv: true },
  { key: "serialKiller", title: "Serial killers", blurb: "Hunters and the hunted.", tv: true },
  { key: "zombie", title: "Zombies", blurb: "The dead don't stay down.", tv: true },
  { key: "martialArts", title: "Martial arts", blurb: "Fists, feet and philosophy.", tv: true },
  { key: "sport", title: "Sport", blurb: "Underdogs, rivals and the big game.", tv: true },
  { key: "roadTrip", title: "Road trips", blurb: "Long drives, short tempers." },
  { key: "revenge", title: "Revenge", blurb: "Best served cold.", tv: true },
  { key: "postApocalyptic", title: "Post-apocalyptic", blurb: "After the end of the world.", tv: true },
  { key: "cyberpunk", title: "Cyberpunk", blurb: "High tech, low life.", tv: true },
];
for (const th of THEMES) {
  for (const type of ["movie", "tv"] as const) {
    if (type === "tv" && !th.tv) continue;
    add({
      id: `theme-${th.key}-${type}`,
      group: "theme",
      title: `${th.title}: top ${t(type)}`,
      blurb: th.blurb,
      type,
      size: 100,
      tmdb: rated(type, type === "movie" ? 300 : 100, { with_keywords: KEYWORDS[th.key].join("|") }),
    });
  }
}

// --- Around the world ---------------------------------------------------------
const WORLD: { id: string; title: string; params: Record<string, string | number> }[] = [
  { id: "korean", title: "Korean", params: { with_original_language: "ko" } },
  { id: "japanese", title: "Japanese live-action", params: { with_original_language: "ja", without_genres: "16" } },
  { id: "indian", title: "Indian", params: { with_origin_country: "IN" } },
  { id: "french", title: "French", params: { with_original_language: "fr" } },
  { id: "spanish", title: "Spanish-language", params: { with_original_language: "es" } },
  { id: "german", title: "German", params: { with_original_language: "de" } },
  { id: "italian", title: "Italian", params: { with_original_language: "it" } },
  { id: "british", title: "British", params: { with_origin_country: "GB" } },
  { id: "chinese", title: "Chinese-language", params: { with_original_language: "zh" } },
  { id: "nordic", title: "Nordic", params: { with_origin_country: "SE|DK|NO|FI|IS" } },
];
for (const w of WORLD) {
  for (const type of ["movie", "tv"] as const) {
    const params = { ...w.params };
    // Combine "no animation" with the daily-show exclusion for series.
    if (type === "tv") params.without_genres = [params.without_genres, ...DAILIES].filter(Boolean).join(",");
    add({
      id: `world-${w.id}-${type}`,
      group: "world",
      title: `Top ${w.title} ${t(type)}`,
      blurb: `The best-rated ${w.title} ${t(type)}.`,
      type,
      size: 100,
      tmdb: { params: { sort_by: "vote_average.desc", "vote_count.gte": type === "movie" ? 200 : 60, ...params } },
    });
  }
}

// --- Short on time ------------------------------------------------------------
add({ id: "short-movies", group: "short", title: "Great movies under 90 minutes", blurb: "Big films, small running times.", type: "movie", size: 100, tmdb: rated("movie", 1000, { "with_runtime.lte": 89, "with_runtime.gte": 60 }) });
add({ id: "short-mini", group: "short", title: "Best miniseries", blurb: "One season, beginning to end.", type: "tv", size: 100, tmdb: rated("tv", 200, { with_type: "2" }) });
add({ id: "short-finished", group: "short", title: "Best finished series", blurb: "Complete stories. No waiting for next season.", type: "tv", size: 100, tmdb: rated("tv", 500, { with_status: "3" }) });
add({ id: "short-sitcoms", group: "short", title: "Best half-hour series", blurb: "Episodes under 30 minutes.", type: "tv", size: 100, tmdb: rated("tv", 300, { "with_runtime.lte": 30, "with_runtime.gte": 15 }) });

// --- Hidden gems ----------------------------------------------------------------
add({ id: "gems-movies", group: "gems", title: "Hidden gem movies", blurb: "Rated 7.8+ by fewer people than they deserve.", type: "movie", size: 100, tmdb: { params: { sort_by: "vote_average.desc", "vote_average.gte": 7.8, "vote_count.gte": 300, "vote_count.lte": 3000 } } });
add({ id: "gems-series", group: "gems", title: "Hidden gem series", blurb: "Excellent shows that slipped under the radar.", type: "tv", size: 100, tmdb: { params: { sort_by: "vote_average.desc", "vote_average.gte": 7.8, "vote_count.gte": 150, "vote_count.lte": 1500, ...noDailies } } });

export const TOP_LISTS: TopList[] = lists;
export const listById = (id: string) => TOP_LISTS.find((l) => l.id === id);
export const listsIn = (g: ListGroup) => TOP_LISTS.filter((l) => l.group === g);
export const PAGE_SIZE = 20;
export const pagesFor = (l: TopList) => Math.ceil(l.size / PAGE_SIZE);
export const typeLabel = T;
