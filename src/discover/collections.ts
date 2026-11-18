// Collections: franchises (curated, ./franchises) and TMDB movie collections,
// with the user's per-collection choices (order, follow) and each entry's
// state from the library and the watched set.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { db, type TitleRow } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { useSeen } from "../library/seen";
import { onWatchlist, useWatchlist } from "../library/watchlist";
import { collection, isFuture, type Item, type MediaType } from "./api";
import { franchiseByKey, inOrder, nextUpIndex, ordersOf, progress, type FEntry, type Franchise, type FOrder } from "./franchises";

// ---------------------------------------------------------------------------
// Per-collection state (table collection_state)

export type CState = { key: string; order_id: string | null; followed: number; opened_at: number | null };
let states = new Map<string, CState>();
let loaded = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function load() {
  const rows = await (await db()).select<CState[]>("SELECT * FROM collection_state");
  states = new Map(rows.map((r) => [r.key, r]));
  emit();
}

export function useCollectionStates(): Map<string, CState> {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!loaded) {
        loaded = true;
        load().catch(() => {});
      }
      return () => subs.delete(f);
    },
    () => states,
  );
}

async function save(key: string, patch: Partial<CState>) {
  const cur = states.get(key) ?? { key, order_id: null, followed: 0, opened_at: null };
  const next = { ...cur, ...patch };
  states = new Map(states).set(key, next);
  emit();
  await (await db()).execute(
    "INSERT OR REPLACE INTO collection_state (key, order_id, followed, opened_at) VALUES ($1, $2, $3, $4)",
    [key, next.order_id, next.followed, next.opened_at],
  );
}
export const setCollectionOrder = (key: string, orderId: string) => save(key, { order_id: orderId });
export const setFollowed = (key: string, on: boolean) => save(key, { followed: on ? 1 : 0 });
export const markOpened = (key: string) => save(key, { opened_at: Date.now() });

// ---------------------------------------------------------------------------
// A collection, whichever kind

export type Coll = {
  key: string; // "franchise:dune" | "tmdb:10"
  name: string;
  blurb: string;
  backdrop: string | null;
  poster: string | null;
  sources: string[];
  orders: FOrder[];
  entries: FEntry[];
  kind: "franchise" | "tmdb";
};

export function fromFranchise(f: Franchise): Coll {
  return {
    key: `franchise:${f.key}`,
    name: f.name,
    blurb: f.blurb,
    backdrop: f.backdrop ?? f.entries.find((e) => e.backdrop)?.backdrop ?? null,
    poster: f.entries.find((e) => e.poster)?.poster ?? null,
    sources: f.sources,
    orders: ordersOf(f),
    entries: f.entries,
    kind: "franchise",
  };
}

export async function loadCollection(key: string): Promise<Coll | null> {
  if (key.startsWith("franchise:")) {
    const f = franchiseByKey(key.slice(10));
    return f ? fromFranchise(f) : null;
  }
  if (key.startsWith("tmdb:")) {
    const c = await collection(Number(key.slice(5)));
    const entries: FEntry[] = c.parts.map((p, i) => ({
      ref: `m${i}`, type: "movie", id: p.id, title: p.name, year: p.year, date: p.date, poster: p.poster, backdrop: p.backdrop,
    }));
    const pseudo: Franchise = { key, name: c.name, blurb: c.overview, group: "film", sources: [], backdrop: c.backdrop, entries, orders: [] };
    return { ...fromFranchise(pseudo), key, name: c.name, blurb: c.overview, backdrop: c.backdrop, poster: c.poster, orders: ordersOf(pseudo), kind: "tmdb" };
  }
  return null;
}

export function orderedEntries(c: Coll, orderId: string): FEntry[] {
  const o = c.orders.find((x) => x.id === orderId) ?? c.orders[0];
  const by = new Map(c.entries.map((e) => [e.ref, e]));
  return o.refs.map((r) => by.get(r)).filter((e): e is FEntry => !!e);
}
export { inOrder, progress, nextUpIndex };

// ---------------------------------------------------------------------------
// Library progress per title and season

export type LibProgress = { titleId: number; owned: number; watched: number; seasons: Map<number, { owned: number; watched: number }> };

