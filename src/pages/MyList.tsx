import { useEffect, useMemo, useState } from "react";
import { getSetting, listTitles, setSetting, type TitleRow } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { refreshStale, useWatchlist } from "../library/watchlist";
import { librarySeeds, useSeen } from "../library/seen";
import { filterSaved, LIST_SORTS, sortSaved, sortWatched, type ListSort, type ListStatus, type WatchedSort } from "../library/mylist";
import type { SeedInput } from "../discover/recommend";
import type { MediaType } from "../discover/api";
import { PageScroll, useNav } from "../app/nav";
import DiscoverCard from "../components/browse/DiscoverCard";
import { PosterTile } from "../components/browse/cards";
import SeenPicker from "../components/SeenPicker";
import { IconChevronDown, IconClose, IconFilter } from "../components/icons";
import { deleteFilter, setBrowseFilters, useSavedFilters } from "../discover/browseState";
import { activeChips, parseFilters } from "../discover/filters";
import { LANGUAGES, MOVIE_GENRES, TV_GENRES } from "../discover/genres";
import { setKind } from "../discover/kind";
import { showToast } from "../components/Toast";
import { useImdb, useImdbRatings } from "../discover/imdb";
import { EmptyState } from "../components/browse/Grid";

type Tab = "watchlist" | "watched" | "filters";

