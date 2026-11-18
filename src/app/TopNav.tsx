import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { discoverTabOf, rememberDiscoverTab, sectionOf, useNav, type DiscoverTab, type Route } from "./nav";
import { useJobs } from "../library/jobs";
import { useOnline } from "../lib/net";
import { registerSearchInput, searchEnter, setSearchQuery, useSearchQuery } from "./searchStore";
import { IconBack, IconSearch, IconSettings } from "../components/icons";

const LINKS: { label: string; section: NonNullable<ReturnType<typeof sectionOf>>; route: Route }[] = [
  { label: "Home", section: "home", route: { page: "home" } },
  { label: "Library", section: "library", route: { page: "library" } },
  { label: "Discover", section: "discover", route: { page: "discover" } },
  { label: "My List", section: "mylist", route: { page: "mylist" } },
];

export const DISCOVER_TABS: { id: DiscoverTab; label: string }[] = [
  { id: "foryou", label: "For You" },
  { id: "browse", label: "Browse" },
  { id: "toplists", label: "Top Lists" },
  { id: "collections", label: "Collections" },
  { id: "soon", label: "Coming Soon" },
];

/**
 * A row of buttons with one underline that slides to the active item
 * (transform only, so it stays smooth).
 */
export function SlidingTabs<T extends string>({ items, active, onPick, className, label }: {
  items: { id: T; label: ReactNode }[];
  active: T | null;
  onPick: (id: T) => void;
  className?: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current?.querySelector<HTMLElement>(`[data-id="${active}"]`);
      setBar(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [active, items.length]);
  return (
    <div className={`stabs ${className ?? ""}`} ref={box} role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          data-id={it.id}
          role="tab"
          aria-selected={it.id === active}
          className={it.id === active ? "on" : ""}
          onClick={() => onPick(it.id)}
        >
          {it.label}
        </button>
      ))}
      <span
        className={`stabs-bar ${bar ? "" : "hidden"}`}
        style={bar ? { transform: `translateX(${bar.x}px) scaleX(${bar.w})` } : undefined}
        aria-hidden
      />
    </div>
  );
}

export default function TopNav({ solid }: { solid: boolean }) {
  const { route, go, push, back, canGoBack } = useNav();
  const { progress, background } = useJobs();
  const online = useOnline();
  const q = useSearchQuery();
  const section = sectionOf(route);
  const dtab = discoverTabOf(route);

  return (
    <header className={`topnav ${solid ? "solid" : ""} ${dtab ? "with-sub" : ""}`}>
      <div className="topnav-main">
        {canGoBack ? (
          <button className="nav-icon back" onClick={back} aria-label="Back" title="Back (Esc)">
            <IconBack />
          </button>
        ) : null}
        <button className="brand" onClick={() => go({ page: "home" })}>
          <span className="mark" aria-hidden />
          Off Player
        </button>
        <SlidingTabs
          className="nav-links"
          label="Sections"
          items={LINKS.map((l) => ({ id: l.section, label: l.label }))}
          active={section}
          onPick={(id) => go(LINKS.find((l) => l.section === id)!.route)}
        />
        <div className="nav-right">
          {!online && <span className="offline-pill" title="Showing what's saved on this PC">Offline</span>}
          {progress && route.page !== "manage" && (
            <button className="job-pill" onClick={() => go({ page: "manage" })} title="Open library management">
              <span className="spinner" />
              {progress.label}
              {progress.total > 0 && <span className="dim-num">{Math.round((progress.done / progress.total) * 100)}%</span>}
            </button>
          )}
          {!progress && background && (
            <button
              className="job-pill quiet"
              onClick={() => push({ page: "settings", section: "playback" })}
              title={`${background.label}${background.current ? ` · ${background.current}` : ""}. Paused while you watch. Click for Skip intro settings.`}
            >
              <span className="spinner" />
              {background.label}
              {background.total > 0 && <span className="dim-num">{Math.round((background.done / background.total) * 100)}%</span>}
            </button>
          )}
          <label className={`nav-search ${route.page === "search" ? "on" : ""}`}>
            <IconSearch />
            <input
              ref={registerSearchInput}
              value={q}
              placeholder="Search"
              aria-label="Search your library and TMDB"
              spellCheck={false}
              onFocus={() => {
                if (q && route.page !== "search") push({ page: "search" });
              }}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value && route.page !== "search") push({ page: "search" });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchEnter();
                if (e.key === "Escape") {
                  if (q) {
                    e.stopPropagation();
                    e.preventDefault();
                    setSearchQuery("");
                  } else (e.target as HTMLInputElement).blur();
                }
              }}
            />
            {q ? (
              <button className="nav-search-x" onClick={() => setSearchQuery("")} aria-label="Clear search">×</button>
            ) : (
              <kbd>/</kbd>
            )}
          </label>
          <button
            className={`nav-icon ${route.page === "settings" ? "on" : ""}`}
            onClick={() => (route.page === "settings" ? back() : push({ page: "settings" }))}
            aria-label="Settings"
            title="Settings"
          >
            <IconSettings />
          </button>
        </div>
      </div>
      {dtab && (
        <div className="subnav">
          <SlidingTabs
            className="subnav-tabs"
            label="Discover"
            items={DISCOVER_TABS}
            active={dtab}
            onPick={(id) => {
              rememberDiscoverTab(id);
              if (route.page === "discover") push({ page: "discover", tab: id });
              else go({ page: "discover", tab: id });
            }}
          />
        </div>
      )}
    </header>
  );
}