export async function libraryProgress(): Promise<Map<string, LibProgress>> {
  const rows = await (await db()).select<{ id: number; tmdb_type: MediaType; tmdb_id: number; season: number | null; owned: number; watched: number }[]>(
    `SELECT t.id, t.tmdb_type, t.tmdb_id, COALESCE(f.meta_season, f.season) AS season,
            COUNT(*) AS owned, SUM(CASE WHEN p.watched = 1 THEN 1 ELSE 0 END) AS watched
       FROM titles t JOIN files f ON f.title_id = t.id
       LEFT JOIN playback p ON p.fingerprint = f.fingerprint
      WHERE t.tmdb_id IS NOT NULL AND f.role IN ('episode', 'movie')
      GROUP BY t.id, season`,
  );
  const m = new Map<string, LibProgress>();
  for (const r of rows) {
    const k = `${r.tmdb_type}:${r.tmdb_id}`;
    const p = m.get(k) ?? { titleId: r.id, owned: 0, watched: 0, seasons: new Map() };
    p.owned += r.owned;
    p.watched += r.watched;
    if (r.season !== null && r.season > 0) p.seasons.set(r.season, { owned: r.owned, watched: r.watched });
    m.set(k, p);
  }
  return m;
}

export type EntryInfo = {
  e: FEntry;
  released: boolean;
  watched: boolean;
  libraryId: number | null;
  owned: boolean; // this entry (or its season) has files
  progress: number | null; // 0–1 for owned series / seasons
  saved: boolean;
};

/** Live state of each entry from the library, the watched set and the watchlist. */
export function useEntryInfo(entries: FEntry[]): EntryInfo[] | null {
  const v = useLibraryVersion();
  const seen = useSeen();
  const watchlist = useWatchlist();
  const [lib, setLib] = useState<Map<string, LibProgress> | null>(null);
  useEffect(() => {
    libraryProgress().then(setLib).catch(() => setLib(new Map()));
  }, [v]);
  return useMemo(() => (lib ? entryInfo(entries, lib, seen, watchlist) : null), [entries, lib, seen, watchlist]);
}

export function entryInfo(entries: FEntry[], lib: Map<string, LibProgress>, seen: { type: MediaType; id: number }[], watchlist: Item[]): EntryInfo[] {
  return entries.map((e) => {
    const lp = lib.get(`${e.type}:${e.id}`);
    const sp = e.season ? lp?.seasons.get(e.season) : undefined;
    const ownedCount = e.season ? sp?.owned ?? 0 : lp?.owned ?? 0;
    const watchedCount = e.season ? sp?.watched ?? 0 : lp?.watched ?? 0;
    const libFinished = ownedCount > 0 && watchedCount >= ownedCount;
    const manual = seen.some((s) => s.type === e.type && s.id === e.id);
    return {
      e,
      released: !!e.date && !isFuture(e.date),
      watched: libFinished || manual,
      libraryId: lp?.titleId ?? null,
      owned: ownedCount > 0,
      progress: ownedCount > 0 ? watchedCount / ownedCount : null,
      saved: onWatchlist(watchlist, e.type, e.id),
    };
  });
}

/** For Home: the next owned, unwatched entry of every followed collection. */
export function useFollowedNextUp(): { c: Coll; x: EntryInfo }[] {
  const states = useCollectionStates();
  const v = useLibraryVersion();
  const seen = useSeen();
  const watchlist = useWatchlist();
  const [out, setOut] = useState<{ c: Coll; x: EntryInfo }[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const followed = [...states.values()].filter((s) => s.followed);
      if (!followed.length) return alive && setOut([]);
      const lib = await libraryProgress();
      const res: { c: Coll; x: EntryInfo }[] = [];
      for (const s of followed) {
        const c = await loadCollection(s.key).catch(() => null);
        if (!c) continue;
        const order = s.order_id && c.orders.some((o) => o.id === s.order_id) ? s.order_id : "release";
        const info = entryInfo(orderedEntries(c, order), lib, seen, watchlist);
        const next = info.find((x) => x.released && !x.watched);
        if (next && next.owned) res.push({ c, x: next });
      }
      if (alive) setOut(res.slice(0, 12));
    })();
    return () => {
      alive = false;
    };
  }, [states, v, seen, watchlist]);
  return out;
}

/** An Item for a collection entry, for cards and the TMDB page. */
export const entryItem = (e: FEntry): Item => ({
  type: e.type, id: e.id, name: e.season ? `${e.title}` : e.title, date: e.date, year: e.year,
  poster: e.poster, backdrop: e.backdrop, overview: e.note ?? "", rating: null, votes: 0, genreIds: [],
});

/** Library titles that belong to a collection (for Library → Collections). */
export function ownedIn(c: Coll, titles: TitleRow[]): TitleRow[] {
  return titles.filter((t) => t.tmdb_id && c.entries.some((e) => e.type === t.tmdb_type && e.id === t.tmdb_id));
}