export default function MyList({ tab: wanted }: { tab?: Tab }) {
  const v = useLibraryVersion();
  const { go } = useNav();
  const [tab, setTab] = useState<Tab>(wanted ?? "watchlist");
  useEffect(() => {
    if (wanted) setTab(wanted);
  }, [wanted]);

  const watchlist = useWatchlist();
  const seen = useSeen();
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [libSeeds, setLibSeeds] = useState<SeedInput[]>([]);
  useEffect(() => {
    listTitles().then(setTitles);
    librarySeeds().then(setLibSeeds).catch(() => setLibSeeds([]));
  }, [v]);
  const have = useMemo(() => new Map(titles.filter((t) => t.tmdb_id).map((t) => [`${t.tmdb_type}:${t.tmdb_id}`, t.id])), [titles]);

  const [type, setType] = useState<"all" | MediaType>("all");
  const [status, setStatus] = useState<ListStatus>("all");
  const [sort, setSort] = useState<ListSort>("added");
  const [wsort, setWsort] = useState<WatchedSort>("marked");
  const [picker, setPicker] = useState(false);
  const [libOpen, setLibOpen] = useState(false);

  useEffect(() => {
    getSetting("mylist_sort").then((s) => s && LIST_SORTS.some((x) => x.id === s) && setSort(s as ListSort));
    refreshStale(); // dates move and posters change; silent when offline
  }, []);

  const imdb = useImdb();
  const imdbOn = imdb.enabled && imdb.count > 0;
  const imdbRatings = useImdbRatings(watchlist, imdbOn && sort === "imdb");
  const shown = useMemo(() => sortSaved(filterSaved(watchlist, type, status), sort, imdbRatings), [watchlist, type, status, sort, imdbRatings]);
  const watched = useMemo(() => sortWatched(filterSaved(seen, type, "all"), wsort), [seen, type, wsort]);
  const fromLibrary = useMemo(() => {
    const byId = new Map(titles.map((t) => [t.id, t]));
    return libSeeds.map((s) => ({ s, t: byId.get(s.titleId!) })).filter((x): x is { s: SeedInput; t: TitleRow } => !!x.t);
  }, [libSeeds, titles]);

  const savedFilters = useSavedFilters();
  const count = tab === "watchlist" ? watchlist.length : tab === "watched" ? seen.length + fromLibrary.length : savedFilters.length;

  return (
    <PageScroll className="browse mylist">
      <header className="browse-head">
        <div>
          <h1>My List</h1>
          <span className="browse-count">
            {count} {tab === "filters" ? (count === 1 ? "filter" : "filters") : count === 1 ? "title" : "titles"}
            {tab === "watchlist" && shown.length !== watchlist.length ? ` · ${shown.length} shown` : ""}
          </span>
          <div className="list-tabs" role="tablist">
            {(["watchlist", "watched", "filters"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "watchlist" ? "Watchlist" : t === "watched" ? "Watched" : "Saved filters"}
              </button>
            ))}
          </div>
        </div>
        {tab !== "filters" && <div className="browse-tools">
          <div className="seg" aria-label="Type">
            {(["all", "tv", "movie"] as const).map((f) => (
              <button key={f} className={type === f ? "on" : ""} onClick={() => setType(f)}>
                {f === "all" ? "All" : f === "tv" ? "Series" : "Movies"}
              </button>
            ))}
          </div>
          {tab === "watchlist" ? (
            <>
              <div className="seg" aria-label="Status">
                {(["all", "released", "soon"] as ListStatus[]).map((s) => (
                  <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
                    {s === "all" ? "All" : s === "released" ? "Released" : "Coming soon"}
                  </button>
                ))}
              </div>
              <label className="sort-select">
                <span>Sort</span>
                <select
                  value={sort}
                  aria-label="Sort"
                  onChange={(e) => {
                    setSort(e.target.value as ListSort);
                    setSetting("mylist_sort", e.target.value);
                  }}
                >
                  {LIST_SORTS.filter((s) => s.id !== "imdb" || imdbOn).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="sort-select">
                <span>Sort</span>
                <select value={wsort} aria-label="Sort" onChange={(e) => setWsort(e.target.value as WatchedSort)}>
                  <option value="marked">Date marked</option>
                  <option value="name">Name A–Z</option>
                  <option value="reaction">Your reaction</option>
                </select>
              </label>
              <button className="btn" onClick={() => setPicker(true)}>Add titles</button>
            </>
          )}
        </div>}
      </header>

      {tab === "filters" ? (
        <SavedFilters />
      ) : tab === "watchlist" ? (
        watchlist.length === 0 ? (
          <div className="browse-empty">
            <p>Nothing saved yet. Find something in Discover.</p>
            <button className="btn primary" onClick={() => go({ page: "discover" })}>Open Discover</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="browse-empty">Nothing on your watchlist matches these filters.</p>
        ) : (
          <div className="pgrid">
            {shown.map((i) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={have.get(`${i.type}:${i.id}`)} />)}
          </div>
        )
      ) : (
        <>
          {seen.length === 0 ? (
            <div className="browse-empty">
              <p>Nothing marked as watched yet. Tell Off Player what you've seen and Discover will suggest what to watch next.</p>
              <button className="btn primary" onClick={() => setPicker(true)}>Add titles</button>
            </div>
          ) : watched.length === 0 ? (
            <p className="browse-empty">No {type === "tv" ? "series" : "movies"} marked as watched.</p>
          ) : (
            <div className="pgrid">
              {watched.map((i) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={have.get(`${i.type}:${i.id}`)} showReaction />)}
            </div>
          )}
          {fromLibrary.length > 0 && (
            <section className="lib-watched">
              <button className="lib-watched-head" aria-expanded={libOpen} onClick={() => setLibOpen((o) => !o)}>
                From your library <span className="tp-count">{fromLibrary.length}</span>
                <IconChevronDown className={libOpen ? "flip" : ""} />
              </button>
              {libOpen && (
                <>
                  <p className="hint">Worked out from what you've played. Mark episodes unwatched on a title's page to take it off.</p>
                  <div className="pgrid compact">
                    {fromLibrary
                      .filter(({ t }) => type === "all" || (type === "tv" ? t.kind === "show" : t.kind === "movie"))
                      .map(({ s, t }) => (
                        <div key={t.id} className="lib-watched-card">
                          <PosterTile t={t} />
                          <span className="lib-watched-tag">{s.source === "finished" ? "Finished" : "In progress"}</span>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
      {picker && <SeenPicker onClose={() => setPicker(false)} />}
    </PageScroll>
  );
}

function SavedFilters() {
  const { go } = useNav();
  const saved = useSavedFilters();
  if (!saved.length)
    return (
      <EmptyState
        icon={<IconFilter />}
        title="No saved filters yet"
        text="In Discover → Browse, set up filters you'll want again (say, finished crime series rated 8+) and choose Save filter."
        action={<button className="btn primary" onClick={() => go({ page: "discover", tab: "browse" })}>Open Browse</button>}
      />
    );
  return (
    <ul className="saved-filters">
      {saved.map((s) => {
        const f = parseFilters(s.params);
        const chips = activeChips(f, {
          genre: (id) => [...MOVIE_GENRES, ...TV_GENRES].find((g) => g.id === id)?.name ?? "Genre",
          language: (c) => LANGUAGES.find((l) => l.code === c)?.name ?? c,
          provider: () => "Streaming service",
        });
        return (
          <li key={s.id} className="saved-filter">
            <button
              className="saved-filter-main"
              onClick={() => {
                setBrowseFilters(f);
                setKind(f.anime ? "anime" : f.type);
                go({ page: "discover", tab: "browse" });
              }}
            >
              <span className="saved-filter-name">{s.name}</span>
              <span className="saved-filter-sub">{[f.anime ? "Anime" : f.type === "tv" ? "Series" : "Movies", ...chips.map((c) => c.label)].join(" · ")}</span>
            </button>
            <button
              className="icon-btn"
              aria-label={`Delete ${s.name}`}
              title="Delete"
              onClick={async () => showToast(`Deleted “${s.name}”`, await deleteFilter(s.id))}
            >
              <IconClose />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
