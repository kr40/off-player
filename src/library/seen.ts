// "Already watched": titles the user says they've seen outside the library,
// plus library titles derived from real watch state. One shared in-memory copy
// of the manual list, updated optimistically so a click shows at once.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLibraryVersion } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { db, getSetting, setSetting } from "./db";
import { tasteChanged } from "./store";
import { removeFromWatchlist } from "./watchlist";
import { deriveLibrarySeeds, type LibraryWatchRow, type Reaction, type SeedInput } from "../discover/recommend";
import type { Item, MediaType } from "../discover/api";

export type SeenItem = Item & { reaction: Reaction; seenAt: number };

type Row = {
  tmdb_type: MediaType; tmdb_id: number; name: string; poster: string | null; poster_local: string | null;
  backdrop: string | null; date: string | null; genres: string | null; reaction: number; seen_at: number;
};

let items: SeenItem[] = [];
let started = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (next: SeenItem[]) => {
  items = next.sort((a, b) => b.seenAt - a.seenAt);
  emit();
  tasteChanged();
};

const parseIds = (s: string | null): number[] => {
  try {
    const v = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
};

async function load() {
  const rows = await (await db()).select<Row[]>("SELECT * FROM seen ORDER BY seen_at DESC");
  items = rows.map((r) => ({
    type: r.tmdb_type, id: r.tmdb_id, name: r.name, date: r.date, year: r.date ? Number(r.date.slice(0, 4)) : null,
    poster: r.poster, posterLocal: r.poster_local, backdrop: r.backdrop, overview: "", rating: null, votes: 0,
    genreIds: parseIds(r.genres), reaction: (r.reaction === 2 || r.reaction === -1 ? r.reaction : 1) as Reaction, seenAt: r.seen_at,
  }));
  emit();
}
const ensure = () => {
  if (!started) {
    started = true;
    return load().catch((e) => console.warn("seen", e));
  }
  return Promise.resolve();
};

/** Manually watched titles, newest first. */
export function useSeen(): SeenItem[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      ensure();
      return () => subs.delete(f);
    },
    () => items,
  );
}

export const findSeen = (list: SeenItem[], type: MediaType, id: number) => list.find((i) => i.type === type && i.id === id);

