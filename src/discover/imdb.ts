// IMDb ratings (opt-in). The data comes from IMDb's public files, downloaded
// on this PC by the Rust side (src-tauri/src/imdb.rs) and written here into
// the imdb_titles table. IMDb's terms: personal, non-commercial use, and the
// credit line below must be shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { db, getSetting, setSetting } from "../library/db";
import { runJob } from "../library/jobs";
import { apiCached, DAY } from "./cache";
import { externalImdbId, findByImdb, type Item, type MediaType } from "./api";
import { makeQueue } from "../lib/net";

export const IMDB_CREDIT = "Information courtesy of IMDb (https://www.imdb.com). Used with permission.";
const REFRESH_AFTER = 7 * DAY;

// ---------------------------------------------------------------------------
// State: enabled, how many titles, when updated, which rating posters show.

export type RatingSource = "tmdb" | "imdb";
type ImdbState = { enabled: boolean; count: number; at: number | null; source: RatingSource; running: boolean };

let state: ImdbState = { enabled: false, count: 0, at: null, source: "tmdb", running: false };
let loaded = false;
const subs = new Set<() => void>();
const set = (patch: Partial<ImdbState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};

async function loadState() {
  const [en, count, at, src] = await Promise.all([
    getSetting("imdb_enabled"),
    getSetting("imdb_count"),
    getSetting("imdb_data_at"),
    getSetting("rating_source"),
  ]);
  set({ enabled: en === "true", count: Number(count ?? 0), at: at ? Number(at) : null, source: src === "imdb" ? "imdb" : "tmdb" });
}

export function hydrateImdb(en: string | null, count: string | null, at: string | null, src: string | null) {
  state = { ...state, enabled: en === "true", count: Number(count ?? 0), at: at ? Number(at) : null, source: src === "imdb" ? "imdb" : "tmdb" };
  loaded = true;
}

export function useImdb(): ImdbState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!loaded) {
        loaded = true;
        loadState();
      }
      return () => subs.delete(f);
    },
    () => state,
  );
}
export const imdbReady = () => state.enabled && state.count > 0;

export async function setRatingSource(s: RatingSource) {
  set({ source: s });
  await setSetting("rating_source", s);
}

// ---------------------------------------------------------------------------
// Import

type Row = { tconst: string; kind: string; title: string; year: number | null; runtime: number | null; genres: string; rating: number; votes: number; weighted: number };
type ImdbEvent =
  | { event: "progress"; file: "ratings" | "titles"; done: number; total: number }
  | { event: "batch"; rows: Row[] }
  | { event: "done"; count: number };

const COLS = 9; // per row; 2,000 rows × 9 = 18,000 parameters, under SQLite's 32,766 limit

async function insertBatch(rows: Row[]) {
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.tconst, r.kind, r.title, r.year, r.runtime, r.genres, r.rating, r.votes, r.weighted);
    const b = i * COLS;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
  });
  await (await db()).execute(
    `INSERT OR REPLACE INTO imdb_titles_new (tconst, kind, title, year, runtime, genres, rating, votes, weighted) VALUES ${tuples.join(",")}`,
    values,
  );
}

