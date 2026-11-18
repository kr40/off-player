// Suggestions from the watched set. Pure functions only (no network, no
// database) so the ranking can be unit-tested: seeds + cached TMDB
// recommendation lists + exclusions → ranked list with reasons.
import type { Item, MediaType } from "./api";
import { categoriesOf, genreIdsFromNames } from "./genres";

export type Reaction = 2 | 1 | -1; // loved, liked, not for me
export type SeedSource = "manual" | "finished" | "progress";

export type SeedInput = {
  type: MediaType;
  id: number;
  name: string;
  source: SeedSource;
  reaction: Reaction;
  at: number; // when marked or last played
  genreIds: number[];
  titleId?: number; // library title, for derived seeds
};
export type Seed = SeedInput & { weight: number };
export type SeedRef = { type: MediaType; id: number; name: string };
export type Scored = { item: Item; score: number; reasons: SeedRef[]; top: string };

export const SOURCE_WEIGHT: Record<SeedSource, number> = { manual: 1, finished: 1, progress: 0.6 };
export const REACTION_FACTOR: Record<Reaction, number> = { 2: 2, 1: 1, [-1]: -1 };
export const MAX_SEEDS = 40;
export const MIN_SEEDS = 3;

export const keyOf = (x: { type: MediaType; id: number }) => `${x.type}:${x.id}`;

// ---------------------------------------------------------------------------
// Watched set from the library

export type LibraryWatchRow = {
  title_id: number;
  kind: "show" | "movie";
  tmdb_type: MediaType | null;
  tmdb_id: number | null;
  name: string;
  genres: string | null; // JSON array of genre names
  owned: number; // episode / movie files
  watched: number; // of those, marked watched
  last: number | null; // last played
};

/**
 * Library titles that count as watched: a movie watched, or a series with every
 * owned episode watched ("finished"); a series with ≥ 3 episodes or ≥ 20 % of
 * owned episodes watched ("progress"). Unmatched titles are ignored.
 */
