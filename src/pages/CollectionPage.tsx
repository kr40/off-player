import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getTitle, titleFiles } from "../library/db";
import { firstEpisode, nextUp, playItem, sharedChecker } from "../library/present";
import { toggleSeen } from "../library/seen";
import { addToWatchlist } from "../library/watchlist";
import {
  entryItem, loadCollection, markOpened, orderedEntries, setCollectionOrder, setFollowed, useCollectionStates, useEntryInfo,
  type Coll, type EntryInfo,
} from "../discover/collections";
import { niceDate } from "../discover/api";
import { RatingPair } from "../components/browse/TitleExtras";
import { PageScroll, useNav } from "../app/nav";
import { SlidingTabs } from "../app/TopNav";
import { EmptyState } from "../components/browse/Grid";
import { Poster } from "../components/browse/DiscoverCard";
import { showToast } from "../components/Toast";
import { IconBookmark, IconCheck, IconEye, IconLayers, IconPlay, IconPlus } from "../components/icons";
import { tmdbImg } from "../lib/img";
import { fmtRuntime } from "../lib/format";

/** Animate items to their new places when the order changes (FLIP: transform only). */
function useFlip(box: React.RefObject<HTMLElement | null>, key: string) {
  const prev = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>("[data-flip]")];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const it of items) {
      const old = prev.current.get(it.dataset.flip!);
      const now = it.getBoundingClientRect();
      if (old && !reduce) {
        const dy = old.top - now.top;
        if (Math.abs(dy) > 1) {
          it.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
        }
      }
    }
    const next = new Map<string, DOMRect>();
    for (const it of items) next.set(it.dataset.flip!, it.getBoundingClientRect());
    prev.current = next;
  }, [key]);
  // Positions also change when the page scrolls; re-measure right before a change.
  return () => {
    const el = box.current;
    if (!el) return;
    const m = new Map<string, DOMRect>();
    for (const it of el.querySelectorAll<HTMLElement>("[data-flip]")) m.set(it.dataset.flip!, it.getBoundingClientRect());
    prev.current = m;
  };
}

