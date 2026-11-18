import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { allEpisodes, getSetting, listTitles, type EpisodeRow, type TitleRow } from "../library/db";
import { displayName, epCode, epName, genresOf, playItem } from "../library/present";
import { useLibraryVersion } from "../library/store";
import { PageScroll, useNav } from "../app/nav";
import { onSearchEnter, useSearchQuery } from "../app/searchStore";
import { PosterTile } from "../components/browse/cards";
import DiscoverCard from "../components/browse/DiscoverCard";
import { reveal } from "../components/browse/Grid";
import { CollectionTile } from "./Collections";
import { lists, searchCollections, searchPeople, type CollectionHit, type Item, type PersonHit } from "../discover/api";
import { FRANCHISES } from "../discover/franchises";
import { fromFranchise } from "../discover/collections";
import { KINDS, kindMatches, setKind, useKind } from "../discover/kind";
import { useOnline } from "../lib/net";
import { IconPlay } from "../components/icons";
import { img, tmdbImg } from "../lib/img";
import { fmtRuntime } from "../lib/format";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const terms = (q: string) => fold(q).split(/[^a-z0-9]+/).filter(Boolean);
const matches = (hay: string, ts: string[]) => ts.every((t) => hay.includes(t));

/**
 * One search for everything: what you own first (works offline), then
 * collections, then any show or movie on TMDB, then people.
 */