/** Download and import IMDb ratings as a background job. Old data stays until the new set is complete. */
export function syncImdb(): Promise<void> {
  if (state.running) return Promise.resolve();
  set({ running: true });
  return runJob(async (report) => {
    const d = await db();
    await d.execute(
      `DROP TABLE IF EXISTS imdb_titles_new;
       CREATE TABLE imdb_titles_new (tconst TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, year INTEGER,
         runtime INTEGER, genres TEXT, rating REAL NOT NULL, votes INTEGER NOT NULL, weighted REAL NOT NULL)`,
    );
    const totals = { ratings: 0, titles: 0 };
    const done = { ratings: 0, titles: 0 };
    let writes: Promise<void> = Promise.resolve();
    let written = 0;
    let expected = 0;
    let writeError: unknown = null;
    // The command can return before its last batches have reached this side,
    // so "all sent" is the Done message, which arrives after every batch.
    let allSent!: () => void;
    const sent = new Promise<void>((r) => (allSent = r));
    const ch = new Channel<ImdbEvent>();
    ch.onmessage = (e) => {
      if (e.event === "progress") {
        totals[e.file] = e.total;
        done[e.file] = e.done;
        const all = (totals.ratings || 9e6) + (totals.titles || 2.3e8);
        report({ label: "Getting IMDb ratings", done: done.ratings + done.titles, total: all });
      } else if (e.event === "batch") {
        const rows = e.rows;
        writes = writes.then(async () => {
          if (writeError) return;
          try {
            await insertBatch(rows);
            written += rows.length;
            report({ label: "Saving IMDb ratings", done: written, total: Math.max(expected, written) });
          } catch (err) {
            writeError = err;
          }
        });
      } else if (e.event === "done") {
        expected = e.count;
        allSent();
      }
    };
    try {
      const count = await invoke<number>("imdb_sync", { onEvent: ch });
      expected = count;
      await Promise.race([sent, new Promise((r) => setTimeout(r, 120_000))]);
      await writes;
      if (writeError) throw writeError;
      // Never swap in a partial set: every title the importer kept must be saved.
      const [{ n }] = await d.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM imdb_titles_new");
      if (n !== count) throw new Error(`only ${n} of ${count} titles were saved`);
      // Swap in one statement batch on one connection, so it's all or nothing.
      await d.execute(
        `BEGIN;
         DROP TABLE IF EXISTS imdb_titles;
         ALTER TABLE imdb_titles_new RENAME TO imdb_titles;
         CREATE INDEX IF NOT EXISTS imdb_rank ON imdb_titles (kind, weighted DESC);
         CREATE INDEX IF NOT EXISTS imdb_votes ON imdb_titles (kind, votes DESC);
         CREATE INDEX IF NOT EXISTS imdb_title ON imdb_titles (kind, title COLLATE NOCASE, year);
         COMMIT;`,
      );
      const at = Date.now();
      await Promise.all([setSetting("imdb_data_at", String(at)), setSetting("imdb_count", String(count)), setSetting("imdb_enabled", "true")]);
      ratingCache.clear();
      set({ enabled: true, count, at });
      return `IMDb ratings updated: ${count.toLocaleString()} titles.`;
    } catch (e) {
      await writes.catch(() => {});
      await d.execute("DROP TABLE IF EXISTS imdb_titles_new").catch(() => {});
      if (String(e).includes("Cancelled")) return "IMDb update cancelled. Your previous ratings are unchanged.";
      throw new Error(`IMDb update failed: ${e}. Your previous ratings are unchanged.`);
    } finally {
      set({ running: false });
    }
  });
}

export const cancelImdb = () => invoke("imdb_cancel");

export async function enableImdb() {
  await setSetting("imdb_enabled", "true");
  set({ enabled: true });
  await syncImdb();
}

/** Remove every IMDb rating; TMDB ratings stay. */
export async function removeImdb() {
  const d = await db();
  await d.execute("DELETE FROM imdb_titles");
  await Promise.all([setSetting("imdb_enabled", "false"), setSetting("imdb_count", "0"), setSetting("imdb_data_at", null), setSetting("rating_source", "tmdb")]);
  ratingCache.clear();
  set({ enabled: false, count: 0, at: null, source: "tmdb" });
}

/**
 * At start-up: refresh in the background when enabled and older than a week,
 * or when the saved ratings don't match what the last import reported (an
 * early 2.0 build could finish with part of the data).
 */
export async function refreshImdbIfStale() {
  await loadState();
  loaded = true;
  if (!state.enabled) return;
  const d = await db();
  const [{ n }] = await d.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM imdb_titles");
  await d.execute("CREATE INDEX IF NOT EXISTS imdb_title ON imdb_titles (kind, title COLLATE NOCASE, year)").catch(() => {});
  const incomplete = n !== state.count;
  if ((incomplete || !state.at || Date.now() - state.at > REFRESH_AFTER) && navigator.onLine) await syncImdb();
}