export function deriveLibrarySeeds(rows: LibraryWatchRow[]): SeedInput[] {
  const out: SeedInput[] = [];
  for (const r of rows) {
    if (!r.tmdb_id || !r.tmdb_type || r.owned <= 0 || r.watched <= 0) continue;
    let source: SeedSource | null = null;
    if (r.kind === "movie" || r.watched >= r.owned) source = "finished";
    else if (r.watched >= 3 || r.watched / r.owned >= 0.2) source = "progress";
    if (!source) continue;
    let names: string[] = [];
    try {
      names = r.genres ? JSON.parse(r.genres) : [];
    } catch {
      names = [];
    }
    out.push({
      type: r.tmdb_type, id: r.tmdb_id, name: r.name, source, reaction: 1, at: r.last ?? 0,
      genreIds: genreIdsFromNames(names), titleId: r.title_id,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seeds

/**
 * At most 40 seeds: every "Loved it" first, then the most recent. A manual mark
 * wins over a library-derived entry for the same title.
 */
export function pickSeeds(inputs: SeedInput[]): Seed[] {
  const byKey = new Map<string, SeedInput>();
  for (const s of inputs) {
    const k = keyOf(s);
    const had = byKey.get(k);
    if (!had || (s.source === "manual" && had.source !== "manual")) byKey.set(k, s);
  }
  return [...byKey.values()]
    .sort((a, b) => Number(b.reaction === 2) - Number(a.reaction === 2) || b.at - a.at)
    .slice(0, MAX_SEEDS)
    .map((s) => ({ ...s, weight: SOURCE_WEIGHT[s.source] * REACTION_FACTOR[s.reaction] }));
}

// ---------------------------------------------------------------------------
// Scoring

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Weighted share of each category across seeds, scaled so the strongest is 1 (negative when disliked). */
export function genreProfile(seeds: Seed[]): Map<string, number> {
  const p = new Map<string, number>();
  for (const s of seeds) for (const c of categoriesOf(s.genreIds)) p.set(c, (p.get(c) ?? 0) + s.weight);
  const max = Math.max(0, ...p.values());
  if (max > 0) for (const [c, v] of p) p.set(c, v / max);
  return p;
}

/** 0–0.5: how well a candidate's categories match what the seeds lean towards. */
export function genreAffinity(item: Item, profile: Map<string, number>): number {
  const cats = categoriesOf(item.genreIds ?? []);
  if (!cats.length) return 0;
  return 0.5 * clamp01(cats.reduce((a, c) => a + (profile.get(c) ?? 0), 0) / cats.length);
}

/** 0–0.3: TMDB rating, only trusted with at least 200 votes. */
export const quality = (item: Item) =>
  item.votes >= 200 && item.rating ? 0.3 * clamp01((item.rating - 5) / 4) : 0;

/**
 * score = Σ seeds( seedWeight / (1 + rank / 8) ) + genreAffinity + quality.
 * Candidates whose seed sum is not positive are dropped, so a title that only a
 * "Not for me" seed recommends never shows up because of genre or rating alone.
 */
export function rank(seeds: Seed[], lists: Map<string, Item[]>, exclude: Set<string>): Scored[] {
  const profile = genreProfile(seeds);
  const acc = new Map<string, { item: Item; sum: number; by: Map<string, number> }>();
  for (const s of seeds) {
    const list = lists.get(keyOf(s));
    if (!list) continue;
    list.forEach((item, r) => {
      const k = keyOf(item);
      if (exclude.has(k)) return;
      const a = acc.get(k) ?? { item, sum: 0, by: new Map<string, number>() };
      const c = s.weight / (1 + r / 8);
      a.sum += c;
      a.by.set(keyOf(s), (a.by.get(keyOf(s)) ?? 0) + c);
      acc.set(k, a);
    });
  }
  const names = new Map(seeds.map((s) => [keyOf(s), s]));
  const out: Scored[] = [];
  for (const a of acc.values()) {
    if (a.sum <= 0) continue;
    const score = a.sum + genreAffinity(a.item, profile) + quality(a.item);
    if (score <= 0) continue;
    const top = [...a.by].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 2);
    out.push({
      item: a.item,
      score,
      top: top[0][0],
      reasons: top.map(([k]) => {
        const s = names.get(k)!;
        return { type: s.type, id: s.id, name: s.name };
      }),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
}

/**
 * At most `maxRun` consecutive cards of the same type (relaxed only when the
 * other type has run out) and at most `maxPerSeed` cards whose strongest seed
 * is the same title.
 */
export function diversify(list: Scored[], maxRun = 3, maxPerSeed = 5): Scored[] {
  const pool = [...list];
  const out: Scored[] = [];
  const per = new Map<string, number>();
  const capOk = (s: Scored) => (per.get(s.top) ?? 0) < maxPerSeed;
  while (pool.length) {
    const last = out[out.length - 1]?.item.type;
    let run = 0;
    for (let i = out.length - 1; i >= 0 && out[i].item.type === last; i--) run++;
    let idx = pool.findIndex((s) => capOk(s) && !(run >= maxRun && s.item.type === last));
    if (idx < 0) idx = pool.findIndex(capOk);
    if (idx < 0) break;
    const [s] = pool.splice(idx, 1);
    out.push(s);
    per.set(s.top, (per.get(s.top) ?? 0) + 1);
  }
  return out;
}

export type ForYou = {
  status: "few" | "ready";
  picks: Scored[];
  because: { seed: Seed; items: Item[] }[];
};

/**
 * Everything the For You rows need. `watched`, `library` and `dismissed` are
 * excluded everywhere; `watchlist` only from Top picks (you already know those).
 */
export function forYou(
  seeds: Seed[],
  lists: Map<string, Item[]>,
  ex: { watched: Set<string>; library: Set<string>; dismissed: Set<string>; watchlist: Set<string> },
  limit = 40,
): ForYou {
  if (seeds.length < MIN_SEEDS) return { status: "few", picks: [], because: [] };
  const base = new Set([...ex.watched, ...ex.library, ...ex.dismissed, ...seeds.map(keyOf)]);
  const pickEx = new Set([...base, ...ex.watchlist]);
  const picks = diversify(rank(seeds, lists, pickEx)).slice(0, limit);
  const because = seeds
    .filter((s) => s.weight >= 1 && lists.has(keyOf(s)))
    .sort((a, b) => b.at - a.at)
    .map((seed) => ({ seed, items: lists.get(keyOf(seed))!.filter((i) => !base.has(keyOf(i))) }))
    .filter((r) => r.items.length >= 4)
    .slice(0, 3);
  return { status: "ready", picks, because };
}

export const reasonText = (reasons: SeedRef[]) =>
  reasons.length ? `Because you watched ${reasons.map((r) => r.name).join(" and ")}` : "";
