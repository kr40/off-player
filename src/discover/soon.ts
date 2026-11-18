// Release dates for what the user cares about: watchlist titles not out yet
// (or out in the last 14 days), and next episodes of series on the watchlist
// or in the library. Shared by Discover → Coming Soon and Home's "Out now" row.
import { useEffect, useState } from "react";
import { listTitles } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { useWatchlist } from "../library/watchlist";
import { details, isFuture, type Item } from "./api";
import { pool } from "../lib/pool";

export type Dated = { item: Item; date: string; label: string; libraryId?: number; kind: "release" | "episode" };

const DAY = 86_400_000;
export const OUT_NOW_DAYS = 14;
const ago = (date: string) => (Date.now() - new Date(`${date}T00:00:00`).getTime()) / DAY;

export function useFromYourList(): { outNow: Dated[]; upcoming: Dated[]; loading: boolean } {
  const watchlist = useWatchlist();
  const v = useLibraryVersion();
  const [episodes, setEpisodes] = useState<Dated[]>([]);
  const [loading, setLoading] = useState(true);
  const wlKey = watchlist.map((i) => `${i.type}:${i.id}`).join(",");

  useEffect(() => {
    let alive = true;
    (async () => {
      const titles = await listTitles();
      const series: { item: Item; libraryId?: number }[] = [
        ...watchlist.filter((i) => i.type === "tv").map((item) => ({ item })),
        ...titles
          .filter((t) => t.tmdb_type === "tv" && t.tmdb_id)
          .map((t) => ({
            libraryId: t.id,
            item: { type: "tv" as const, id: t.tmdb_id!, name: t.tmdb_name ?? t.name, date: null, year: t.tmdb_year, poster: null, backdrop: null, overview: "", rating: t.rating, votes: 0, genreIds: [] },
          })),
      ];
      const out: Dated[] = [];
      await pool(series.slice(0, 40), 4, async ({ item, libraryId }) => {
        try {
          const d = await details("tv", item.id);
          const n = d.nextEpisode;
          if (n && isFuture(n.date)) {
            out.push({ item: { ...d, posterLocal: item.posterLocal }, date: n.date, label: `S${n.season} E${n.episode}${n.name ? ` · ${n.name}` : ""}`, libraryId, kind: "episode" });
          } else if (d.lastAir && ago(d.lastAir) <= 7 && ago(d.lastAir) >= 0 && d.status !== "Ended") {
            out.push({ item: { ...d, posterLocal: item.posterLocal }, date: d.lastAir, label: "New episode", libraryId, kind: "episode" });
          }
        } catch {
          // offline: skip
        }
      });
      if (alive) {
        setEpisodes(out);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [wlKey, v]);

  const releases: Dated[] = watchlist
    .filter((i) => i.date)
    .map((i) => ({ item: i, date: i.date!, label: i.type === "tv" ? "Premieres" : "Release", kind: "release" as const }));
  const outNow = [
    ...releases.filter((r) => ago(r.date) >= 0 && ago(r.date) <= OUT_NOW_DAYS),
    ...episodes.filter((e) => !isFuture(e.date)),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = [...releases.filter((r) => isFuture(r.date)), ...episodes.filter((e) => isFuture(e.date))].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return { outNow, upcoming, loading };
}
