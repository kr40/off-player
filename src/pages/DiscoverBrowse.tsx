import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listTitles, type TitleRow } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { findSeen, useSeen } from "../library/seen";
import { onWatchlist, useWatchlist } from "../library/watchlist";
import { discoverPage, type Item } from "../discover/api";
import { toParams, type BrowseFilters } from "../discover/filters";
import { saveFilter, setBrowseFilters, useBrowseFilters } from "../discover/browseState";
import { useKind } from "../discover/kind";
import { useRegion } from "../lib/region";
import { useOnline } from "../lib/net";
import FilterBar from "../components/browse/FilterBar";
import DiscoverCard from "../components/browse/DiscoverCard";
import { EmptyState, EndSentinel, OfflineStrip, SkeletonCards, reveal } from "../components/browse/Grid";
import { showToast } from "../components/Toast";
import { IconFilter } from "../components/icons";

/** Discover → Browse: every filter TMDB supports, as an endless grid. */
export default function DiscoverBrowse() {
  const v = useLibraryVersion();
  const stored = useBrowseFilters();
  const kind = useKind();
  const region = useRegion();
  const online = useOnline();
  const seen = useSeen();
  const watchlist = useWatchlist();
  const [titles, setTitles] = useState<TitleRow[]>([]);
  useEffect(() => {
    listTitles().then(setTitles);
  }, [v]);
  const owned = useMemo(() => new Map(titles.filter((t) => t.tmdb_id).map((t) => [`${t.tmdb_type}:${t.tmdb_id}`, t.id])), [titles]);

  // The shared All/Series/Movies/Anime switch picks the type when it is specific.
  const f: BrowseFilters = useMemo(() => {
    if (kind === "anime") return { ...stored, anime: true };
    if (kind === "tv" || kind === "movie") return { ...stored, type: kind, anime: false };
    return stored;
  }, [stored, kind]);

  // Changing a filter refetches 250 ms later; the old results stay, dimmed.
  const params = useMemo(() => toParams(f, region), [f, region]);
  const key = JSON.stringify([f.type, params]);
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(key), 250);
    return () => window.clearTimeout(t);
  }, [key]);

  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [shownKey, setShownKey] = useState("");
  const req = useRef(0);

  const load = useCallback(
    async (k: string, nextPage: number) => {
      const [type, p] = JSON.parse(k) as [Item["type"], Record<string, string | number>];
      const id = ++req.current;
      setLoading(true);
      setError(false);
      try {
        const res = await discoverPage(type, p, nextPage);
        if (id !== req.current) return;
        setItems((cur) => {
          const base = nextPage === 1 ? [] : cur;
          const have = new Set(base.map((i) => `${i.type}:${i.id}`));
          return [...base, ...res.items.filter((i) => !have.has(`${i.type}:${i.id}`))];
        });
        setPage(nextPage);
        setTotal(res.totalPages);
        setShownKey(k);
      } catch {
        if (id === req.current) setError(true);
      } finally {
        if (id === req.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(debounced, 1);
  }, [debounced, load]);

  const visible = items.filter(
    (i) =>
      !(f.hideWatched && findSeen(seen, i.type, i.id)) &&
      !(f.hideOwned && owned.has(`${i.type}:${i.id}`)) &&
      !(f.hideSaved && onWatchlist(watchlist, i.type, i.id)),
  );
  const stale = shownKey !== key;
  const more = !loading && !error && page < total && page > 0 && !stale;

  // A filter that hides most of a page asks for the next one straight away.
  useEffect(() => {
    if (more && visible.length < 12 && items.length > 0) load(shownKey, page + 1);
  }, [more, visible.length, items.length]);

  return (
    <div className="browse-tab">
      <div className="sticky-filters">
        <FilterBar
          f={f}
          region={region}
          onChange={(next) => setBrowseFilters(next)}
          onSave={async (name) => {
            await saveFilter(name, f);
            showToast(`Saved “${name}”. Find it in My List → Saved filters.`);
          }}
        />
      </div>
      <OfflineStrip onRetry={() => load(debounced, Math.max(1, page))} />
      {error && items.length === 0 ? (
        <EmptyState
          title={online ? "Couldn't load titles" : "You're offline"}
          text={online ? "TMDB didn't answer. It usually works on a second try." : "Browse needs the internet. Your library and lists still work."}
          action={<button className="btn" onClick={() => load(debounced, 1)}>Try again</button>}
        />
      ) : !loading && !stale && visible.length === 0 && page >= 1 ? (
        <EmptyState
          icon={<IconFilter />}
          title="No titles match"
          text={nearestFix(f)}
          action={<button className="btn" onClick={() => setBrowseFilters({ ...f, ...relax(f) })}>Loosen the filters</button>}
        />
      ) : (
        <div className={`pgrid reveal ${stale || (loading && page === 0) ? "dim" : ""}`}>
          {visible.map((i, n) => (
            <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={owned.get(`${i.type}:${i.id}`)} style={reveal(n)} />
          ))}
          {(loading || items.length === 0) && !error && <SkeletonCards count={items.length ? 6 : 18} />}
        </div>
      )}
      <EndSentinel active={more} onMore={() => load(shownKey, page + 1)} />
      {page >= total && items.length > 0 && <p className="grid-end">That's everything that matches.</p>}
      {error && items.length > 0 && (
        <p className="grid-end">Couldn't load more. <button className="link-btn inline" onClick={() => load(shownKey, page + 1)}>Try again</button></p>
      )}
    </div>
  );
}

function nearestFix(f: BrowseFilters): string {
  if (f.rating && f.rating >= 7.5) return "Try a lower minimum rating.";
  if (f.providers.length) return "Try another streaming service, or remove the service filter.";
  if (f.keywords.length) return "Try fewer themes.";
  if (f.genres.length > 1 && f.genreMode === "all") return "Try matching any of the genres instead of all of them.";
  if (f.yearFrom || f.yearTo) return "Try a wider range of years.";
  return "Try removing a filter.";
}

function relax(f: BrowseFilters): Partial<BrowseFilters> {
  if (f.rating && f.rating >= 7.5) return { rating: f.rating - 1 };
  if (f.providers.length) return { providers: [] };
  if (f.keywords.length) return { keywords: f.keywords.slice(0, -1) };
  if (f.genres.length > 1 && f.genreMode === "all") return { genreMode: "any" };
  if (f.yearFrom || f.yearTo) return { yearFrom: null, yearTo: null };
  return { genres: [], runtime: null, status: null, language: null };
}
