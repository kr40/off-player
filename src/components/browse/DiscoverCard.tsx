import { useEffect, useRef, useState } from "react";
import { isFuture, niceDate, type Item } from "../../discover/api";
import { reasonText, type SeedRef } from "../../discover/recommend";
import { dismissRec } from "../../discover/recs";
import { RatingBadge } from "./ratings";
import { addToWatchlist, onWatchlist, removeFromWatchlist, useWatchlist } from "../../library/watchlist";
import { findSeen, toggleSeen, useSeen } from "../../library/seen";
import { morphFrom, useNav } from "../../app/nav";
import { showToast } from "../Toast";
import { img, tmdbImg } from "../../lib/img";
import { IconCheck, IconEye, IconNo, IconPlus } from "../icons";

export const REACTION_LABEL = { 2: "Loved it", 1: "Liked it", [-1]: "Not for me" } as const;

/** True once the element has come within a screen of the viewport (stays true). */
export function useNearView<T extends Element>(ref: React.RefObject<T | null>, margin = "200px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near, margin]);
  return near;
}

/** Poster that fades in once decoded; falls back from the cached copy to TMDB to a titled placeholder. */
export function Poster({ item, artRef, size = "w342" }: { item: Item; artRef?: React.RefObject<HTMLImageElement | null>; size?: string }) {
  // 0: cached copy (if any), 1: TMDB, 2: neither loaded → placeholder with the title.
  const [stage, setStage] = useState(item.posterLocal ? 0 : 1);
  const [ready, setReady] = useState(false);
  const broken = stage === 2 || (!item.poster && !item.posterLocal);
  const src = stage === 0 && item.posterLocal ? img(item.posterLocal) : tmdbImg(item.poster, size);
  if (!src || broken) return <span className="tcard-ph dcard-ph">{item.name}</span>;
  return (
    <img
      ref={artRef}
      key={stage}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`fade-img ${ready ? "in" : ""}`}
      onLoad={() => setReady(true)}
      onError={() => setStage((s) => (s === 0 && item.poster ? 1 : 2))}
    />
  );
}

/**
 * Poster card for a TMDB title. Opens the library page when you already have it.
 * Hover actions (siblings of the poster button, never nested): Watchlist,
 * Watched, and Not interested for suggestions.
 */
export default function DiscoverCard({ item, libraryId, reasons, quietReason, dismissable, showReaction, rank, style }: {
  item: Item;
  libraryId?: number;
  reasons?: SeedRef[];
  quietReason?: boolean; // reason in the tooltip only (the row title already says it)
  dismissable?: boolean;
  showReaction?: boolean;
  rank?: number;
  style?: React.CSSProperties;
}) {
  const { push } = useNav();
  const art = useRef<HTMLImageElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const near = useNearView(box);
  const watchlist = useWatchlist();
  const seenList = useSeen();
  const saved = onWatchlist(watchlist, item.type, item.id);
  const seen = findSeen(seenList, item.type, item.id);
  const upcoming = isFuture(item.date);
  const why = reasons?.length ? reasonText(reasons) : "";

  const badge = libraryId ? (
    <span className="dcard-badge have">In your library</span>
  ) : seen ? (
    <span className="dcard-badge seen">{showReaction ? REACTION_LABEL[seen.reaction] : "Watched"}</span>
  ) : upcoming ? (
    <span className="dcard-badge">{niceDate(item.date)}</span>
  ) : null;

  return (
    <div className={`dcard ${rank ? "ranked" : ""}`} ref={box} style={style} data-card>
      <button
        className="pcard"
        title={why ? `${item.name}\n${why}` : item.name}
        onClick={() => {
          morphFrom(art.current);
          push(libraryId ? { page: "title", id: libraryId } : { page: "tmdb", type: item.type, id: item.id, seed: item });
        }}
      >
        <span className="pcard-art">
          <Poster item={item} artRef={art} />
          {!upcoming && <RatingBadge item={item} near={near} />}
          {badge}
          {rank ? <span className="rank-num" aria-label={`Rank ${rank}`}>{rank}</span> : null}
        </span>
        <span className="pcard-name">{item.name}</span>
        <span className="pcard-sub">
          {why && !quietReason ? why : <>{item.type === "tv" ? "Series" : "Movie"}{item.year ? ` · ${item.year}` : ""}</>}
        </span>
      </button>
      {(!libraryId || saved) && (
        <div className="dcard-actions">
          <button
            className={`dcard-act ${saved ? "on" : ""}`}
            data-act="watchlist"
            onClick={async () => {
              if (!saved) return addToWatchlist(item);
              const undo = await removeFromWatchlist(item.type, item.id);
              if (undo) showToast(`Removed ${item.name} from your watchlist`, undo);
            }}
            aria-label={saved ? `Remove ${item.name} from your watchlist` : `Add ${item.name} to your watchlist`}
            title={saved ? "On your watchlist — click to remove (L)" : "Add to watchlist (L)"}
          >
            {saved ? <IconCheck /> : <IconPlus />}
          </button>
          {!libraryId && (
            <button
              className={`dcard-act seen ${seen ? "on" : ""}`}
              data-act="watched"
              onClick={async () => {
                const r = await toggleSeen(item);
                showToast(r.seen ? `Marked ${item.name} as watched` : `Removed ${item.name} from watched`, r.undo);
              }}
              aria-label={seen ? `Unmark ${item.name} as watched` : `Mark ${item.name} as watched`}
              title={seen ? "Watched — click to unmark (W)" : "I've watched this (W)"}
            >
              <IconEye />
            </button>
          )}
          {dismissable && !libraryId && (
            <button
              className="dcard-act"
              onClick={async () => showToast(`You won't see ${item.name} in suggestions`, await dismissRec(item))}
              aria-label={`Not interested in ${item.name}`}
              title="Not interested"
            >
              <IconNo />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
