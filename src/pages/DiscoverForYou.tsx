import { useEffect, useMemo, useState } from "react";
import { listTitles, type TitleRow } from "../library/db";
import { displayName } from "../library/present";
import { useLibraryVersion } from "../library/store";
import {
  ANIME_PARAMS, byCategory, CATEGORIES, clearDiscoverCache, discoverPage, isFuture, lists, niceDate,
  type Category, type Item, type MediaType,
} from "../discover/api";
import { findSeen, useHideWatched, useSeen } from "../library/seen";
import { setPromptHidden, usePromptHidden, useRecommendations } from "../discover/recs";
import { MIN_SEEDS } from "../discover/recommend";
import { KINDS, kindMatches, setKind, useKind, type Kind } from "../discover/kind";
import { isoDate } from "../discover/filters";
import { showToast } from "../components/Toast";
import SeenPicker from "../components/SeenPicker";
import CategoryMenu from "../components/browse/CategoryMenu";
import { useNav } from "../app/nav";
import Row from "../components/browse/Row";
import DiscoverCard from "../components/browse/DiscoverCard";
import { InlineRating } from "../components/browse/ratings";
import { IconClose, IconInfo } from "../components/icons";
import { tmdbImg } from "../lib/img";

type RowDef = { id: string; title: string; kind: MediaType | "mixed"; load: () => Promise<Item[]>; anime?: boolean };

/** Rows for one category, like a genre page: popular, new, top-rated and coming soon. */
function categoryRows(cat: Category): RowDef[] {
  const n = cat.name;
  const defs: [string, MediaType, "popular" | "top" | "new" | "soon"][] = [
    [`Popular ${n} series`, "tv", "popular"],
    [`Popular ${n} movies`, "movie", "popular"],
    [`New ${n} series`, "tv", "new"],
    [`New ${n} movies`, "movie", "new"],
    [`Top-rated ${n} series`, "tv", "top"],
    [`Top-rated ${n} movies`, "movie", "top"],
    [`Coming soon: ${n} series`, "tv", "soon"],
    [`Coming soon: ${n} movies`, "movie", "soon"],
  ];
  return defs
    .filter(([, type]) => cat[type]?.length)
    .map(([title, type, mode]) => ({ id: `cat-${n}-${type}-${mode}`, title, kind: type, load: () => byCategory(cat, type, mode) }));
}

const BASE_ROWS: RowDef[] = [
  { id: "trending", title: "Trending this week", kind: "mixed", load: lists.trending },
  { id: "up-tv", title: "Upcoming series", kind: "tv", load: lists.upcomingTv },
  { id: "up-movies", title: "Upcoming movies", kind: "movie", load: lists.upcomingMovies },
  { id: "airing", title: "New episodes this week", kind: "tv", load: lists.airingThisWeek },
  { id: "pop-tv", title: "Popular series", kind: "tv", load: lists.popularTv },
  { id: "cinemas", title: "In cinemas now", kind: "movie", load: lists.inCinemas },
  { id: "top-tv", title: "Top-rated series", kind: "tv", load: lists.topTv },
  { id: "pop-movies", title: "Popular movies", kind: "movie", load: lists.popularMovies },
  { id: "top-movies", title: "Top-rated movies", kind: "movie", load: lists.topMovies },
];

const today = () => isoDate(new Date());
const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86_400_000));
const anime = (type: MediaType, params: Record<string, string | number>) => () =>
  discoverPage(type, { ...ANIME_PARAMS, ...params }).then((p) => p.items);

const ANIME_ROWS: RowDef[] = [
  { id: "an-pop", title: "Popular anime series", kind: "tv", anime: true, load: anime("tv", { sort_by: "popularity.desc" }) },
  { id: "an-new", title: "New anime this season", kind: "tv", anime: true, load: anime("tv", { sort_by: "popularity.desc", "air_date.gte": daysAgo(90), "air_date.lte": today() }) },
  { id: "an-top", title: "Top-rated anime series", kind: "tv", anime: true, load: anime("tv", { sort_by: "vote_average.desc", "vote_count.gte": 150 }) },
  { id: "an-movies", title: "Popular anime movies", kind: "movie", anime: true, load: anime("movie", { sort_by: "popularity.desc" }) },
  { id: "an-top-movies", title: "Top-rated anime movies", kind: "movie", anime: true, load: anime("movie", { sort_by: "vote_average.desc", "vote_count.gte": 300 }) },
  { id: "an-soon", title: "Upcoming anime", kind: "tv", anime: true, load: anime("tv", { sort_by: "popularity.desc", "first_air_date.gte": today() }) },
  { id: "an-classic", title: "Classic anime", kind: "tv", anime: true, load: anime("tv", { sort_by: "vote_average.desc", "vote_count.gte": 80, "first_air_date.lte": "2005-12-31" }) },
];