export default function Search() {
  const v = useLibraryVersion();
  const { play, push } = useNav();
  const online = useOnline();
  const q = useSearchQuery();
  const query = useDeferredValue(q);
  const kind = useKind();
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [hideOwned, setHideOwned] = useState(false);
  const [tmdbHits, setTmdbHits] = useState<Item[] | null>(null);
  const [colHits, setColHits] = useState<CollectionHit[]>([]);
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([listTitles(), allEpisodes(), getSetting("tmdb_key")]).then(([t, e, k]) => {
      setTitles(t);
      setEpisodes(e);
      setHasKey(!!k);
    });
  }, [v]);

  const byId = useMemo(() => new Map(titles.map((t) => [t.id, t])), [titles]);
  const titleHay = useMemo(
    () => titles.map((t) => [t, fold([displayName(t), t.name, t.overview ?? "", genresOf(t).join(" ")].join(" "))] as const),
    [titles],
  );
  const epHay = useMemo(
    () =>
      episodes.map((e) => {
        const t = byId.get(e.title_id);
        return [e, fold([epName(e), e.episode_title ?? "", e.meta_overview ?? "", t ? displayName(t) : ""].join(" "))] as const;
      }),
    [episodes, byId],
  );

  const ts = terms(query);
  const titleHits = ts.length ? titleHay.filter(([, h]) => matches(h, ts)).map(([t]) => t) : [];
  const epHits = ts.length
    ? epHay
        .filter(([e, h]) => matches(h, ts) && ts.some((t) => fold(`${epName(e)} ${e.meta_overview ?? ""}`).includes(t)))
        .map(([e]) => e)
        .slice(0, 40)
    : [];
  const franchiseHits = useMemo(
    () => (ts.length ? FRANCHISES.filter((f) => matches(fold(`${f.name} ${f.entries.map((e) => e.title).join(" ")}`), ts)).map(fromFranchise) : []),
    [query],
  );

  // TMDB: titles, collections and people, 250 ms after typing stops.
  useEffect(() => {
    const text = query.trim();
    setFailed(false);
    if (!text || !hasKey) {
      setTmdbHits(null);
      setColHits([]);
      setPeople([]);
      return;
    }
    let alive = true;
    setTmdbHits(null);
    const id = window.setTimeout(() => {
      Promise.allSettled([lists.search(text), searchCollections(text), searchPeople(text)]).then(([a, b, c]) => {
        if (!alive) return;
        setTmdbHits(a.status === "fulfilled" ? a.value : []);
        setColHits(b.status === "fulfilled" ? b.value.slice(0, 8) : []);
        setPeople(c.status === "fulfilled" ? c.value.slice(0, 12) : []);
        setFailed(a.status === "rejected");
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [query, hasKey]);

  const owned = useMemo(() => new Map(titles.filter((t) => t.tmdb_id).map((t) => [`${t.tmdb_type}:${t.tmdb_id}`, t.id])), [titles]);
  // A title you own appears once, in the library section.
  const tmdbShown = (tmdbHits ?? []).filter((i) => kindMatches(kind, i) && !owned.has(`${i.type}:${i.id}`) && !(hideOwned && owned.has(`${i.type}:${i.id}`)));
  const franchiseCollIds = new Set(FRANCHISES.flatMap((f) => f.tmdbCollections ?? []));
  // TMDB's collection search also matches descriptions; keep the ones whose name has the words.
  const colShown = colHits.filter((c) => !franchiseCollIds.has(c.id) && matches(fold(c.name), ts));

  // Enter opens the first result.
  useEffect(() => {
    const first = titleHits[0];
    const firstEp = epHits[0];
    const firstTmdb = tmdbShown[0];
    onSearchEnter(() => {
      if (first) push({ page: "title", id: first.id });
      else if (firstEp && byId.get(firstEp.title_id)) play(playItem(byId.get(firstEp.title_id)!, firstEp));
      else if (franchiseHits[0]) push({ page: "collection", key: franchiseHits[0].key });
      else if (firstTmdb) push({ page: "tmdb", type: firstTmdb.type, id: firstTmdb.id, seed: firstTmdb });
    });
    return () => onSearchEnter(null);
  });

  const nothing = ts.length > 0 && !titleHits.length && !epHits.length && !franchiseHits.length && tmdbHits !== null && !tmdbShown.length && !colShown.length && !people.length;

  return (
    <PageScroll className="search-page">
      {!ts.length ? (
        <div className="search-intro">
          <h1>Search</h1>
          <p>Your library, episode names and plots, collections, any show or movie, and people. Press <kbd>/</kbd> from anywhere.</p>
        </div>
      ) : (
        <div className="search-head">
          <h1>Results for “{query.trim()}”</h1>
          <div className="browse-tools">
            <div className="seg" aria-label="Type">
              {KINDS.map((k) => (
                <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>{k.label}</button>
              ))}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} /> Hide what I own
            </label>
          </div>
        </div>
      )}

      {nothing && <p className="search-hint">Nothing matches “{query.trim()}”. Check the spelling, or try fewer words.</p>}

      {!hideOwned && titleHits.length > 0 && (
        <section className="search-section">
          <h2>In your library</h2>
          <div className="pgrid compact reveal">
            {titleHits.map((t, i) => <div key={t.id} className="ptile" style={reveal(i)}><PosterTile t={t} /></div>)}
          </div>
        </section>
      )}

      {!hideOwned && epHits.length > 0 && (
        <section className="search-section">
          <h2>Episodes <span className="tp-count">{epHits.length}{epHits.length === 40 ? "+" : ""}</span></h2>
          <ol className="search-eps">
            {epHits.map((e) => {
              const t = byId.get(e.title_id);
              if (!t) return null;
              const still = e.meta_still ?? e.thumb;
              return (
                <li key={e.id}>
                  <button className="tp-ep" onClick={() => play(playItem(t, e))}>
                    <span className="tp-ep-still">
                      {still ? <img src={img(still)} alt="" loading="lazy" /> : <span className="tcard-ph" />}
                      <span className="ecard-play"><IconPlay /></span>
                    </span>
                    <span className="tp-ep-text">
                      <span className="tp-ep-show">{displayName(t)} · {epCode(e)}</span>
                      <span className="tp-ep-head">
                        <span className="tp-ep-title">{epName(e)}</span>
                        <span className="tp-ep-dur">{e.duration ? fmtRuntime(e.duration) : ""}</span>
                      </span>
                      {e.meta_overview && <span className="tp-ep-overview">{e.meta_overview}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {(franchiseHits.length > 0 || colShown.length > 0) && (
        <section className="search-section">
          <h2>Collections</h2>
          <div className="coll-grid compact">
            {franchiseHits.map((c) => <CollectionTile key={c.key} c={c} />)}
            {colShown.map((c) => (
              <CollectionTile
                key={c.id}
                c={{ key: `tmdb:${c.id}`, name: c.name, blurb: "", backdrop: c.backdrop, poster: c.poster, sources: [], orders: [], entries: [], kind: "tmdb" }}
                sub="Movie collection"
              />
            ))}
          </div>
        </section>
      )}

      {ts.length > 0 && hasKey && (
        <section className="search-section">
          <h2>Series and movies</h2>
          {!online || failed ? (
            <p className="search-hint quiet">Can't reach TMDB right now; showing results from your library only.</p>
          ) : tmdbHits === null ? (
            <div className="pgrid compact"><span className="dskel grid" /><span className="dskel grid" /><span className="dskel grid" /><span className="dskel grid" /></div>
          ) : tmdbShown.length === 0 ? (
            <p className="search-hint quiet">No other matches on TMDB.</p>
          ) : (
            <div className="pgrid compact reveal">
              {tmdbShown.map((i, n) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} style={reveal(n)} />)}
            </div>
          )}
        </section>
      )}

      {people.length > 0 && (
        <section className="search-section">
          <h2>People</h2>
          <div className="people-grid">
            {people.map((p) => (
              <button key={p.id} className="person-card" onClick={() => push({ page: "person", id: p.id })}>
                {p.photo ? <img src={tmdbImg(p.photo, "w185")} alt="" loading="lazy" /> : <span className="cast-ph">{p.name.slice(0, 1)}</span>}
                <span className="cast-name">{p.name}</span>
                <span className="cast-role">{p.knownFor.join(", ") || p.dept}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </PageScroll>
  );
}
