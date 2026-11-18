import { useEffect, useState, type ReactNode } from "react";
import { titleFiles, type FileRow, type TitleRow } from "../../library/db";
import { displayName, epCode, firstEpisode, genresOf, nextUp, playItem, progressOf, sharedChecker } from "../../library/present";
import { useNav } from "../../app/nav";
import { img } from "../../lib/img";
import { IconInfo, IconPlay } from "../icons";
import { Rating, timeLeft, titleFacts } from "./cards";
import { RatingPair } from "./TitleExtras";

/** Full-bleed artwork header used by Home (with "More info") and title pages. */
export default function Hero({ t, files, variant, children }: {
  t: TitleRow;
  files?: FileRow[];
  variant: "home" | "title";
  children?: ReactNode;
}) {
  const { play, push } = useNav();
  const [own, setOwn] = useState<FileRow[] | null>(files ?? null);
  useEffect(() => {
    if (files) setOwn(files);
    else titleFiles(t.id).then(setOwn);
  }, [t, files]);

  const up = own ? nextUp(own) : undefined;
  const target = up?.file ?? (own ? firstEpisode(own) : undefined);
  const shared = own ? sharedChecker(own) : () => false;
  const resuming = up?.mode === "resume";
  const label =
    !target ? "Play"
    : resuming ? (target.role === "episode" ? `Resume ${epCode(target)}` : "Resume")
    : target.role === "episode" ? `Play ${epCode(target)}`
    : "Play";
  const art = t.backdrop ?? t.cover_thumb;
  const genres = genresOf(t).slice(0, 3);

  return (
    <section className={`hero hero-${variant}`}>
      <div className="hero-bg" key={art ?? "none"}>
        {art && (
          <img
            src={img(art)}
            alt=""
            draggable={false}
            // A title page's artwork morphs out of the card that opened it.
            style={variant === "title" ? { viewTransitionName: "hero-art" } : undefined}
          />
        )}
      </div>
      <div className="hero-vignette" />
      <div className="hero-body">
        {t.logo ? (
          <img className="hero-logo" src={img(t.logo)} alt={displayName(t)} draggable={false} />
        ) : (
          <h1 className="hero-title-text">{displayName(t)}</h1>
        )}
        <div className="hero-facts">
          {t.tmdb_id && t.tmdb_type ? <RatingPair type={t.tmdb_type} id={t.tmdb_id} tmdb={t.rating} /> : <Rating value={t.rating} />}
          {titleFacts(t).map((f) => <span key={f}>{f}</span>)}
          {genres.map((g) => <span key={g} className="genre">{g}</span>)}
        </div>
        {t.overview && <p className="hero-overview">{t.overview}</p>}
        <div className="hero-buttons">
          <button className="btn-play" disabled={!target} onClick={() => target && play(playItem(t, target, shared(target)))}>
            <IconPlay />
            <span className="btn-play-text">
              {label}
              {resuming && <span className="btn-play-sub">{timeLeft(target!)}</span>}
            </span>
            {resuming && (
              <span className="btn-play-progress"><span style={{ width: `${(progressOf(target!) ?? 0) * 100}%` }} /></span>
            )}
          </button>
          {variant === "title" && resuming && (
            <button className="btn-glass" onClick={() => play(playItem(t, target!, shared(target!), { fromStart: true }))} title="Play this episode from the beginning">
              Start over
            </button>
          )}
          {variant === "home" && (
            <button className="btn-glass" onClick={() => push({ page: "title", id: t.id })}>
              <IconInfo /> More info
            </button>
          )}
          {children}
        </div>
      </div>
    </section>
  );
}
