import { useEffect, useMemo, useState } from "react";
import { listTitles, type TitleRow } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { toggleSeen, useWatchedKeys } from "../library/seen";
import { addToWatchlist, onWatchlist, useWatchlist } from "../library/watchlist";
import { listById } from "../discover/toplists";
import { listProgress, useTopList, type Ranked } from "../discover/toplistData";
import { IMDB_CREDIT, setRatingSource, useImdb, fmtVotes } from "../discover/imdb";
import { PageScroll, useNav } from "../app/nav";
import DiscoverCard, { Poster } from "../components/browse/DiscoverCard";
import { EmptyState, EndSentinel, OfflineStrip, SkeletonCards, reveal } from "../components/browse/Grid";
import { Rating } from "../components/browse/cards";
import { showToast } from "../components/Toast";
import { IconCheck, IconEye, IconGrid, IconList, IconPlus, IconShuffle, IconTrophy } from "../components/icons";
import { tmdbImg } from "../lib/img";

type Show = "all" | "unseen" | "seen";

export default function TopListPage({ id }: { id: string }) {
  const l = listById(id);
  const v = useLibraryVersion();
  const { push } = useNav();
  const imdb = useImdb();
  const canImdb = !!l?.imdb && imdb.enabled && imdb.count > 0;
  const source = canImdb && imdb.source === "imdb" ? "imdb" : "tmdb";
  const { rows, loading, error, done, loadMore } = useTopList(l, source);
  const watched = useWatchedKeys();
  const watchlist = useWatchlist();
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [show, setShow] = useState<Show>("all");
  const [hideOwned, setHideOwned] = useState(false);
  const [view, setView] = useState<"grid" | "rows">("grid");
  useEffect(() => {
    listTitles().then(setTitles);
  }, [v]);
  const owned = useMemo(() => new Map(titles.filter((t) => t.tmdb_id).map((t) => [`${t.tmdb_type}:${t.tmdb_id}`, t.id])), [titles]);
  const key = (r: Ranked) => (r.item ? `${r.item.type}:${r.item.id}` : "");

  const seenCount = rows.filter((r) => r.item && watched.has(key(r))).length;
  useEffect(() => {
    if (l && done) listProgress.set(l.id, { seen: seenCount, total: rows.length });
  }, [l, done, seenCount, rows.length]);

  // Ranks are the list's ranks: hiding seen titles leaves gaps in the numbers.
  const shown = rows.filter((r) => {
    if (!r.item) return false;
    const k = key(r);
    if (show === "unseen" && watched.has(k)) return false;
    if (show === "seen" && !watched.has(k)) return false;
    if (hideOwned && owned.has(k)) return false;
    return true;
  });

  if (!l)
    return (
      <PageScroll className="center-page">
        <EmptyState title="This list doesn't exist any more" action={<button className="btn" onClick={() => push({ page: "discover", tab: "toplists" })}>All Top Lists</button>} />
      </PageScroll>
    );

  const art = rows.slice(0, 3).map((r) => r.item?.backdrop).filter(Boolean) as string[];
  const total = done ? rows.length : l.size;
  const unseen = rows.filter((r) => r.item && !watched.has(key(r)) && !owned.has(key(r)));

  return (
    <PageScroll className="tlpage">
      <header className="tl-hero">
        <div className="tl-hero-art" aria-hidden>
          {art.map((a, i) => <img key={a} src={tmdbImg(a, "w780")} alt="" className={`tl-hero-${i}`} onLoad={(e) => e.currentTarget.classList.add("in")} />)}
        </div>
        <div className="tl-hero-body">
          <div className="hero-kicker"><IconTrophy /> Top List</div>
          <h1>{source === "imdb" ? `${l.title} by IMDb rating` : l.title}</h1>
          <p>{l.blurb}</p>
          <div className="tl-progress">
            <span className="tl-progress-text"><b>{seenCount}</b> of {total} seen</span>
            <span className="tl-bar big"><span style={{ transform: `scaleX(${total ? seenCount / total : 0})` }} /></span>
          </div>
        </div>
      </header>

      <div className="tl-controls">
        <div className="seg">
          {(["all", "unseen", "seen"] as Show[]).map((s) => (
            <button key={s} className={show === s ? "on" : ""} onClick={() => setShow(s)}>
              {s === "all" ? "All" : s === "unseen" ? "Unseen" : "Seen"}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} /> Hide what I own
        </label>
        {canImdb && (
          <div className="seg" title="Which rating ranks this list">
            <button className={source === "tmdb" ? "on" : ""} onClick={() => setRatingSource("tmdb")}>TMDB</button>
            <button className={source === "imdb" ? "on" : ""} onClick={() => setRatingSource("imdb")}>IMDb</button>
          </div>
        )}
        <div className="filter-spacer" />
        {unseen.length > 0 && (
          <button
            className="btn"
            onClick={() => {
              const pick = unseen[Math.floor(Math.random() * unseen.length)].item!;
              push({ page: "tmdb", type: pick.type, id: pick.id, seed: pick });
            }}
          >
            <IconShuffle /> Pick one for me
          </button>
        )}
        {l.size === 50 && done && unseen.length > 0 && (
          <button
            className="btn"
            onClick={async () => {
              const add = unseen.filter((r) => !onWatchlist(watchlist, r.item!.type, r.item!.id));
              for (const r of add) await addToWatchlist(r.item!);
              showToast(`Added ${add.length} titles to your watchlist`);
            }}
          >
            <IconPlus /> Add unseen to watchlist
          </button>
        )}
        <div className="seg icons" aria-label="View">
          <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} title="Posters" aria-label="Posters"><IconGrid /></button>
          <button className={view === "rows" ? "on" : ""} onClick={() => setView("rows")} title="Ranked list" aria-label="Ranked list"><IconList /></button>
        </div>
      </div>

      <OfflineStrip onRetry={loadMore} />
      {error && rows.length === 0 ? (
        <EmptyState title="Couldn't load this list" text="TMDB didn't answer. Lists you've opened before work offline." action={<button className="btn" onClick={loadMore}>Try again</button>} />
      ) : view === "grid" ? (
        <div className="pgrid ranked reveal">
          {shown.map((r, n) => (
            <DiscoverCard key={key(r)} item={r.item!} rank={r.rank} libraryId={owned.get(key(r))} style={reveal(n)} />
          ))}
          {loading && <SkeletonCards count={rows.length ? 6 : 18} />}
        </div>
      ) : (
        <ol className="rank-rows">
          {shown.map((r) => (
            <RankRow key={key(r)} r={r} libraryId={owned.get(key(r))} seen={watched.has(key(r))} />
          ))}
          {loading && Array.from({ length: 6 }, (_, i) => <li key={i} className="rank-row skel" />)}
        </ol>
      )}
      <EndSentinel active={!loading && !done && !error} onMore={loadMore} />
      {done && shown.length === 0 && rows.length > 0 && (
        <EmptyState title={show === "unseen" ? "You've seen everything on this list" : "Nothing to show"} text={show === "unseen" ? "Impressive. Try another list." : undefined} />
      )}
      {source === "imdb" && <p className="credit-line">{IMDB_CREDIT} Ranked on this PC from IMDb's public ratings; IMDb's own charts use a different formula.</p>}
      {source === "tmdb" && <p className="credit-line">Ranked by TMDB user ratings.</p>}
    </PageScroll>
  );
}

function RankRow({ r, libraryId, seen }: { r: Ranked; libraryId?: number; seen: boolean }) {
  const { push } = useNav();
  const watchlist = useWatchlist();
  const it = r.item!;
  const saved = onWatchlist(watchlist, it.type, it.id);
  return (
    <li className="rank-row">
      <span className="rank-row-num">{r.rank}</span>
      <button className="rank-row-main" onClick={() => push(libraryId ? { page: "title", id: libraryId } : { page: "tmdb", type: it.type, id: it.id, seed: it })}>
        <span className="rank-row-poster"><Poster item={it} size="w185" /></span>
        <span className="rank-row-text">
          <span className="rank-row-title">{it.name} {it.year ? <span className="year">{it.year}</span> : null}</span>
          <span className="rank-row-facts">
            {r.imdb ? <span className="rpair"><b className="src imdb">IMDb</b>{r.imdb.rating.toFixed(1)} <small>{fmtVotes(r.imdb.votes)}</small></span> : null}
            {it.rating ? <span className="rpair">{r.imdb ? <b className="src">TMDB</b> : null}<Rating value={it.rating} /></span> : null}
            {libraryId ? <span className="dcard-badge have inline">In your library</span> : null}
          </span>
          <span className="rank-row-overview">{it.overview}</span>
        </span>
      </button>
      <div className="rank-row-acts">
        <button className={`dcard-act static ${seen ? "on seen" : ""}`} onClick={async () => { const x = await toggleSeen(it); showToast(x.seen ? `Marked ${it.name} as watched` : `Removed ${it.name} from watched`, x.undo); }} title={seen ? "Watched" : "I've watched this"} aria-label="Watched">
          {seen ? <IconCheck /> : <IconEye />}
        </button>
        {!libraryId && (
          <button className={`dcard-act static ${saved ? "on" : ""}`} onClick={() => (saved ? null : addToWatchlist(it))} title={saved ? "On your watchlist" : "Add to watchlist"} aria-label="Watchlist">
            {saved ? <IconCheck /> : <IconPlus />}
          </button>
        )}
      </div>
    </li>
  );
}
