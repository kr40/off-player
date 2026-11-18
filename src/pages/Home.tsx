import { useEffect, useMemo, useState } from "react";
import { getSetting, listSeasons, listTitles, topEpisodes, type EpisodeRow, type SeasonRow, type TitleRow } from "../library/db";
import { genresOf } from "../library/present";
import { libraryChanged, useLibraryVersion } from "../library/store";
import { continueWatching, type ContinueItem } from "../library/continue";
import { dismissTitle } from "../library/progress";
import { useWatchlist } from "../library/watchlist";
import DiscoverCard from "../components/browse/DiscoverCard";
import { useRecommendations } from "../discover/recs";
import { useFollowedNextUp, entryItem } from "../discover/collections";
import { useFromYourList } from "../discover/soon";
import { lists, type Item } from "../discover/api";
import { listById } from "../discover/toplists";
import { FRANCHISES } from "../discover/franchises";
import { fromFranchise } from "../discover/collections";
import { PageScroll, useNav } from "../app/nav";
import Hero from "../components/browse/Hero";
import Row from "../components/browse/Row";
import { ContinueTile, EpisodeTile, SeasonTile, TitleTile } from "../components/browse/cards";
import { ListTile } from "./TopLists";
import { CollectionTile } from "./Collections";
import { WhatsNew, whatsNew } from "../components/Onboarding";
import { img, tmdbImg } from "../lib/img";
import { IconInfo, IconLibrary } from "../components/icons";

// The featured title stays the same for the whole session, even as data reloads.
let featuredId: number | null = null;
let showWhatsNew = true;

function pickFeatured(titles: TitleRow[]): TitleRow | undefined {
  const kept = titles.find((t) => t.id === featuredId);
  if (kept) return kept;
  const best = titles.filter((t) => t.backdrop && t.logo);
  const ok = best.length ? best : titles.filter((t) => t.backdrop || t.cover_thumb);
  const pool = ok.length ? ok : titles;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  featuredId = pick?.id ?? null;
  return pick;
}

const BIG_LIBRARY = 8; // below this, extra rows would just repeat the same titles

