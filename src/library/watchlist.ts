// Titles saved from Discover. One in-memory copy shared by every card, so a
// row of posters doesn't hit the database once per card.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { db } from "./db";
import { tasteChanged } from "./store";
import { details, type Item, type MediaType } from "../discover/api";

export type SavedItem = Item & { addedAt: number; refreshedAt: number | null };

type Row = {
  tmdb_type: MediaType; tmdb_id: number; name: string; poster: string | null; poster_local: string | null;
  backdrop: string | null; date: string | null; overview: string | null; rating: number | null; votes: number;
  added_at: number; refreshed_at: number | null;
};

let items: SavedItem[] = [];
let started = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function load() {
  const rows = await (await db()).select<Row[]>("SELECT * FROM watchlist ORDER BY added_at DESC");
  items = rows.map((r) => ({
    type: r.tmdb_type, id: r.tmdb_id, name: r.name, date: r.date, year: r.date ? Number(r.date.slice(0, 4)) : null,
    poster: r.poster, posterLocal: r.poster_local, backdrop: r.backdrop, overview: r.overview ?? "",
    rating: r.rating, votes: r.votes, genreIds: [], addedAt: r.added_at, refreshedAt: r.refreshed_at,
  }));
  emit();
}

/** The watchlist, newest first. Re-renders when it changes. */
export function useWatchlist(): SavedItem[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!started) {
        started = true;
        load().catch((e) => console.warn("watchlist", e));
      }
      return () => subs.delete(f);
    },
    () => items,
  );
}

/** The watchlist outside React (loads it the first time). */
export async function ensureWatchlistLoaded(): Promise<SavedItem[]> {
  if (!started) {
    started = true;
    await load();
  }
  return items;
}

export const onWatchlist =(list: Item[], type: MediaType, id: number) => list.some((i) => i.type === type && i.id === id);

const cachePoster = (poster: string | null) =>
  poster ? invoke<string>("cache_tmdb_image", { file: poster, size: "w342" }).catch(() => null) : Promise.resolve(null);

async function insert(item: Item, addedAt: number, posterLocal?: string | null) {
  // Keep the poster on disk so the list still shows offline.
  const local = posterLocal ?? (await cachePoster(item.poster));
  await (await db()).execute(
    `INSERT OR REPLACE INTO watchlist (tmdb_type, tmdb_id, name, poster, poster_local, backdrop, date, overview, rating, votes, added_at, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [item.type, item.id, item.name, item.poster, local, item.backdrop, item.date, item.overview, item.rating, item.votes, addedAt, Date.now()],
  );
}

/**
 * Remove a title. Returns a function that puts it back in its original place,
 * or null when it wasn't on the list.
 */
export async function removeFromWatchlist(type: MediaType, id: number): Promise<(() => Promise<void>) | null> {
  const old = items.find((i) => i.type === type && i.id === id);
  if (!old) return null;
  await (await db()).execute("DELETE FROM watchlist WHERE tmdb_type = $1 AND tmdb_id = $2", [type, id]);
  await load();
  tasteChanged();
  return async () => {
    await insert(old, old.addedAt, old.posterLocal);
    await load();
    tasteChanged();
  };
}

export async function addToWatchlist(item: Item) {
  await insert(item, Date.now());
  await load();
  tasteChanged();
}

/** Add or remove a title. Returns an undo for removals, null otherwise. */
export async function toggleWatchlist(item: Item): Promise<(() => Promise<void>) | null> {
  if (onWatchlist(items, item.type, item.id)) return removeFromWatchlist(item.type, item.id);
  await addToWatchlist(item);
  return null;
}

const WEEK = 7 * 86400000;

/**
 * Saved data goes stale (dates move, posters change). Refresh entries older
 * than a week from TMDB, four at a time. Failures are silent: the saved copy stays.
 */
export async function refreshStale(): Promise<void> {
  const stale = items.filter((i) => !i.refreshedAt || Date.now() - i.refreshedAt > WEEK);
  if (!stale.length) return;
  let changed = false;
  const queue = [...stale];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const d = await details(s.type, s.id);
        const local = d.poster && d.poster !== s.poster ? await cachePoster(d.poster) : s.posterLocal;
        await (await db()).execute(
          `UPDATE watchlist SET name = $3, poster = $4, poster_local = $5, backdrop = $6, date = $7, overview = $8,
             rating = $9, votes = $10, refreshed_at = $11 WHERE tmdb_type = $1 AND tmdb_id = $2`,
          [s.type, s.id, d.name, d.poster ?? s.poster, local ?? s.posterLocal ?? null, d.backdrop ?? s.backdrop, d.date, d.overview, d.rating, d.votes, Date.now()],
        );
        changed = true;
      } catch {
        // offline or TMDB hiccup: keep what we have
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (changed) await load();
}
