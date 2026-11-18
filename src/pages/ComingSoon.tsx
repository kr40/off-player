import { useEffect, useMemo, useState } from "react";
import { discoverPage, niceDate, type Item } from "../discover/api";
import { useFromYourList, type Dated } from "../discover/soon";
import { kindMatches, useKind } from "../discover/kind";
import { isoDate, DAILIES } from "../discover/filters";
import { useNav } from "../app/nav";
import { KindSwitch } from "./DiscoverForYou";
import { Poster } from "../components/browse/DiscoverCard";
import DiscoverCard from "../components/browse/DiscoverCard";
import { EmptyState, OfflineStrip, reveal } from "../components/browse/Grid";
import { IconCalendar } from "../components/icons";

const monthLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return "This month";
  return d.toLocaleDateString(undefined, { month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
};

/** Discover → Coming Soon: your list's dates first, then everything coming, by month. */
export default function ComingSoon() {
  const kind = useKind();
  const mine = useFromYourList();
  const [upcoming, setUpcoming] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const from = isoDate(new Date(Date.now() + 86_400_000));
    const to = isoDate(new Date(Date.now() + 200 * 86_400_000));
    Promise.all([
      discoverPage("movie", { "primary_release_date.gte": from, "primary_release_date.lte": to, sort_by: "popularity.desc", with_release_type: "2|3" }, 1),
      discoverPage("movie", { "primary_release_date.gte": from, "primary_release_date.lte": to, sort_by: "popularity.desc", with_release_type: "2|3" }, 2),
      discoverPage("tv", { "first_air_date.gte": from, "first_air_date.lte": to, sort_by: "popularity.desc", without_genres: DAILIES.join(",") }, 1),
      discoverPage("tv", { "first_air_date.gte": from, "first_air_date.lte": to, sort_by: "popularity.desc", without_genres: DAILIES.join(",") }, 2),
    ])
      .then((pages) => {
        if (!alive) return;
        const seen = new Set<string>();
        const all = pages.flatMap((p) => p.items).filter((i) => i.date && !seen.has(`${i.type}:${i.id}`) && !!seen.add(`${i.type}:${i.id}`));
        setUpcoming(all.sort((a, b) => a.date!.localeCompare(b.date!)));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const months = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of (upcoming ?? []).filter((i) => kindMatches(kind, i))) {
      const k = monthLabel(i.date!);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()];
  }, [upcoming, kind]);

  const mineShown = mine.upcoming.filter((d) => kindMatches(kind, d.item));
  const outShown = mine.outNow.filter((d) => kindMatches(kind, d.item));

  return (
    <div className="soon">
      <header className="tab-head">
        <div>
          <h1>Coming Soon</h1>
          <p>Release dates for what you're waiting for, then everything else on the way.</p>
        </div>
        <KindSwitch />
      </header>
      <OfflineStrip onRetry={() => setAttempt((a) => a + 1)} />

      {(outShown.length > 0 || mineShown.length > 0) && (
        <section className="tl-group">
          <div className="tl-group-head"><h2>From your list</h2><span>Watchlist titles and the series you follow</span></div>
          <ol className="date-list">
            {outShown.map((d) => <DateRow key={`o:${d.item.type}:${d.item.id}:${d.label}`} d={d} out />)}
            {mineShown.map((d) => <DateRow key={`u:${d.item.type}:${d.item.id}:${d.label}`} d={d} />)}
          </ol>
        </section>
      )}
      {!mine.loading && outShown.length === 0 && mineShown.length === 0 && (
        <p className="search-hint pad">Nothing on your watchlist has a date coming up. Add upcoming titles with + and they'll show here.</p>
      )}

      {failed && !upcoming ? (
        <EmptyState icon={<IconCalendar />} title="Couldn't load release dates" action={<button className="btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button>} />
      ) : (
        months.map(([label, items]) => (
          <section key={label} className="tl-group">
            <div className="tl-group-head month"><h2>{label}</h2><span>{items.length} titles</span></div>
            <div className="pgrid compact reveal">
              {items.map((i, n) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} style={reveal(n)} />)}
            </div>
          </section>
        ))
      )}
      {!upcoming && !failed && <div className="pgrid compact">{Array.from({ length: 12 }, (_, i) => <span key={i} className="dskel grid" />)}</div>}
    </div>
  );
}

function DateRow({ d, out }: { d: Dated; out?: boolean }) {
  const { push } = useNav();
  const date = new Date(`${d.date}T00:00:00`);
  return (
    <li className={`date-row ${out ? "out" : ""}`}>
      <span className="date-chip">
        <b>{date.getDate()}</b>
        <span>{date.toLocaleDateString(undefined, { month: "short" })}</span>
      </span>
      <button className="date-main" onClick={() => push(d.libraryId ? { page: "title", id: d.libraryId } : { page: "tmdb", type: d.item.type, id: d.item.id, seed: d.item })}>
        <span className="date-poster"><Poster item={d.item} size="w185" /></span>
        <span className="date-text">
          <span className="date-title">{d.item.name}</span>
          <span className="date-sub">{d.label}{d.libraryId ? " · In your library" : ""}</span>
        </span>
      </button>
      {out ? <span className="dcard-badge out inline">Out now</span> : <span className="date-when">{niceDate(d.date)}</span>}
    </li>
  );
}