/** Discover → For You: suggestions first, then curated rows, by type and category. */
export default function DiscoverForYou() {
  const v = useLibraryVersion();
  const { push } = useNav();
  const kind = useKind();
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [titlesReady, setTitlesReady] = useState(false);
  const recs = useRecommendations();
  const [hero, setHero] = useState<Item | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cat, setCat] = useState<Category | null>(null);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    listTitles().then((t) => {
      setTitles(t);
      setTitlesReady(true);
    });
  }, [v]);

  const have = useMemo(() => new Map(titles.filter((t) => t.tmdb_id).map((t) => [`${t.tmdb_type}:${t.tmdb_id}`, t.id])), [titles]);

  const rows = useMemo<RowDef[]>(() => {
    if (kind === "anime") return ANIME_ROWS;
    if (cat) return categoryRows(cat);
    const like: RowDef[] = titles
      .filter((t) => t.tmdb_id && t.tmdb_type)
      .slice(0, 4)
      .map((t) => ({ id: `like-${t.id}`, title: `More like ${displayName(t)}`, kind: t.tmdb_type!, load: () => lists.similar(t.tmdb_type!, t.tmdb_id!) }));
    return [...BASE_ROWS.slice(0, 4), ...like, ...BASE_ROWS.slice(4)];
  }, [titles, cat, kind]);

  // Hero: top trending title, or the most popular in the chosen category or anime.
  useEffect(() => {
    let alive = true;
    const type: MediaType = kind === "movie" || (cat && !cat.tv) ? "movie" : "tv";
    const load =
      kind === "anime" ? ANIME_ROWS[0].load()
      : cat ? byCategory(cat, cat[type] ? type : "movie", "popular")
      : lists.trending();
    load
      .then((items) => {
        const ok = items.filter((i) => i.backdrop && i.overview && (cat || kind === "anime" || kindMatches(kind, i)));
        if (alive) setHero(ok[0] ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [attempt, cat, kind]);

  const shown = rows.filter((r) => kind === "all" || kind === "anime" || r.kind === "mixed" || r.kind === kind);

  return (
    <div className="discover foryou">
      {hero && (
        <>
          <div className="ambient" aria-hidden><img src={tmdbImg(hero.backdrop, "w780")} alt="" /></div>
          <section className="hero hero-home">
            <div className="hero-bg" key={hero.id}><img src={tmdbImg(hero.backdrop, "w1280")} alt="" draggable={false} className="kenburns" /></div>
            <div className="hero-vignette" />
            <div className="hero-body">
              <div className="hero-kicker">{kind === "anime" ? "Popular anime" : cat ? `Popular in ${cat.name}` : "Trending this week"}</div>
              <h1 className="hero-title-text">{hero.name}</h1>
              <div className="hero-facts">
                <InlineRating item={hero} />
                <span>{hero.type === "tv" ? "Series" : "Movie"}</span>
                {hero.date && <span>{isFuture(hero.date) ? `Coming ${niceDate(hero.date)}` : hero.year}</span>}
              </div>
              <p className="hero-overview">{hero.overview}</p>
              <div className="hero-buttons">
                <button
                  className="btn-play"
                  onClick={() => {
                    const lib = have.get(`${hero.type}:${hero.id}`);
                    push(lib ? { page: "title", id: lib } : { page: "tmdb", type: hero.type, id: hero.id, seed: hero });
                  }}
                >
                  <IconInfo /> More info
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      {!hero && <div className="hero hero-home skeleton" />}

      <div className="rows">
        <div className="discover-bar">
          <div className="discover-filters">
            <KindSwitch />
            {kind !== "anime" && (
              <CategoryMenu
                value={cat?.name ?? null}
                options={CATEGORIES.filter((c) => kind === "all" || c[kind]).map((c) => c.name)}
                onChange={(name) => setCat(CATEGORIES.find((c) => c.name === name) ?? null)}
              />
            )}
          </div>
        </div>

        {/* Rows wait for the library and suggestions, so nothing jumps in above them later. */}
        {(!titlesReady || recs.status === "idle") && Array.from({ length: 3 }, (_, i) => (
          <Row key={`sk${i}`} title=" " variant="poster">{Array.from({ length: 9 }, (_, j) => <span key={j} className="dskel" />)}</Row>
        ))}
        {titlesReady && recs.status !== "idle" && !cat && <ForYouRows kind={kind} onPick={() => setPicker(true)} />}
        {titlesReady && recs.status !== "idle" && shown.map((r, idx) => (
          <DiscoverRow
            key={`${r.id}:${attempt}`}
            first={idx === 0}
            def={r}
            kind={r.anime ? "all" : kind}
            have={have}
            onRetry={() => {
              clearDiscoverCache();
              setAttempt((a) => a + 1);
            }}
          />
        ))}
        <p className="tmdb-credit">Listings, artwork and ratings from TMDB.</p>
      </div>
      {picker && <SeenPicker onClose={() => setPicker(false)} />}
    </div>
  );
}

export function KindSwitch() {
  const kind = useKind();
  return (
    <div className="seg" role="tablist" aria-label="Type">
      {KINDS.map((k) => (
        <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>
          {k.label}
        </button>
      ))}
    </div>
  );
}

/** "Top picks for you" and up to three "Because you watched X" rows. */
function ForYouRows({ kind, onPick }: { kind: Kind; onPick: () => void }) {
  const recs = useRecommendations();
  const promptHidden = usePromptHidden();
  const byType = (i: Item) => kindMatches(kind, i);
  if (recs.status === "off" || recs.status === "idle" || recs.status === "empty") return null;
  if (recs.status === "few") {
    if (promptHidden) return null;
    // Counts every watched title, from any eye button, the picker or the library; updates as you mark.
    const n = Math.min(recs.seedCount, MIN_SEEDS);
    const left = MIN_SEEDS - n;
    return (
      <div className="foryou-empty">
        <div className="foryou-steps" aria-hidden>
          {Array.from({ length: MIN_SEEDS }, (_, i) => <span key={i} className={i < n ? "on" : ""} />)}
        </div>
        <div className="foryou-text">
          <h3>Tell us what you've watched to get suggestions</h3>
          <p>
            {n === 0
              ? `Mark ${MIN_SEEDS} shows or movies you've seen with the eye button on any poster, or pick several at once.`
              : `${n} of ${MIN_SEEDS} marked. ${left} more and Off Player starts picking what to watch next.`}
          </p>
        </div>
        <button className="btn primary" onClick={onPick}>Pick titles</button>
        <button
          className="foryou-x"
          aria-label="Close"
          title="Hide this"
          onClick={() => {
            setPromptHidden(true);
            showToast("Hidden. Add watched titles any time from My List → Watched.", () => setPromptHidden(false));
          }}
        >
          <IconClose />
        </button>
      </div>
    );
  }
  if (recs.status === "loading")
    return (
      <Row title="Top picks for you" variant="poster">
        {Array.from({ length: 9 }, (_, i) => <span key={i} className="dskel" />)}
      </Row>
    );
  const picks = recs.picks.filter((p) => byType(p.item));
  return (
    <>
      {picks.length > 0 && (
        <Row title="Top picks for you" variant="poster">
          {picks.map((p) => <DiscoverCard key={`${p.item.type}:${p.item.id}`} item={p.item} reasons={p.reasons} dismissable />)}
        </Row>
      )}
      {recs.because.map((b) => {
        const items = b.items.filter(byType);
        if (!items.length) return null;
        const reason = [{ type: b.seed.type, id: b.seed.id, name: b.seed.name }];
        return (
          <Row key={`${b.seed.type}:${b.seed.id}`} title={`Because you watched ${b.seed.name}`} variant="poster">
            {items.map((i) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} reasons={reason} quietReason dismissable />)}
          </Row>
        );
      })}
    </>
  );
}

function DiscoverRow({ def, kind, have, onRetry, first }: {
  def: RowDef; kind: Kind; have: Map<string, number>; onRetry: () => void; first?: boolean;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hide = useHideWatched();
  const seen = useSeen();
  useEffect(() => {
    let alive = true;
    def.load().then((r) => alive && setItems(r)).catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [def]);

  const shown = (items ?? []).filter((i) => kindMatches(kind, i) && !(hide && findSeen(seen, i.type, i.id)));
  if (err)
    return first ? (
      <div className="discover-error">
        <p>Couldn't reach TMDB. Discover needs an internet connection.</p>
        <button className="btn" onClick={onRetry}>Try again</button>
      </div>
    ) : null;
  if (items && shown.length === 0) return null;
  return (
    <Row title={def.title} variant="poster">
      {items
        ? shown.map((i) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={have.get(`${i.type}:${i.id}`)} />)
        : Array.from({ length: 9 }, (_, i) => <span key={i} className="dskel" />)}
    </Row>
  );
}
