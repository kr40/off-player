import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSetting, listTitles, setSetting, type TitleRow } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { onWatchlist, toggleWatchlist, useWatchlist } from "../library/watchlist";
import { details, isFuture, niceDate, type Detail, type Item, type MediaType } from "../discover/api";
import { PageScroll, useNav } from "../app/nav";
import Row from "../components/browse/Row";
import DiscoverCard, { REACTION_LABEL } from "../components/browse/DiscoverCard";
import { findSeen, setReaction, toggleSeen, useSeen } from "../library/seen";
import { useRecReason } from "../discover/recs";
import { reasonText, type Reaction } from "../discover/recommend";
import { showToast } from "../components/Toast";
import { Rating } from "../components/browse/cards";
import { IconCheck, IconEye, IconPlay, IconPlus } from "../components/icons";
import { PartOfStrip, RatingPair } from "../components/browse/TitleExtras";
import { rememberImdbId, useImdbRating } from "../discover/imdb";
import { tmdbImg } from "../lib/img";
import { fmtRuntime } from "../lib/format";

/** Country for "where to watch", taken from the system locale; never sent anywhere. */
function localRegion(): string {
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? "US";
  } catch {
    return "US";
  }
}

/** Details for a show or movie that isn't in the library. `seed` renders instantly while details load. */
export default function TmdbPage({ type, id, seed }: { type: MediaType; id: number; seed?: Item }) {
  const v = useLibraryVersion();
  const { push } = useNav();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    details(type, id)
      .then((x) => {
        if (!alive) return;
        setD(x);
        rememberImdbId(type, id, x.imdbId);
      })
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [type, id, attempt]);
  useEffect(() => {
    listTitles().then(setTitles);
  }, [v]);

  const have = useMemo(() => new Map(titles.filter((t) => t.tmdb_id).map((t) => [`${t.tmdb_type}:${t.tmdb_id}`, t.id])), [titles]);
  const base: Item | undefined = d ?? seed;
  const watchlist = useWatchlist();
  const saved = onWatchlist(watchlist, type, id);
  const seen = findSeen(useSeen(), type, id);
  const why = useRecReason(type, id);
  const imdbRating = useImdbRating({ type, id, imdbId: d?.imdbId ?? seed?.imdbId, name: (d ?? seed)?.name, year: (d ?? seed)?.year }, true);
  const libraryId = have.get(`${type}:${id}`);
  // Country for "where to watch": your saved choice, else the system locale's.
  const [region, setRegion] = useState(localRegion);
  useEffect(() => {
    getSetting("watch_region").then((r) => r && setRegion(r));
  }, []);
  const watch = d?.providers[region];
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames(undefined, { type: "region" });
    return Object.keys(d?.providers ?? {})
      .map((cc) => ({ cc, name: names.of(cc) ?? cc }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [d]);

  if (!base)
    return (
      <PageScroll className={err ? "center-page" : ""}>
        {err ? (
          <div className="empty">
            <h2>Couldn't load this title</h2>
            <p>TMDB didn't respond. Check your connection.</p>
            <button className="btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </div>
        ) : (
          <div className="hero hero-title skeleton" />
        )}
      </PageScroll>
    );

  const upcoming = isFuture(base.date);
  const years =
    type === "tv" && base.year ? (d?.endYear && d.endYear !== base.year ? `${base.year}–${d.endYear}` : d && !d.endYear && !upcoming ? `${base.year}–` : `${base.year}`) : base.year ? `${base.year}` : "";
  const facts = [
    upcoming ? `Coming ${niceDate(base.date)}` : years,
    type === "tv" ? (d?.seasons.length ? `${d.seasons.length} Season${d.seasons.length === 1 ? "" : "s"}` : "Series") : d?.runtime ? fmtRuntime(d.runtime * 60) : "Movie",
  ].filter(Boolean);

  return (
    <PageScroll className="tpage">
      {base.backdrop && <div className="ambient" aria-hidden><img src={tmdbImg(base.backdrop, "w780")} alt="" /></div>}
      <section className="hero hero-title">
        <div className="hero-bg">
          {base.backdrop && <img src={tmdbImg(base.backdrop, "w1280")} alt="" draggable={false} style={{ viewTransitionName: "hero-art" }} />}
        </div>
        <div className="hero-vignette" />
        <div className="hero-body">
          {d?.logo ? <img className="hero-logo" src={tmdbImg(d.logo, "w500")} alt={base.name} draggable={false} /> : <h1 className="hero-title-text">{base.name}</h1>}
          <div className="hero-facts">
            {!upcoming && <RatingPair type={type} id={id} imdbId={d?.imdbId ?? base.imdbId} tmdb={base.rating} votes={base.votes} />}
            {facts.map((f) => <span key={f}>{f}</span>)}
            {d?.genres.slice(0, 3).map((g) => <span key={g} className="genre">{g}</span>)}
          </div>
          {base.overview && <p className="hero-overview">{base.overview}</p>}
          <div className="hero-buttons">
            {libraryId ? (
              <button className="btn-play" onClick={() => push({ page: "title", id: libraryId })}><IconPlay /> In your library</button>
            ) : d?.trailer ? (
              <button className="btn-play" onClick={() => openUrl(`https://www.youtube.com/watch?v=${d.trailer}`)}><IconPlay /> Watch trailer</button>
            ) : null}
            {libraryId && d?.trailer && (
              <button className="btn-glass" onClick={() => openUrl(`https://www.youtube.com/watch?v=${d.trailer}`)}>Trailer</button>
            )}
            {!libraryId && (
              <button
                className={`btn-glass ${saved ? "saved" : ""}`}
                onClick={async () => {
                  const undo = await toggleWatchlist(base);
                  if (undo) showToast(`Removed ${base.name} from your watchlist`, undo);
                }}
                title={saved ? "Remove from your watchlist" : "Save to watch later"}
              >
                {saved ? <><IconCheck /> On watchlist</> : <><IconPlus /> Watchlist</>}
              </button>
            )}
            {!libraryId && (
              <button
                className={`btn-glass ${seen ? "saved" : ""}`}
                onClick={async () => {
                  const r = await toggleSeen(base);
                  showToast(r.seen ? `Marked ${base.name} as watched` : `Removed ${base.name} from watched`, r.undo);
                }}
                title={seen ? "Click to unmark" : "I've watched this"}
              >
                {seen ? <><IconCheck /> Watched</> : <><IconEye /> Watched</>}
              </button>
            )}
            <button className="btn-glass" onClick={() => openUrl(`https://www.themoviedb.org/${type}/${id}`)}>TMDB</button>
            {d?.imdbId && <button className="btn-glass" onClick={() => openUrl(`https://www.imdb.com/title/${d.imdbId}/`)}>IMDb</button>}
          </div>
          {seen && (
            <div className="reactions" role="radiogroup" aria-label="Your reaction">
              {([2, 1, -1] as Reaction[]).map((r) => (
                <button key={r} role="radio" aria-checked={seen.reaction === r} className={seen.reaction === r ? "on" : ""} onClick={() => setReaction(type, id, r)}>
                  {REACTION_LABEL[r]}
                </button>
              ))}
            </div>
          )}
          {why && !seen && <p className="hero-note why">{reasonText(why)}</p>}
          {!libraryId && !why && <p className="hero-note">Not in your library — this page is for browsing.</p>}
        </div>
      </section>

      <div className="tp-body">
        <PartOfStrip type={type} id={id} tmdbCollection={d?.collection?.id} />
        {err && !d && <p className="note error">Couldn't load full details from TMDB. <button className="link-btn inline" onClick={() => setAttempt((a) => a + 1)}>Try again</button></p>}

        {d && (
          <section className="tp-section tp-about">
            <div className="about-grid">
              <div>
                {d.tagline && <p className="about-tagline">“{d.tagline}”</p>}
                {d.overview && <p className="about-overview">{d.overview}</p>}
              </div>
              <dl className="about-facts">
                {d.status && <><dt>Status</dt><dd>{d.status}</dd></>}
                {d.nextEpisode && <><dt>Next episode</dt><dd>S{d.nextEpisode.season} E{d.nextEpisode.episode} · {niceDate(d.nextEpisode.date)}</dd></>}
                {d.date && <><dt>{type === "tv" ? "First aired" : "Released"}</dt><dd>{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</dd></>}
                {d.genres.length > 0 && <><dt>Genres</dt><dd>{d.genres.join(", ")}</dd></>}
                {d.makers.length > 0 && <><dt>{type === "tv" ? "Created by" : "Directed by"}</dt><dd>{d.makers.join(", ")}</dd></>}
                {imdbRating && (
                  <>
                    <dt>IMDb rating</dt>
                    <dd><span className="rating smart"><b className="src imdb">IMDb</b>{imdbRating.rating.toFixed(1)}</span> <span className="dim-num">from {imdbRating.votes.toLocaleString()} votes</span></dd>
                  </>
                )}
                {d.rating && <><dt>TMDB rating</dt><dd><Rating value={d.rating} /> <span className="dim-num">from {d.votes.toLocaleString()} votes</span></dd></>}
              </dl>
            </div>
          </section>
        )}

        {countries.length > 0 && (
          <section className="tp-section">
            <div className="tp-head">
              <h2>Where to watch</h2>
              <select
                className="region-select"
                value={watch ? region : ""}
                aria-label="Country"
                onChange={(e) => {
                  setRegion(e.target.value);
                  setSetting("watch_region", e.target.value);
                }}
              >
                {!watch && <option value="">Choose country</option>}
                {countries.map((c) => <option key={c.cc} value={c.cc}>{c.name}</option>)}
              </select>
            </div>
            {watch && watch.stream.length > 0 && <ProviderLine label="Stream" list={watch.stream} link={watch.link} />}
            {watch && watch.buy.length > 0 && <ProviderLine label="Rent or buy" list={watch.buy} link={watch.link} />}
            {!watch && <p className="hint">Not listed on any service in the selected country.</p>}
            <p className="fine">Availability data by JustWatch.</p>
          </section>
        )}

        {d && d.cast.length > 0 && (
          <section className="tp-section">
            <div className="tp-head"><h2>Cast</h2></div>
            <div className="cast-grid">
              {d.cast.map((p) => (
                <button key={p.id} className="cast" onClick={() => push({ page: "person", id: p.id })} title={`More with ${p.name}`}>
                  {p.photo ? <img src={tmdbImg(p.photo, "w185")} alt="" loading="lazy" /> : <span className="cast-ph">{p.name.slice(0, 1)}</span>}
                  <span className="cast-name">{p.name}</span>
                  <span className="cast-role">{p.role}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {d && d.seasons.length > 0 && (
          <section className="tp-section">
            <div className="tp-head"><h2>Seasons</h2><span className="tp-count">{d.seasons.length}</span></div>
            <div className="season-strip">
              {d.seasons.map((s) => (
                <div key={s.number} className="scard static">
                  <span className="scard-art">
                    {s.poster ?? d.poster ? <img src={tmdbImg(s.poster ?? d.poster, "w342")} alt="" loading="lazy" /> : <span className="tcard-ph">{s.number}</span>}
                  </span>
                  <span className="scard-label">{s.name}</span>
                  <span className="scard-sub">{[s.year, s.episodes ? `${s.episodes} episodes` : null].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {d && d.similar.length > 0 && (
        <div className="rows flush">
          <Row title="More like this" variant="poster">
            {d.similar.map((i) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={have.get(`${i.type}:${i.id}`)} />)}
          </Row>
        </div>
      )}
    </PageScroll>
  );
}

function ProviderLine({ label, list, link }: { label: string; list: { id: number; name: string; logo: string | null }[]; link: string }) {
  return (
    <div className="prov-line">
      <span className="prov-label">{label}</span>
      <div className="prov-list">
        {list.slice(0, 10).map((p) => (
          <button key={p.id} className="prov" title={`${p.name} — open availability page`} onClick={() => openUrl(link)}>
            {p.logo && <img src={tmdbImg(p.logo, "w92")} alt="" />}
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