export default function Home() {
  const v = useLibraryVersion();
  const [titles, setTitles] = useState<TitleRow[] | null>(null);
  const [top, setTop] = useState<EpisodeRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [cont, setCont] = useState<ContinueItem[]>([]);
  const [news, setNews] = useState(false);
  const { go } = useNav();
  const goLib = (tab: "series" | "movies") => go({ page: "library", tab });

  useEffect(() => {
    Promise.all([listTitles(), topEpisodes(), listSeasons()]).then(async ([t, e, s]) => {
      const c = await continueWatching(t);
      setTitles(t);
      setTop(e);
      setSeasons(s);
      setCont(c);
    });
  }, [v]);
  useEffect(() => {
    const t = window.setTimeout(() => setNews(whatsNew && showWhatsNew), 600);
    return () => window.clearTimeout(t);
  }, []);

  const byId = useMemo(() => new Map((titles ?? []).map((t) => [t.id, t])), [titles]);
  const featured = useMemo(() => cont[0]?.t ?? (titles?.length ? pickFeatured(titles) : undefined), [titles, cont]);

  if (titles === null) return <PageScroll><div className="hero hero-home skeleton" /></PageScroll>;
  if (titles.length === 0) return <HomeNoLibrary />;

  const shows = titles.filter((t) => t.kind === "show").sort((a, b) => b.last_added - a.last_added);
  const movies = titles.filter((t) => t.kind === "movie").sort((a, b) => b.last_added - a.last_added);
  const big = titles.length >= BIG_LIBRARY;
  const genreRows = big
    ? [...new Set(titles.flatMap(genresOf))]
        .map((g) => ({ g, items: titles.filter((t) => genresOf(t).includes(g)) }))
        .filter((r) => r.items.length >= 3)
        .sort((a, b) => b.items.length - a.items.length)
        .slice(0, 4)
    : [];
  // Seasons interleaved across shows so the row isn't one show's seasons in a block.
  const seasonRow = (() => {
    const per = new Map<number, SeasonRow[]>();
    for (const s of seasons) if (s.season > 0) per.set(s.title_id, [...(per.get(s.title_id) ?? []), s]);
    const ls = [...per.values()];
    const out: SeasonRow[] = [];
    for (let i = 0; ls.some((l) => l[i]); i++) for (const l of ls) if (l[i]) out.push(l[i]);
    return out;
  })();
  const ambient = featured?.backdrop ?? featured?.cover_thumb;

  return (
    <PageScroll className="home">
      {ambient && <div className="ambient" aria-hidden><img src={img(ambient)} alt="" /></div>}
      {featured && <Hero t={featured} variant="home" />}
      <div className="rows">
        {news && (
          <WhatsNew
            onClose={() => {
              showWhatsNew = false;
              setNews(false);
            }}
          />
        )}
        {cont.length > 0 && (
          <Row title="Continue watching">
            {cont.map((c) => (
              <ContinueTile
                key={c.t.id}
                c={c}
                onRemove={async () => {
                  await dismissTitle(c.t.id);
                  libraryChanged();
                }}
              />
            ))}
          </Row>
        )}
        <SharedRows titles={titles} />
        {big && (
          <Row title="Recently added">
            {[...titles].sort((a, b) => b.last_added - a.last_added).slice(0, 20).map((t) => <TitleTile key={t.id} t={t} />)}
          </Row>
        )}
        {shows.length > 0 && (
          <Row title="Your series" more={{ onClick: () => goLib("series") }}>
            {shows.map((t) => <TitleTile key={t.id} t={t} />)}
          </Row>
        )}
        {movies.length > 0 && (
          <Row title="Your movies" more={{ onClick: () => goLib("movies") }}>
            {movies.map((t) => <TitleTile key={t.id} t={t} />)}
          </Row>
        )}
        {top.length > 0 && (
          <Row title="Top-rated episodes">
            {top.map((e) => byId.get(e.title_id) && <EpisodeTile key={e.id} e={e} t={byId.get(e.title_id)!} />)}
          </Row>
        )}
        {seasonRow.length > 1 && (
          <Row title="Seasons" variant="poster">
            {seasonRow.map((s) => byId.get(s.title_id) && <SeasonTile key={`${s.title_id}-${s.season}`} s={s} t={byId.get(s.title_id)!} />)}
          </Row>
        )}
        {genreRows.map(({ g, items }) => (
          <Row key={g} title={g}>
            {items.map((t) => <TitleTile key={t.id} t={t} />)}
          </Row>
        ))}
      </div>
    </PageScroll>
  );
}

/** Rows that use TMDB data: next up in followed collections, top picks, watchlist, out now. */
function SharedRows({ titles }: { titles: TitleRow[] }) {
  const { go } = useNav();
  const watchlist = useWatchlist();
  const recs = useRecommendations();
  const next = useFollowedNextUp();
  const { outNow } = useFromYourList();
  const owned = (i: Item) => titles.find((t) => t.tmdb_id === i.id && t.tmdb_type === i.type)?.id;
  return (
    <>
      {next.length > 0 && (
        <Row title="Next up in your collections" variant="poster" more={{ onClick: () => go({ page: "discover", tab: "collections" }) }}>
          {next.map(({ c, x }) => (
            <DiscoverCard key={c.key} item={{ ...entryItem(x.e), overview: c.name }} libraryId={x.libraryId ?? undefined} reasons={[{ type: x.e.type, id: x.e.id, name: c.name }]} />
          ))}
        </Row>
      )}
      {recs.status === "ready" && recs.picks.length > 0 && (
        <Row title="Top picks for you" variant="poster" more={{ onClick: () => go({ page: "discover", tab: "foryou" }) }}>
          {recs.picks.slice(0, 12).map((p) => (
            <DiscoverCard key={`${p.item.type}:${p.item.id}`} item={p.item} reasons={p.reasons} dismissable />
          ))}
        </Row>
      )}
      {watchlist.length > 0 && (
        <Row title="Your watchlist" variant="poster" more={{ onClick: () => go({ page: "mylist" }) }}>
          {watchlist.slice(0, 12).map((i) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={owned(i)} />)}
        </Row>
      )}
      {outNow.length > 0 && (
        <Row title="Out now from your list" variant="poster" more={{ onClick: () => go({ page: "discover", tab: "soon" }) }}>
          {outNow.slice(0, 12).map((d) => <DiscoverCard key={`${d.item.type}:${d.item.id}:${d.label}`} item={d.item} libraryId={d.libraryId ?? owned(d.item)} />)}
        </Row>
      )}
    </>
  );
}