export default function CollectionPage({ ckey }: { ckey: string }) {
  const { play } = useNav();
  const states = useCollectionStates();
  const [c, setC] = useState<Coll | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setC(undefined);
    loadCollection(ckey)
      .then((x) => alive && setC(x))
      .catch(() => alive && setC(null));
    markOpened(ckey);
    return () => {
      alive = false;
    };
  }, [ckey, attempt]);

  const st = states.get(ckey);
  const orderId = st?.order_id && c?.orders.some((o) => o.id === st.order_id) ? st.order_id : "release";
  const entries = useMemo(() => (c ? orderedEntries(c, orderId) : []), [c, orderId]);
  const info = useEntryInfo(entries);
  const list = useRef<HTMLOListElement>(null);
  const remember = useFlip(list, `${orderId}:${entries.length}`);
  const next = info ? info.findIndex((x) => x.released && !x.watched) : -1;

  // Scroll to Next up when the page opens.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !info || next < 2) return;
    scrolled.current = true;
    requestAnimationFrame(() => list.current?.querySelector(".tl-entry.next")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [info, next]);

  if (c === undefined) return <PageScroll><div className="hero hero-title skeleton" /></PageScroll>;
  if (c === null)
    return (
      <PageScroll className="center-page">
        <EmptyState
          icon={<IconLayers />}
          title="Couldn't load this collection"
          text="TMDB didn't answer. Collections you've opened before work offline."
          action={<button className="btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button>}
        />
      </PageScroll>
    );

  const released = info?.filter((x) => x.released) ?? [];
  const watchedN = released.filter((x) => x.watched).length;
  const movies = c.entries.filter((e) => e.type === "movie");
  const series = c.entries.filter((e) => e.type === "tv");
  const runtime = movies.reduce((a, e) => a + (e.runtime ?? 0), 0);
  const nextInfo = next >= 0 && info ? info[next] : null;
  const followed = !!st?.followed;

  const playEntry = async (x: EntryInfo) => {
    if (!x.libraryId) return;
    const t = await getTitle(x.libraryId);
    if (!t) return;
    const files = await titleFiles(t.id);
    const scoped = x.e.season ? files.filter((f) => (f.meta_season ?? f.season) === x.e.season) : files;
    const f = nextUp(scoped)?.file ?? firstEpisode(scoped) ?? scoped.find((f) => f.role === "movie");
    if (f) play(playItem(t, f, sharedChecker(files)(f)));
  };

  return (
    <PageScroll className="cpage">
      {c.backdrop && <div className="ambient" aria-hidden><img src={tmdbImg(c.backdrop, "w780")} alt="" /></div>}
      <section className="hero hero-title coll-hero">
        <div className="hero-bg">{c.backdrop && <img src={tmdbImg(c.backdrop, "w1280")} alt="" draggable={false} style={{ viewTransitionName: "hero-art" }} className="kenburns" />}</div>
        <div className="hero-vignette" />
        <div className="hero-body">
          <div className="hero-kicker"><IconLayers /> {c.kind === "franchise" ? "Collection" : "Movie collection"}</div>
          <h1 className="hero-title-text">{c.name}</h1>
          <div className="hero-facts">
            {movies.length > 0 && <span>{movies.length} movie{movies.length > 1 ? "s" : ""}</span>}
            {series.length > 0 && <span>{series.length} series</span>}
            {runtime > 0 && <span>{fmtRuntime(runtime * 60)} of movies</span>}
            {info && released.length > 0 && <span className="accent">{watchedN} of {released.length} watched</span>}
          </div>
          {c.blurb && <p className="hero-overview">{c.blurb}</p>}
          {info && released.length > 0 && (
            <span className="tl-bar big hero-bar"><span style={{ transform: `scaleX(${watchedN / released.length})` }} /></span>
          )}
          <div className="hero-buttons">
            {nextInfo && nextInfo.owned ? (
              <button className="btn-play" onClick={() => playEntry(nextInfo)}><IconPlay /> Play next: {nextInfo.e.title}{nextInfo.e.season ? ` S${nextInfo.e.season}` : ""}</button>
            ) : nextInfo ? (
              <button className="btn-play" onClick={() => list.current?.querySelector(".tl-entry.next")?.scrollIntoView({ block: "center", behavior: "smooth" })}>
                Next up: {nextInfo.e.title}
              </button>
            ) : null}
            <button className={`btn-glass ${followed ? "saved" : ""}`} onClick={() => setFollowed(ckey, !followed)} title="Show its next entry on Home">
              <IconBookmark /> {followed ? "Following" : "Follow"}
            </button>
            {info && info.some((x) => !x.watched && !x.saved && !x.libraryId) && (
              <button
                className="btn-glass"
                onClick={async () => {
                  const add = info.filter((x) => !x.watched && !x.saved && !x.libraryId);
                  for (const x of add) await addToWatchlist(entryItem(x.e));
                  showToast(`Added ${add.length} to your watchlist`);
                }}
              >
                <IconPlus /> Add unwatched to watchlist
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="tp-body">
        {c.orders.length > 1 && (
          <div className="order-switch">
            <SlidingTabs
              className="order-tabs"
              label="Order"
              items={c.orders.map((o) => ({ id: o.id, label: o.label }))}
              active={orderId}
              onPick={(id) => {
                remember();
                setCollectionOrder(ckey, id);
              }}
            />
            <span className="hint">{orderId === "release" ? "In the order they came out." : "In the order the story happens."}</span>
          </div>
        )}

        <ol className="timeline" ref={list}>
          {(info ?? entries.map((e) => ({ e, released: true, watched: false, libraryId: null, owned: false, progress: null, saved: false }))).map((x, i) => (
            <TimelineEntry key={x.e.ref} x={x} n={i + 1} next={i === next} onPlay={() => playEntry(x)} />
          ))}
        </ol>

        {c.sources.length > 0 && (
          <p className="credit-line">
            Story order checked against{" "}
            {c.sources.map((s, i) => (
              <span key={s}>
                {i > 0 && ", "}
                <button className="link-btn inline" onClick={() => openUrl(s)}>{new URL(s).hostname.replace(/^www\./, "")}</button>
              </span>
            ))}
            .
          </p>
        )}
      </div>
    </PageScroll>
  );
}

function TimelineEntry({ x, n, next, onPlay }: { x: EntryInfo; n: number; next: boolean; onPlay: () => void }) {
  const { push } = useNav();
  const item = entryItem(x.e);
  const e = x.e;
  const rating = e.rating;
  return (
    <li className={`tl-entry ${next ? "next" : ""} ${x.watched ? "done" : ""} ${!x.released ? "future" : ""}`} data-flip={e.ref}>
      <span className="tl-num">{x.watched ? <IconCheck /> : n}</span>
      <button
        className="tl-main"
        onClick={() => push(x.libraryId ? { page: "title", id: x.libraryId, season: e.season } : { page: "tmdb", type: e.type, id: e.id, seed: item })}
      >
        <span className="tl-poster"><Poster item={item} size="w185" /></span>
        <span className="tl-text">
          {next && <span className="next-tag">Next up</span>}
          <span className="tl-name">
            {e.title}
            {e.season ? <span className="year"> · Season {e.season}</span> : null}
          </span>
          <span className="tl-facts">
            <span className="type-badge">{e.season ? `Season ${e.season}` : e.type === "tv" ? "Series" : "Movie"}</span>
            <span>{!x.released ? (e.date ? `Coming ${niceDate(e.date)}` : "Not released yet") : e.year ?? ""}</span>
            {x.released && <RatingPair type={e.type} id={e.id} tmdb={rating ?? null} />}
          </span>
          {e.note && <span className="tl-note">{e.note}</span>}
          {x.progress !== null && x.progress > 0 && x.progress < 1 && (
            <span className="tl-bar"><span style={{ transform: `scaleX(${x.progress})` }} /></span>
          )}
        </span>
      </button>
      <div className="tl-acts">
        {x.libraryId && x.owned ? (
          <button className="btn small primary" onClick={onPlay}><IconPlay /> {x.progress && x.progress > 0 && x.progress < 1 ? "Resume" : "Play"}</button>
        ) : x.libraryId ? (
          <span className="dcard-badge have inline">In your library</span>
        ) : null}
        {!x.libraryId && x.released && (
          <button
            className={`dcard-act static ${x.watched ? "on seen" : ""}`}
            title={x.watched ? "Watched — click to unmark" : "I've watched this"}
            aria-label={x.watched ? `Unmark ${e.title}` : `Mark ${e.title} watched`}
            onClick={async () => {
              const r = await toggleSeen(item);
              showToast(r.seen ? `Marked ${e.title} as watched` : `Removed ${e.title} from watched`, r.undo);
            }}
          >
            {x.watched ? <IconCheck /> : <IconEye />}
          </button>
        )}
        {!x.libraryId && !x.watched && (
          <button className={`dcard-act static ${x.saved ? "on" : ""}`} title={x.saved ? "On your watchlist" : "Add to watchlist"} aria-label="Watchlist" onClick={() => !x.saved && addToWatchlist(item)}>
            {x.saved ? <IconCheck /> : <IconPlus />}
          </button>
        )}
      </div>
    </li>
  );
}
