import { useEffect, useMemo, useState } from "react";
import { getSetting, getTitle, listSeasons, titleFiles, type FileRow, type SeasonRow, type TitleRow } from "../library/db";
import { displayName, epName, genresOf, playItem, progressOf, sharedChecker, techSummary } from "../library/present";
import { reanalyseTitle } from "../library/segmentScan";
import { showToast } from "../components/Toast";
import { libraryChanged, useLibraryVersion } from "../library/store";
import { setWatched } from "../library/progress";
import { ProgressLine } from "../components/browse/cards";
import { runJob, useJobs } from "../library/jobs";
import { fixMatch, runMetadata } from "../library/actions";
import { PageScroll, useNav } from "../app/nav";
import Hero from "../components/browse/Hero";
import { Rating } from "../components/browse/cards";
import FixMatch from "../components/FixMatch";
import { PartOfStrip } from "../components/browse/TitleExtras";
import { IconMore, IconPlay } from "../components/icons";
import { img } from "../lib/img";
import { episodeCode, fmtBytes, fmtRuntime, fmtTime } from "../lib/format";

export default function TitlePage({ id, initialSeason }: { id: number; initialSeason?: number }) {
  const v = useLibraryVersion();
  const { play } = useNav();
  const { progress } = useJobs();
  const [t, setT] = useState<TitleRow | null | undefined>(undefined);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [season, setSeason] = useState<number | null>(initialSeason ?? null);
  const [hasKey, setHasKey] = useState(false);
  const [menu, setMenu] = useState(false);
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    Promise.all([getTitle(id), titleFiles(id), listSeasons(id), getSetting("tmdb_key")]).then(([tt, f, s, k]) => {
      setT(tt ?? null);
      setFiles(f);
      setSeasons(s);
      setHasKey(!!k);
      setSeason((cur) => {
        const nums = s.map((x) => x.season);
        return cur !== null && nums.includes(cur) ? cur : nums.find((n) => n > 0) ?? nums[0] ?? null;
      });
    });
  }, [id, v]);

  const d = useMemo(() => {
    const eps = files.filter((f) => f.role === "episode");
    const seen = new Map<string, FileRow>();
    const dupes: FileRow[] = [];
    for (const f of eps) {
      const k = `${f.season}x${f.episode}`;
      if (seen.has(k)) dupes.push(f);
      else seen.set(k, f);
    }
    return {
      eps,
      extras: files.filter((f) => f.role === "extra"),
      movies: files.filter((f) => f.role === "movie"),
      shared: sharedChecker(files),
      tech: techSummary(files),
      bytes: files.reduce((a, f) => a + f.size, 0),
      folders: [...new Set(files.map((f) => f.path.slice(0, f.path.length - f.rel.length).replace(/[\\/]$/, "") + "\\" + f.rel.split("/")[0]))],
      attention: [
        ...files.filter((f) => f.role === "unknown").map((f) => ({ f, why: "No episode number in the name" })),
        ...dupes.map((f) => ({ f, why: `Same episode as another file (${episodeCode(f.season, f.episode)})` })),
        ...files.filter((f) => f.probe_error).map((f) => ({ f, why: `Could not read: ${f.probe_error}` })),
      ],
    };
  }, [files]);

  if (t === undefined) return <PageScroll><div className="hero hero-title skeleton" /></PageScroll>;
  if (t === null)
    return (
      <PageScroll className="center-page">
        <div className="empty"><h2>Not in your library any more</h2><p>This title's files were removed or rescanned away.</p></div>
      </PageScroll>
    );

  const art = t.backdrop ?? t.cover_thumb;
  const current = seasons.find((s) => s.season === season);
  const inSeason = d.eps.filter((f) => f.season === season);
  const working = progress !== null;
  const mainFiles = t.kind === "show" ? d.eps : d.movies;
  const mark = async (list: FileRow[], watched: boolean) => {
    await setWatched(list.map((f) => f.fingerprint), watched);
    libraryChanged();
  };
  const seasonDone = inSeason.length > 0 && inSeason.every((f) => f.pb_watched);
  const allDone = mainFiles.length > 0 && mainFiles.every((f) => f.pb_watched);

  return (
    <PageScroll className="tpage">
      {art && <div className="ambient" aria-hidden><img src={img(art)} alt="" /></div>}
      <Hero t={t} files={files} variant="title">
        <div className="more-anchor">
          <button className="btn-glass round-only" onClick={() => setMenu((m) => !m)} aria-label="More options" aria-expanded={menu}>
            <IconMore />
          </button>
          {menu && (
            <div className="pop-menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { setMenu(false); mark(mainFiles, !allDone); }}>
                {allDone ? "Mark all as unwatched" : t.kind === "show" ? "Mark all episodes as watched" : "Mark as watched"}
              </button>
              {hasKey && <button onClick={() => { setMenu(false); setFixing(true); }} disabled={working}>Fix match…</button>}
              {hasKey && t.tmdb_id && (
                <button disabled={working} onClick={() => { setMenu(false); runJob((r) => runMetadata(r, { titleIds: [t.id] })); }}>
                  Refresh info from TMDB
                </button>
              )}
              {t.kind === "show" && (
                <button
                  onClick={async () => {
                    setMenu(false);
                    await reanalyseTitle(t.id);
                    showToast(`Finding the intro in ${displayName(t)} again. Your own markers stay.`);
                  }}
                >
                  Find intro again
                </button>
              )}
              {!hasKey && <span className="pop-note">Add a TMDB key in Library → Settings to fix matches.</span>}
            </div>
          )}
        </div>
      </Hero>

      <div className="tp-body">
        {t.tmdb_id && t.tmdb_type && <PartOfStrip type={t.tmdb_type} id={t.tmdb_id} tmdbCollection={t.collection_id} />}
        {t.kind === "show" && (
          <section className="tp-section">
            <div className="tp-head">
              <h2>Episodes</h2>
              {seasons.length > 1 && (
                <div className="season-pills" role="tablist">
                  {seasons.map((s) => (
                    <button key={s.season} role="tab" aria-selected={s.season === season} className={s.season === season ? "on" : ""} onClick={() => setSeason(s.season)}>
                      {s.season === 0 ? "Specials" : `Season ${s.season}`}
                    </button>
                  ))}
                </div>
              )}
              {inSeason.length > 0 && (
                <button className="link-btn" onClick={() => mark(inSeason, !seasonDone)}>
                  {seasonDone ? "Mark season unwatched" : "Mark season watched"}
                </button>
              )}
            </div>
            {current && (current.overview || current.air_date) && (
              <p className="season-blurb">
                {current.air_date && <span className="season-year">{current.air_date.slice(0, 4)} · {current.owned} episode{current.owned === 1 ? "" : "s"}</span>}
                {current.overview}
              </p>
            )}
            <ol className="tp-eps">
              {inSeason.map((f) => (
                <EpisodeLine
                  key={f.id}
                  f={f}
                  label={epName(f, d.shared(f))}
                  onPlay={() => play(playItem(t, f, d.shared(f)))}
                  onToggleWatched={() => mark([f], !f.pb_watched)}
                />
              ))}
            </ol>
          </section>
        )}

        {t.kind === "movie" && d.movies.length > 1 && (
          <section className="tp-section">
            <div className="tp-head"><h2>Parts</h2></div>
            <ol className="tp-eps">
              {d.movies.map((f, i) => (
                <EpisodeLine key={f.id} f={f} label={`Part ${i + 1}`} num={String(i + 1)} onPlay={() => play(playItem(t, f))} onToggleWatched={() => mark([f], !f.pb_watched)} />
              ))}
            </ol>
          </section>
        )}

        {d.extras.length > 0 && (
          <section className="tp-section">
            <div className="tp-head"><h2>Extras</h2><span className="tp-count">{d.extras.length}</span></div>
            <div className="extras-grid">
              {d.extras.map((f) => (
                <button key={f.id} className="xcard" onClick={() => play(playItem(t, f))} title={f.rel}>
                  <span className="xcard-art">
                    {f.thumb ? <img src={img(f.thumb)} alt="" loading="lazy" /> : <span className="tcard-ph" />}
                    <span className="ecard-play"><IconPlay /></span>
                    {f.duration ? <span className="xcard-dur">{fmtTime(f.duration)}</span> : null}
                  </span>
                  <span className="xcard-title">{f.episode_title || f.rel.split("/").pop()}</span>
                  {f.extra_group && <span className="xcard-sub">{f.extra_group}</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="tp-section tp-about">
          <div className="tp-head"><h2>About</h2></div>
          <div className="about-grid">
            <div>
              {t.tagline && <p className="about-tagline">“{t.tagline}”</p>}
              {t.overview && <p className="about-overview">{t.overview}</p>}
              {genresOf(t).length > 0 && <p className="about-line"><span>Genres</span>{genresOf(t).join(", ")}</p>}
              {t.rating ? <p className="about-line"><span>TMDB rating</span><Rating value={t.rating} /></p> : null}
            </div>
            <dl className="about-facts">
              <dt>Quality</dt><dd>{d.tech.join(" · ") || "—"}</dd>
              <dt>{t.kind === "show" ? "In library" : "Runtime"}</dt>
              <dd>{t.kind === "show" ? `${d.eps.length} episodes in ${seasons.length} season${seasons.length === 1 ? "" : "s"}` : fmtRuntime(t.runtime)}</dd>
              <dt>Size</dt><dd>{fmtBytes(d.bytes)}</dd>
              <dt>Folder{d.folders.length > 1 ? "s" : ""}</dt><dd className="mono">{d.folders.map((p) => <div key={p}>{p}</div>)}</dd>
              <dt>Match</dt>
              <dd>
                {t.match_state === "confirmed" ? "Picked by you" : t.match_state === "auto" ? "Matched automatically" : t.match_state === "none" ? "No TMDB match — using file names" : "Not matched yet"}
                {t.tmdb_name && t.tmdb_name !== t.name ? ` · from folder “${t.name}”` : ""}
              </dd>
            </dl>
          </div>
          {d.attention.length > 0 && (
            <div className="attention">
              <h3>Needs attention</h3>
              <ul>
                {d.attention.map(({ f, why }) => (
                  <li key={`${f.id}-${why}`}><span className="path">{f.rel}</span><span className="why">{why}</span></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {fixing && (
        <FixMatch
          title={t}
          onClose={() => setFixing(false)}
          onPick={(choice) => {
            setFixing(false);
            runJob((r) => fixMatch(t.id, choice, r));
          }}
        />
      )}
    </PageScroll>
  );
}

function EpisodeLine({ f, label, num, onPlay, onToggleWatched }: {
  f: FileRow; label: string; num?: string; onPlay: () => void; onToggleWatched: () => void;
}) {
  const still = f.meta_still ?? f.thumb;
  const p = progressOf(f);
  return (
    <li className="tp-ep-item">
      <button className={`tp-ep ${f.pb_watched ? "watched" : ""}`} onClick={onPlay} title={f.rel}>
        <span className="tp-ep-num">{num ?? (f.episode_end ? `${f.episode}–${f.episode_end}` : f.episode)}</span>
        <span className="tp-ep-still">
          {still ? <img src={img(still)} alt="" loading="lazy" draggable={false} /> : <span className="tcard-ph" />}
          <span className="ecard-play"><IconPlay /></span>
          <ProgressLine value={p} />
        </span>
        <span className="tp-ep-text">
          <span className="tp-ep-head">
            <span className="tp-ep-title">{label}</span>
            <span className="tp-ep-dur">
              {p !== null && p < 1 && f.duration ? `${Math.round((f.duration - (f.pb_position ?? 0)) / 60)} min left` : f.duration ? fmtRuntime(f.duration) : ""}
            </span>
          </span>
          {f.meta_overview && <span className="tp-ep-overview">{f.meta_overview}</span>}
          {f.meta_air && <span className="tp-ep-air">{new Date(f.meta_air).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>}
        </span>
      </button>
      <button
        className={`watch-toggle ${f.pb_watched ? "on" : ""}`}
        onClick={onToggleWatched}
        aria-label={f.pb_watched ? `Mark ${label} unwatched` : `Mark ${label} watched`}
        title={f.pb_watched ? "Watched — click to mark unwatched" : "Mark watched"}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </button>
    </li>
  );
}