// ---------------------------------------------------------------------------
// TMDB ⇄ IMDb links (table ext_ids) and rating lookups

export type ImdbRating = { tconst: string; rating: number; votes: number };
const idCache = new Map<string, string | null>(); // "tv:1396" → "tt0903747" | null
const ratingCache = new Map<string, ImdbRating | null>(); // tconst → rating
const lookups = makeQueue(6);

/** Remember a link learnt elsewhere (details(), library metadata). */
export async function rememberImdbId(type: MediaType, id: number, tconst: string | null) {
  const k = `${type}:${id}`;
  if (idCache.get(k) === tconst) return;
  idCache.set(k, tconst);
  await (await db())
    .execute("INSERT OR REPLACE INTO ext_ids (tmdb_type, tmdb_id, imdb_id, checked_at) VALUES ($1, $2, $3, $4)", [type, id, tconst, Date.now()])
    .catch(() => {});
}

/** IMDb id for a TMDB title: memory, then the database, then TMDB (only when `fetch`). */
export async function imdbIdFor(type: MediaType, id: number, fetch: boolean): Promise<string | null | undefined> {
  const k = `${type}:${id}`;
  if (idCache.has(k)) return idCache.get(k);
  const [row] = await (await db()).select<{ imdb_id: string | null }[]>(
    "SELECT imdb_id FROM ext_ids WHERE tmdb_type = $1 AND tmdb_id = $2",
    [type, id],
  );
  if (row) {
    idCache.set(k, row.imdb_id);
    return row.imdb_id;
  }
  if (!fetch) return undefined;
  return lookups.run(`ext:${k}`, async () => {
    try {
      const tconst = await externalImdbId(type, id);
      await rememberImdbId(type, id, tconst);
      return tconst;
    } catch {
      return undefined; // offline: try again another time
    }
  });
}

export async function ratingFor(tconst: string): Promise<ImdbRating | null> {
  if (ratingCache.has(tconst)) return ratingCache.get(tconst)!;
  const [r] = await (await db())
    .select<{ rating: number; votes: number }[]>("SELECT rating, votes FROM imdb_titles WHERE tconst = $1", [tconst])
    .catch(() => [] as { rating: number; votes: number }[]);
  const v = r ? { tconst, rating: r.rating, votes: r.votes } : null;
  ratingCache.set(tconst, v);
  return v;
}

/**
 * The only IMDb title with this exact name, year and kind, if there is exactly
 * one. Used to show a rating at once while the real link is confirmed with TMDB.
 */
async function guessImdbId(type: MediaType, name: string, year: number): Promise<string | null> {
  const rows = await (await db())
    .select<{ tconst: string }[]>(
      "SELECT tconst FROM imdb_titles WHERE kind = $1 AND title = $2 COLLATE NOCASE AND year = $3 LIMIT 2",
      [type === "movie" ? "movie" : "series", name, year],
    )
    .catch(() => [] as { tconst: string }[]);
  return rows.length === 1 ? rows[0].tconst : null;
}

type Rated = { type: MediaType; id: number; imdbId?: string | null; name?: string; year?: number | null };

/**
 * IMDb rating for a title, or null. A title whose IMDb link is already known
 * resolves from the database. Otherwise the rating of the one IMDb title with
 * the same name and year shows straight away, and (`eager`) the link is then
 * confirmed with TMDB and corrected if it differs.
 */