async function persist(s: SeenItem) {
  // Keep the poster on disk so the Watched tab renders offline.
  const local =
    s.posterLocal ??
    (s.poster ? await invoke<string>("cache_tmdb_image", { file: s.poster, size: "w342" }).catch(() => null) : null);
  if (local && !s.posterLocal) {
    const cur = items.find((i) => i.type === s.type && i.id === s.id);
    if (cur) cur.posterLocal = local;
  }
  await (await db()).execute(
    `INSERT OR REPLACE INTO seen (tmdb_type, tmdb_id, name, poster, poster_local, backdrop, date, genres, reaction, seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [s.type, s.id, s.name, s.poster, local, s.backdrop, s.date, JSON.stringify(s.genreIds ?? []), s.reaction, s.seenAt],
  );
}

type Undo = () => Promise<void>;

/**
 * Mark titles watched (also takes them off the watchlist). Returns an undo that
 * reverses both.
 */
export async function markSeen(list: Item[], reaction: Reaction = 1): Promise<Undo> {
  await ensure();
  const now = Date.now();
  const fresh = list.filter((it) => !findSeen(items, it.type, it.id));
  const added: SeenItem[] = fresh.map((it, i) => ({ ...it, genreIds: it.genreIds ?? [], reaction, seenAt: now + i }));
  set([...items, ...added]);
  const restores: Undo[] = [];
  for (const s of added) {
    await persist(s);
    const r = await removeFromWatchlist(s.type, s.id);
    if (r) restores.push(r);
  }
  return async () => {
    const d = await db();
    for (const s of added) await d.execute("DELETE FROM seen WHERE tmdb_type = $1 AND tmdb_id = $2", [s.type, s.id]);
    set(items.filter((i) => !added.some((s) => s.type === i.type && s.id === i.id)));
    for (const r of restores) await r();
  };
}

/** Un-mark a title. The undo puts it back with its reaction and date. */
export async function unmarkSeen(type: MediaType, id: number): Promise<Undo> {
  await ensure();
  const old = findSeen(items, type, id);
  set(items.filter((i) => !(i.type === type && i.id === id)));
  await (await db()).execute("DELETE FROM seen WHERE tmdb_type = $1 AND tmdb_id = $2", [type, id]);
  return async () => {
    if (!old) return;
    set([...items.filter((i) => !(i.type === type && i.id === id)), old]);
    await persist(old);
  };
}

/** Toggle one title. */
export async function toggleSeen(item: Item): Promise<{ seen: boolean; undo: Undo }> {
  await ensure();
  if (findSeen(items, item.type, item.id)) return { seen: false, undo: await unmarkSeen(item.type, item.id) };
  return { seen: true, undo: await markSeen([item]) };
}

export async function setReaction(type: MediaType, id: number, reaction: Reaction) {
  const cur = findSeen(items, type, id);
  if (!cur || cur.reaction === reaction) return;
  set(items.map((i) => (i === cur ? { ...i, reaction } : i)));
  await (await db()).execute("UPDATE seen SET reaction = $3 WHERE tmdb_type = $1 AND tmdb_id = $2", [type, id, reaction]);
}

/** Forget every manual mark. Library watch state is untouched. */
export async function clearSeen() {
  await (await db()).execute("DELETE FROM seen");
  set([]);
}

/**
 * Stored TMDB data may be kept at most six months (TMDB's terms) and goes
 * stale anyway: refresh entries not refreshed for a week, four at a time.
 */
export async function refreshSeenStale() {
  const d = await db();
  const rows = await d.select<{ tmdb_type: MediaType; tmdb_id: number }[]>(
    "SELECT tmdb_type, tmdb_id FROM seen WHERE refreshed_at IS NULL OR refreshed_at < $1",
    [Date.now() - 7 * 86_400_000],
  );
  if (!rows.length) return;
  const { tmdb } = await import("./metadata");
  const queue = [...rows];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const x = await tmdb<any>(`/${r.tmdb_type}/${r.tmdb_id}`);
        const date = (r.tmdb_type === "tv" ? x.first_air_date : x.release_date) || null;
        await d.execute(
          "UPDATE seen SET name = $3, poster = COALESCE($4, poster), backdrop = $5, date = $6, genres = $7, refreshed_at = $8 WHERE tmdb_type = $1 AND tmdb_id = $2",
          [r.tmdb_type, r.tmdb_id, (r.tmdb_type === "tv" ? x.name : x.title) ?? "", x.poster_path ?? null, x.backdrop_path ?? null, date, JSON.stringify((x.genres ?? []).map((g: any) => g.id)), Date.now()],
        );
      } catch {
        // offline: keep what we have
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await load();
}

// ---------------------------------------------------------------------------
// Library-derived entries (read at call time, never copied)

export async function librarySeeds(): Promise<SeedInput[]> {
  const rows = await (await db()).select<LibraryWatchRow[]>(
    `SELECT t.id AS title_id, t.kind, t.tmdb_type, t.tmdb_id, COALESCE(t.tmdb_name, t.name) AS name, t.genres,
            SUM(CASE WHEN f.role IN ('episode', 'movie') THEN 1 ELSE 0 END) AS owned,
            SUM(CASE WHEN f.role IN ('episode', 'movie') AND p.watched = 1 THEN 1 ELSE 0 END) AS watched,
            MAX(p.last_played) AS last
       FROM titles t
       JOIN files f ON f.title_id = t.id
       LEFT JOIN playback p ON p.fingerprint = f.fingerprint
      WHERE t.tmdb_id IS NOT NULL AND t.tmdb_type IS NOT NULL
      GROUP BY t.id`,
  );
  return deriveLibrarySeeds(rows);
}

/** The whole watched set: manual marks plus library titles. */
export async function watchedSet(): Promise<SeedInput[]> {
  await ensure();
  const manual: SeedInput[] = items.map((i) => ({
    type: i.type, id: i.id, name: i.name, source: "manual", reaction: i.reaction, at: i.seenAt, genreIds: i.genreIds ?? [],
  }));
  return [...manual, ...(await librarySeeds())];
}

/**
 * Keys ("tv:1396") of the whole watched set — manual marks plus library titles
 * watched to the finished/in-progress thresholds — kept current as either changes.
 */
export function useWatchedKeys(): Set<string> {
  return useWatchedState().keys;
}

/** The watched set plus whether its library part has loaded yet. */
export function useWatchedState(): { keys: Set<string>; ready: boolean } {
  const manual = useSeen();
  const [lib, setLib] = useState<string[] | null>(null);
  const v = useLibraryVersion();
  useEffect(() => {
    librarySeeds()
      .then((s) => setLib(s.map((x) => `${x.type}:${x.id}`)))
      .catch(() => setLib([]));
  }, [v]);
  return useMemo(() => ({ keys: new Set([...manual.map((i) => `${i.type}:${i.id}`), ...(lib ?? [])]), ready: lib !== null }), [manual, lib]);
}

// ---------------------------------------------------------------------------
// "Hide titles I've watched in Discover rows"

let hide = false;
let hideLoaded = false;
const hideSubs = new Set<() => void>();
export function hydrateHide(v: string | null) {
  hide = v === "true";
  hideLoaded = true;
}
export function useHideWatched(): boolean {
  return useSyncExternalStore(
    (f) => {
      hideSubs.add(f);
      if (!hideLoaded) {
        hideLoaded = true;
        getSetting("hide_watched_in_discover").then((v) => {
          hide = v === "true";
          hideSubs.forEach((g) => g());
        });
      }
      return () => hideSubs.delete(f);
    },
    () => hide,
  );
}
export async function setHideWatched(v: boolean) {
  hide = v;
  hideLoaded = true;
  hideSubs.forEach((g) => g());
  await setSetting("hide_watched_in_discover", v ? "true" : "false");
}
