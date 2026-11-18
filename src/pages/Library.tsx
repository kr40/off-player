import { useEffect, useMemo, useState } from "react";
import { listTitles, type TitleRow } from "../library/db";
import { displayName, genresOf } from "../library/present";
import { useLibraryVersion } from "../library/store";
import { PageScroll, useNav, type LibraryTab } from "../app/nav";
import { SlidingTabs } from "../app/TopNav";
import CategoryMenu from "../components/browse/CategoryMenu";
import { PosterTile } from "../components/browse/cards";
import { EmptyState, reveal } from "../components/browse/Grid";
import { FRANCHISES } from "../discover/franchises";
import { fromFranchise, ownedIn, type Coll } from "../discover/collections";
import { CollectionTile } from "./Collections";
import { IconLibrary } from "../components/icons";

type Sort = "name" | "added" | "rating" | "year";
const SORTS: { id: Sort; label: string }[] = [
  { id: "name", label: "A–Z" },
  { id: "added", label: "Recently added" },
  { id: "rating", label: "Top rated" },
  { id: "year", label: "Newest" },
];

const isAnimeTitle = (t: TitleRow) => t.orig_lang === "ja" && genresOf(t).includes("Animation");

/** Everything you own: tabs for series, movies, anime and the collections they belong to. */
export default function Library({ tab: wanted }: { tab?: LibraryTab }) {
  const v = useLibraryVersion();
  const { go, push } = useNav();
  const [tab, setTab] = useState<LibraryTab>(wanted ?? "all");
  useEffect(() => {
    if (wanted) setTab(wanted);
  }, [wanted]);
  const [titles, setTitles] = useState<TitleRow[] | null>(null);
  const [sort, setSort] = useState<Sort>("name");
  const [genre, setGenre] = useState<string | null>(null);

  useEffect(() => {
    listTitles().then(setTitles);
  }, [v]);

  const anime = (titles ?? []).filter(isAnimeTitle);
  const colls = useMemo<{ c: Coll; owned: TitleRow[] }[]>(() => {
    if (!titles) return [];
    return FRANCHISES.map((f) => fromFranchise(f))
      .map((c) => ({ c, owned: ownedIn(c, titles) }))
      .filter((x) => x.owned.length > 0);
  }, [titles]);

  const tabs: { id: LibraryTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "series", label: "Series" },
    { id: "movies", label: "Movies" },
    ...(anime.length ? [{ id: "anime" as const, label: "Anime" }] : []),
    ...(colls.length ? [{ id: "collections" as const, label: "Collections" }] : []),
  ];

  const inTab = useMemo(() => {
    const all = titles ?? [];
    return tab === "series" ? all.filter((t) => t.kind === "show")
      : tab === "movies" ? all.filter((t) => t.kind === "movie")
      : tab === "anime" ? all.filter(isAnimeTitle)
      : all;
  }, [titles, tab]);
  const genres = useMemo(() => [...new Set(inTab.flatMap(genresOf))].sort(), [inTab]);

  const sorted = useMemo(() => {
    const list = inTab.filter((t) => !genre || genresOf(t).includes(genre));
    if (sort === "name") list.sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" }));
    if (sort === "added") list.sort((a, b) => b.last_added - a.last_added);
    if (sort === "rating") list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sort === "year") list.sort((a, b) => (b.tmdb_year ?? b.year ?? 0) - (a.tmdb_year ?? a.year ?? 0));
    return list;
  }, [inTab, sort, genre]);

  const shows = (titles ?? []).filter((t) => t.kind === "show").length;
  const movies = (titles ?? []).length - shows;

  return (
    <PageScroll className="browse library">
      <header className="browse-head">
        <div>
          <h1>Library</h1>
          {titles && (
            <span className="browse-count">
              {shows} {shows === 1 ? "series" : "series"} · {movies} {movies === 1 ? "movie" : "movies"}
              {genre ? ` · ${sorted.length} in ${genre}` : ""}
            </span>
          )}
          {titles && titles.length > 0 && (
            <SlidingTabs className="list-tabs" label="Library" items={tabs} active={tab} onPick={(t) => { setTab(t); setGenre(null); }} />
          )}
        </div>
        <div className="browse-tools">
          {tab !== "collections" && titles && titles.length > 1 && (
            <>
              {genres.length > 1 && <CategoryMenu value={genre} options={genres} onChange={setGenre} />}
              <div className="seg">
                {SORTS.map((s) => (
                  <button key={s.id} className={sort === s.id ? "on" : ""} onClick={() => setSort(s.id)}>{s.label}</button>
                ))}
              </div>
            </>
          )}
          <button className="btn" onClick={() => push({ page: "manage" })}>Manage folders</button>
        </div>
      </header>
      {titles === null ? (
        <div className="pgrid"><span className="dskel grid" /><span className="dskel grid" /><span className="dskel grid" /></div>
      ) : titles.length === 0 ? (
        <EmptyState
          icon={<IconLibrary />}
          title="Your library is empty"
          text="Add a folder of shows or movies. Off Player finds seasons and episodes from the file names, fetches artwork and remembers where you stopped."
          action={
            <div className="row-gap">
              <button className="btn primary" onClick={() => push({ page: "manage" })}>Add a folder</button>
              <button className="btn" onClick={() => go({ page: "discover" })}>Browse Discover instead</button>
            </div>
          }
        />
      ) : tab === "collections" ? (
        <div className="coll-grid">
          {colls.map(({ c, owned }) => (
            <CollectionTile key={c.key} c={c} sub={`${owned.length} of ${c.entries.length} in your library`} />
          ))}
        </div>
      ) : (
        <div className="pgrid reveal">
          {sorted.map((t, i) => (
            <div key={t.id} className="ptile" style={reveal(i)}><PosterTile t={t} /></div>
          ))}
        </div>
      )}
    </PageScroll>
  );
}