/** Home for someone with no library yet: Discover's best bits and a way in. */
function HomeNoLibrary() {
  const { go, push } = useNav();
  const [hero, setHero] = useState<Item | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  useEffect(() => {
    getSetting("tmdb_key").then((k) => {
      setHasKey(!!k);
      if (k) lists.trending().then((items) => setHero(items.find((i) => i.backdrop && i.overview) ?? null)).catch(() => {});
    });
  }, []);
  const teasers = ["top-movies", "top-series", "top-anime-series"].map((id) => listById(id)!).filter(Boolean);
  const colls = FRANCHISES.slice(0, 3).map(fromFranchise);
  return (
    <PageScroll className="home">
      {hero && (
        <>
          <div className="ambient" aria-hidden><img src={tmdbImg(hero.backdrop, "w780")} alt="" /></div>
          <section className="hero hero-home">
            <div className="hero-bg"><img src={tmdbImg(hero.backdrop, "w1280")} alt="" draggable={false} className="kenburns" /></div>
            <div className="hero-vignette" />
            <div className="hero-body">
              <div className="hero-kicker">Trending this week</div>
              <h1 className="hero-title-text">{hero.name}</h1>
              <p className="hero-overview">{hero.overview}</p>
              <div className="hero-buttons">
                <button className="btn-play" onClick={() => push({ page: "tmdb", type: hero.type, id: hero.id, seed: hero })}><IconInfo /> More info</button>
                <button className="btn-glass" onClick={() => push({ page: "manage" })}><IconLibrary /> Add your library</button>
              </div>
            </div>
          </section>
        </>
      )}
      <div className={`rows ${hero ? "" : "no-hero"}`}>
        <div className="welcome-strip">
          <div>
            <h2>Nothing in your library yet</h2>
            <p>Add a folder of shows or movies and they'll appear here with artwork, ready to resume.{hasKey === false ? " Add a free TMDB key to explore everything else." : ""}</p>
          </div>
          <div className="row-gap">
            <button className="btn primary" onClick={() => push({ page: "manage" })}>Add a folder</button>
            {hasKey === false && <button className="btn" onClick={() => push({ page: "settings", section: "discover" })}>Add a TMDB key</button>}
          </div>
        </div>
        {hasKey && (
          <>
            <SharedRows titles={[]} />
            <section className="tl-group">
              <div className="tl-group-head"><h2>Top Lists</h2><button className="row-more" onClick={() => go({ page: "discover", tab: "toplists" })}>See all</button></div>
              <div className="tl-grid">{teasers.map((l) => <ListTile key={l.id} l={l} />)}</div>
            </section>
            {colls.length > 0 && (
              <section className="tl-group">
                <div className="tl-group-head"><h2>Collections</h2><button className="row-more" onClick={() => go({ page: "discover", tab: "collections" })}>See all</button></div>
                <div className="coll-grid">{colls.map((c) => <CollectionTile key={c.key} c={c} />)}</div>
              </section>
            )}
          </>
        )}
      </div>
    </PageScroll>
  );
}
