// Loading a Top List: TMDB pages (cached on disk for a week, so reopening a
// list costs nothing and works offline) or IMDb-ranked rows from the local
// IMDb table, resolved to TMDB titles page by page.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiCached, DAY } from "./cache";
import { discoverPage, listPage, type Item } from "./api";
import { imdbRanked, tmdbForImdb } from "./imdb";
import { PAGE_SIZE, pagesFor, type TopList } from "./toplists";

export type Ranked = { rank: number; item: Item | null; imdb?: { rating: number; votes: number } };

const WEEK = 7 * DAY;
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export function tmdbListPage(l: TopList, page: number): Promise<Item[]> {
  // The definition is part of the key, so changing a list's rules never serves old pages.
  const def = JSON.stringify([l.tmdb.path ?? "", l.tmdb.params]).replace(/\d{4}-\d{2}-\d{2}/g, (d) => d.slice(0, 7));
  return apiCached(`toplist:${l.id}:${hash(def)}:${page}`, WEEK, async () => {
    const res = l.tmdb.path ? await listPage(l.tmdb.path, l.tmdb.params, l.type, page) : await discoverPage(l.type, l.tmdb.params, page);
    return res.items;
  });
}

// Seen counts per list for the gallery tiles, from lists opened this session.
export const listProgress = new Map<string, { seen: number; total: number }>();

export function useTopList(l: TopList | undefined, source: "tmdb" | "imdb") {
  const [rows, setRows] = useState<Ranked[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const next = useRef(1);
  const imdbRows = useRef<{ tconst: string; rating: number; votes: number }[] | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    gen.current++;
    setRows([]);
    setDone(false);
    setError(false);
    next.current = 1;
    busy.current = false;
    imdbRows.current = null;
  }, [l?.id, source]);

  // One page at a time: the page number is claimed before any await, so two
  // callers (the first-pages effect and the scroll sentinel) never load the same page.
  const busy = useRef(false);
  const loadMore = useCallback(async () => {
    if (!l || busy.current || done) return;
    busy.current = true;
    const g = gen.current;
    const page = next.current++;
    setLoading(true);
    setError(false);
    try {
      if (source === "imdb" && l.imdb) {
        imdbRows.current ??= await imdbRanked(l.imdb, l.size);
        const all = imdbRows.current;
        const start = (page - 1) * PAGE_SIZE;
        const slice = all.slice(start, start + PAGE_SIZE);
        const items = await Promise.all(slice.map((r) => tmdbForImdb(r.tconst).catch(() => null)));
        if (g !== gen.current) return;
        setRows((cur) => [
          ...cur,
          ...slice.map((r, i) => ({ rank: start + i + 1, item: items[i], imdb: { rating: r.rating, votes: r.votes } })),
        ]);
        if (start + PAGE_SIZE >= all.length) setDone(true);
      } else {
        const items = await tmdbListPage(l, page);
        if (g !== gen.current) return;
        setRows((cur) => {
          const have = new Set(cur.map((r) => (r.item ? `${r.item.type}:${r.item.id}` : "")));
          const add = items.filter((i) => !have.has(`${i.type}:${i.id}`));
          return [...cur, ...add.map((item, i) => ({ rank: cur.length + i + 1, item }))].slice(0, l.size);
        });
        if (page >= pagesFor(l) || items.length === 0) setDone(true);
      }
    } catch {
      if (g === gen.current) {
        next.current = page; // retry this page next time
        setError(true);
      }
    } finally {
      busy.current = false;
      if (g === gen.current) setLoading(false);
    }
  }, [l, source, done]);

  // The first two pages straight away; the rest as the user scrolls.
  useEffect(() => {
    if (l && rows.length < PAGE_SIZE * 2 && !loading && !done && !error) loadMore();
  }, [l, rows.length, loading, done, error, loadMore]);

  return { rows, loading, error, done, loadMore };
}
