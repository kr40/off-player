import { titleFiles, type EpisodeRow, type SeasonRow, type TitleRow } from "../../library/db";
import { displayName, displayYear, epCode, epName, firstEpisode, genresOf, nextUp, playItem, progressOf, sharedChecker } from "../../library/present";
import type { ContinueItem } from "../../library/continue";
import { morphFrom, useNav } from "../../app/nav";
import { useRef } from "react";
import { img } from "../../lib/img";
import { fmtRuntime } from "../../lib/format";
import { IconEye, IconPlay, IconStar } from "../icons";
import { InlineRating, RatingBadge, ratedTitle } from "./ratings";
import { markTitleWatched } from "../../library/progress";
import { libraryChanged } from "../../library/store";
import { showToast } from "../Toast";

/** Thin progress line along the bottom of a still; full and green-ticked when watched. */
export function ProgressLine({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className={`progress-line ${value >= 1 ? "done" : ""}`} aria-label={value >= 1 ? "Watched" : `${Math.round(value * 100)}% watched`}>
      <span style={{ width: `${Math.max(3, value * 100)}%` }} />
    </span>
  );
}

export function timeLeft(f: { duration: number | null; pb_position: number | null }) {
  if (!f.duration) return "";
  const left = Math.max(0, f.duration - (f.pb_position ?? 0));
  const m = Math.round(left / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${Math.max(1, m)} min left`;
}

const art = (t: TitleRow) => t.backdrop ?? t.cover_thumb;

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function titleFacts(t: TitleRow): string[] {
  return [
    displayYear(t) ? String(displayYear(t)) : "",
    t.kind === "show" ? `${t.seasons} Season${t.seasons === 1 ? "" : "s"}` : fmtRuntime(t.runtime),
  ].filter(Boolean);
}

export function Rating({ value }: { value: number | null }) {
  if (!value) return null;
  return (
    <span className="rating">
      <IconStar /> {value.toFixed(1)}
    </span>
  );
}

/** Play whatever is next for the title: resume, next unwatched, or from the start. */
export async function playTitle(t: TitleRow, play: (i: ReturnType<typeof playItem>) => void) {
  const files = await titleFiles(t.id);
  const f = nextUp(files)?.file ?? firstEpisode(files);
  if (f) play(playItem(t, f, sharedChecker(files)(f)));
}

/** Continue Watching card: resume point or next episode, with a remove button. */
export function ContinueTile({ c, onRemove }: { c: ContinueItem; onRemove: () => void }) {
  const { play } = useNav();
  const { t, f } = c;
  const still = f.role === "episode" ? f.meta_still ?? f.thumb : t.backdrop ?? f.thumb;
  return (
    <div className="ccard">
      <button className="ecard" onClick={() => play(playItem(t, f, c.shared))} title={`${displayName(t)} · ${f.role === "episode" ? epCode(f) : ""}`}>
        <span className="ecard-art">
          {still ? <img src={img(still)} alt="" loading="lazy" draggable={false} /> : <span className="tcard-ph" />}
          <span className="ecard-play"><IconPlay /></span>
          {t.logo && <img className="ecard-logo" src={img(t.logo)} alt="" draggable={false} />}
          {c.mode === "resume" && <ProgressLine value={progressOf(f)} />}
          {c.mode === "next" && <span className="ccard-badge">Next episode</span>}
        </span>
        <span className="ecard-show">{displayName(t)}{f.role === "episode" ? ` · ${epCode(f)}` : ""}</span>
        <span className="ecard-title">{f.role === "episode" ? epName(f, c.shared) : displayName(t)}</span>
        <span className="ecard-meta dim">{c.mode === "resume" ? timeLeft(f) : f.duration ? fmtRuntime(f.duration) : ""}</span>
      </button>
      <button className="ccard-x" onClick={onRemove} aria-label={`Remove ${displayName(t)} from Continue Watching`} title="Remove from Continue Watching">×</button>
    </div>
  );
}

/** Landscape title card. On hover it lifts and shows its facts and a play button inside the art. */
export function TitleTile({ t }: { t: TitleRow }) {
  const { push, play } = useNav();
  const artRef = useRef<HTMLImageElement>(null);
  const open = () => {
    morphFrom(artRef.current);
    push({ page: "title", id: t.id });
  };
  const genres = genresOf(t).slice(0, 2);
  return (
    <div className="tcard" data-card>
      <button className="tcard-art" onClick={open} aria-label={displayName(t)}>
        {art(t) ? <img ref={artRef} src={img(art(t))} alt="" loading="lazy" draggable={false} /> : <span className="tcard-ph">{initials(displayName(t))}</span>}
        <span className="tcard-shade" />
        {t.logo ? (
          <img className="tcard-logo" src={img(t.logo)} alt="" draggable={false} />
        ) : (
          <span className="tcard-name">{displayName(t)}</span>
        )}
        <span className="tcard-info">
          <InlineRating item={ratedTitle(t)} />
          {titleFacts(t).map((f) => <span key={f}>{f}</span>)}
          {genres.length > 0 && <span className="genre">{genres.join(" · ")}</span>}
        </span>
      </button>
      <button className="round play tcard-play" onClick={() => playTitle(t, play)} aria-label={`Play ${displayName(t)}`} title="Play">
        <IconPlay />
      </button>
      <div className="dcard-actions tcard-acts">
        <WatchedButton t={t} />
      </div>
    </div>
  );
}

/** Episode still card; plays straight away. */
export function EpisodeTile({ e, t }: { e: EpisodeRow; t: TitleRow }) {
  const { play } = useNav();
  const still = e.meta_still ?? e.thumb;
  return (
    <button className="ecard" onClick={() => play(playItem(t, e))} title={`${displayName(t)} · ${epCode(e)}`}>
      <span className="ecard-art">
        {still ? <img src={img(still)} alt="" loading="lazy" draggable={false} /> : <span className="tcard-ph" />}
        <span className="ecard-play"><IconPlay /></span>
        {t.logo && <img className="ecard-logo" src={img(t.logo)} alt="" draggable={false} />}
        <ProgressLine value={progressOf(e)} />
      </span>
      <span className="ecard-show">{displayName(t)} · {epCode(e)}</span>
      <span className="ecard-title">{epName(e)}</span>
      <span className="ecard-meta"><Rating value={e.meta_rating} /></span>
    </button>
  );
}

/** Season poster; opens the show at that season. */
export function SeasonTile({ s, t }: { s: SeasonRow; t: TitleRow }) {
  const { push } = useNav();
  const poster = s.poster ?? t.poster ?? t.cover_thumb;
  const label = s.season === 0 ? "Specials" : s.name && !/^season \d+$/i.test(s.name) ? s.name : `Season ${s.season}`;
  return (
    <button className="scard" onClick={() => push({ page: "title", id: t.id, season: s.season })}>
      <span className="scard-art">
        {poster ? <img src={img(poster)} alt="" loading="lazy" draggable={false} /> : <span className="tcard-ph">{s.season}</span>}
      </span>
      <span className="scard-label">{label}</span>
      <span className="scard-sub">{displayName(t)}{s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ""}</span>
    </button>
  );
}

/** All of a library title's episodes (or its movie) are watched. */
export const titleWatched = (t: TitleRow) => t.mains > 0 && t.watched_mains >= t.mains;

/**
 * Round Watched button for a library card (W on a focused card): marks every
 * episode or the movie watched, or all unwatched again, with Undo.
 */
export function WatchedButton({ t }: { t: TitleRow }) {
  const done = titleWatched(t);
  const name = displayName(t);
  const what = t.kind === "show" ? "every episode" : "it";
  return (
    <button
      className={`dcard-act seen ${done ? "on" : ""}`}
      data-act="watched"
      onClick={async () => {
        const undo = await markTitleWatched(t.id, !done);
        libraryChanged();
        showToast(done ? `Marked ${name} as unwatched` : `Marked ${name} as watched`, async () => {
          await undo();
          libraryChanged();
        });
      }}
      aria-label={done ? `Mark ${name} as unwatched` : `Mark ${name} as watched`}
      title={done ? "Watched — click to mark as unwatched (W)" : `Mark ${what} as watched (W)`}
    >
      <IconEye />
    </button>
  );
}

/** Poster for grids, with a Watched action on hover. */
export function PosterTile({ t }: { t: TitleRow }) {
  const { push } = useNav();
  const artRef = useRef<HTMLImageElement>(null);
  const poster = t.poster ?? t.cover_thumb;
  const done = titleWatched(t);
  const started = !done && t.watched_mains > 0 && t.kind === "show";
  return (
    <div className="dcard lib-card" data-card>
      <button
        className="pcard"
        onClick={() => {
          morphFrom(artRef.current);
          push({ page: "title", id: t.id });
        }}
      >
        <span className="pcard-art">
          {poster ? <img ref={artRef} src={img(poster)} alt="" loading="lazy" draggable={false} /> : <span className="tcard-ph">{initials(displayName(t))}</span>}
          <RatingBadge item={ratedTitle(t)} />
          {done ? (
            <span className="dcard-badge seen">Watched</span>
          ) : started ? (
            <span className="dcard-badge">{t.watched_mains} of {t.mains} watched</span>
          ) : null}
        </span>
        <span className="pcard-name">{displayName(t)}</span>
        <span className="pcard-sub">{titleFacts(t).join(" · ")}</span>
      </button>
      <div className="dcard-actions">
        <WatchedButton t={t} />
      </div>
    </div>
  );
}