export function useImdbRating(item: Rated | null, eager: boolean): ImdbRating | null {
  const imdb = useImdb();
  const [r, setR] = useState<ImdbRating | null>(null);
  const on = imdb.enabled && imdb.count > 0;
  useEffect(() => {
    setR(null);
    if (!item || !on) return;
    let alive = true;
    (async () => {
      if (item.imdbId) rememberImdbId(item.type, item.id, item.imdbId);
      let tconst = item.imdbId ?? (await imdbIdFor(item.type, item.id, false));
      if (tconst === undefined) {
        const guess = item.name && item.year ? await guessImdbId(item.type, item.name, item.year) : null;
        if (guess) {
          const g = await ratingFor(guess);
          if (alive && g) setR(g);
        }
        if (!eager || !alive) return;
        tconst = await imdbIdFor(item.type, item.id, true);
        if (tconst === undefined || tconst === guess) return; // offline, or the guess was right
      }
      const rating = tconst ? await ratingFor(tconst) : null;
      if (alive) setR(rating);
    })();
    return () => {
      alive = false;
    };
  }, [item?.type, item?.id, item?.imdbId, item?.name, item?.year, on, eager, imdb.at]);
  return r;
}

/** IMDb ratings for a list of titles ("tv:1396" → 9.5), looked up in the background. */
export function useImdbRatings(items: { type: MediaType; id: number }[], on: boolean): Map<string, number> {
  const [m, setM] = useState<Map<string, number>>(new Map());
  const key = items.map((i) => `${i.type}:${i.id}`).join(",");
  useEffect(() => {
    if (!on) return setM(new Map());
    let alive = true;
    (async () => {
      const out = new Map<string, number>();
      for (const i of items) {
        const t = await imdbIdFor(i.type, i.id, true);
        const r = t ? await ratingFor(t) : null;
        if (r) out.set(`${i.type}:${i.id}`, r.rating);
      }
      if (alive) setM(out);
    })();
    return () => {
      alive = false;
    };
  }, [key, on]);
  return m;
}

export const fmtVotes = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

// ---------------------------------------------------------------------------
// IMDb-ranked lists

export type ImdbListDef = { kind: "movie" | "series"; genres?: string[]; yearFrom?: number; yearTo?: number; minVotes: number };
type ImdbListRow = { tconst: string; title: string; year: number | null; rating: number; votes: number; weighted: number };

export async function imdbRanked(def: ImdbListDef, limit: number): Promise<ImdbListRow[]> {
  const where = ["kind = $1", "votes >= $2"];
  const params: unknown[] = [def.kind, def.minVotes];
  if (def.yearFrom) {
    params.push(def.yearFrom);
    where.push(`year >= $${params.length}`);
  }
  if (def.yearTo) {
    params.push(def.yearTo);
    where.push(`year <= $${params.length}`);
  }
  if (def.genres?.length) {
    const ors = def.genres.map((g) => {
      params.push(`%${g}%`);
      return `genres LIKE $${params.length}`;
    });
    where.push(`(${ors.join(" OR ")})`);
  }
  params.push(limit);
  return (await db()).select<ImdbListRow[]>(
    `SELECT tconst, title, year, rating, votes, weighted FROM imdb_titles WHERE ${where.join(" AND ")} ORDER BY weighted DESC LIMIT $${params.length}`,
    params,
  );
}

/** TMDB title for an IMDb id (cached for a week; unknown ids remembered). */
export async function tmdbForImdb(tconst: string): Promise<Item | null> {
  const d = await db();
  const [known] = await d.select<{ tmdb_type: MediaType; tmdb_id: number }[]>(
    "SELECT tmdb_type, tmdb_id FROM ext_ids WHERE imdb_id = $1 LIMIT 1",
    [tconst],
  );
  const [miss] = await d.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM imdb_unmatched WHERE tconst = $1", [tconst]);
  if (miss?.n && !known) return null;
  return lookups.run(`find:${tconst}`, () =>
    apiCached(`find:${tconst}`, 7 * DAY, async () => {
      const it = await findByImdb(tconst);
      if (it) await rememberImdbId(it.type, it.id, tconst);
      else await d.execute("INSERT OR REPLACE INTO imdb_unmatched (tconst, checked_at) VALUES ($1, $2)", [tconst, Date.now()]);
      return it ? { ...it, imdbId: tconst } : null;
    }),
  );
}
