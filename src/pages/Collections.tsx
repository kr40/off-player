import { useEffect, useMemo, useState } from "react";
import { listTitles, type TitleRow } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { useNav } from "../app/nav";
import { FRANCHISES, POPULAR_COLLECTIONS } from "../discover/franchises";
import { fromFranchise, ownedIn, useCollectionStates, type Coll } from "../discover/collections";
import { searchCollections, type CollectionHit } from "../discover/api";
import { useWatchedState } from "../library/seen";
import { tmdbImg } from "../lib/img";
import { IconLayers, IconSearch } from "../components/icons";
import { reveal } from "../components/browse/Grid";

/** A collection tile: wide artwork, name, counts, progress ring when started. */
export function CollectionTile({ c, sub, progress, style }: { c: Coll; sub?: string; progress?: number; style?: React.CSSProperties }) {
  const { push } = useNav();
  const movies = c.entries.filter((e) => e.type === "movie").length;
  const series = c.entries.filter((e) => e.type === "tv").length;
  const counts = [movies ? `${movies} movie${movies > 1 ? "s" : ""}` : "", series ? `${series} series` : ""].filter(Boolean).join(" · ");
  const art = c.backdrop ?? c.poster;
  return (
    <button className="coll-tile" style={style} onClick={() => push({ page: "collection", key: c.key })} title={c.blurb || c.name}>
      <span className="coll-art">
        {art ? <img src={tmdbImg(art, "w780")} alt="" loading="lazy" onLoad={(e) => e.currentTarget.classList.add("in")} /> : <span className="coll-ph"><IconLayers /></span>}
        {progress !== undefined && progress > 0 && (
          <span className="ring" style={{ ["--p" as string]: progress }} aria-label={`${Math.round(progress * 100)}% watched`}>
            <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" /><circle cx="18" cy="18" r="15.5" className="fill" /></svg>
            <span>{Math.round(progress * 100)}%</span>
          </span>
        )}
      </span>
      <span className="coll-name">{c.name}</span>
      <span className="coll-sub">{sub ?? counts}</span>
    </button>
  );
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Discover → Collections. */
export default function Collections() {
  const v = useLibraryVersion();
  const states = useCollectionStates();
  const { keys: watched, ready: watchedReady } = useWatchedState();
  const [titles, setTitles] = useState<TitleRow[] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CollectionHit[]>([]);
  useEffect(() => {
    listTitles().then(setTitles);
  }, [v]);

  const all = useMemo(() => FRANCHISES.map(fromFranchise), []);
  const progressOf = (c: Coll) => {
    const released = c.entries.filter((e) => e.date && e.date <= new Date().toISOString().slice(0, 10));
    if (!released.length) return 0;
    return released.filter((e) => watched.has(`${e.type}:${e.id}`)).length / released.length;
  };
  const started = all.filter((c) => progressOf(c) > 0 && progressOf(c) < 1 || states.get(c.key)?.followed);
  const owned = all.filter((c) => ownedIn(c, titles ?? []).length > 0);
  const film = all.filter((c) => FRANCHISES.find((f) => `franchise:${f.key}` === c.key)?.group === "film");
  const anime = all.filter((c) => FRANCHISES.find((f) => `franchise:${f.key}` === c.key)?.group === "anime");
  const franchiseColl = new Set(FRANCHISES.flatMap((f) => f.tmdbCollections ?? []));
  const popular = POPULAR_COLLECTIONS.filter((c) => !franchiseColl.has(c.id));

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return setHits([]);
    const t = window.setTimeout(() => searchCollections(text).then(setHits).catch(() => setHits([])), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const fMatches = q.trim() ? all.filter((c) => fold(`${c.name} ${c.entries.map((e) => e.title).join(" ")}`).includes(fold(q.trim()))) : [];

  const tmdbColl = (c: { id: number; name: string; poster: string | null; backdrop: string | null }): Coll => ({
    key: `tmdb:${c.id}`, name: c.name, blurb: "", backdrop: c.backdrop, poster: c.poster, sources: [], orders: [], entries: [], kind: "tmdb",
  });

  const Section = ({ title, items, sub }: { title: string; items: Coll[]; sub?: (c: Coll) => string }) =>
    items.length ? (
      <section className="tl-group">
        <div className="tl-group-head"><h2>{title}</h2></div>
        <div className="coll-grid reveal">
          {items.map((c, i) => <CollectionTile key={c.key} c={c} progress={progressOf(c)} sub={sub?.(c)} style={reveal(i)} />)}
        </div>
      </section>
    ) : null;

  return (
    <div className="collections">
      <header className="tab-head">
        <div>
          <h1>Collections</h1>
          <p>Franchises and sagas in the order they came out, or the order the story happens.</p>
        </div>
        <label className="discover-search">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a franchise or collection" spellCheck={false} aria-label="Find a collection" />
          {q && <button onClick={() => setQ("")} aria-label="Clear">×</button>}
        </label>
      </header>

      {!titles || !watchedReady ? (
        <div className="tl-group"><div className="coll-grid">{Array.from({ length: 8 }, (_, i) => <span key={i} className="coll-skel" />)}</div></div>
      ) : q.trim() ? (
        <section className="tl-group">
          <div className="coll-grid">
            {fMatches.map((c) => <CollectionTile key={c.key} c={c} progress={progressOf(c)} />)}
            {hits.filter((h) => !franchiseColl.has(h.id)).map((h) => <CollectionTile key={h.id} c={tmdbColl(h)} sub="Movie collection" />)}
          </div>
          {fMatches.length === 0 && hits.length === 0 && <p className="search-hint pad">No collection called “{q.trim()}”.</p>}
        </section>
      ) : (
        <>
          <Section title="Continue" items={started} sub={(c) => `${Math.round(progressOf(c) * 100)}% watched`} />
          <Section title="In your library" items={owned} sub={(c) => `${ownedIn(c, titles ?? []).length} of ${c.entries.length} in your library`} />
          <Section title="Franchises" items={film} />
          <Section title="Anime sagas" items={anime} />
          {popular.length > 0 && (
            <section className="tl-group">
              <div className="tl-group-head"><h2>Popular movie collections</h2></div>
              <div className="coll-grid reveal">
                {popular.map((c, i) => <CollectionTile key={c.id} c={tmdbColl(c)} sub={`${c.count} movies`} style={reveal(i)} />)}
              </div>
            </section>
          )}
        </>
      )}
      <p className="tmdb-credit">Collections from TMDB. Story orders checked against the sources listed on each page.</p>
    </div>
  );
}
