import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { PlayItem } from "../components/Player";

export type DiscoverTab = "foryou" | "browse" | "toplists" | "collections" | "soon";
export type LibraryTab = "all" | "series" | "movies" | "anime" | "collections";
export type SettingsSection = "general" | "library" | "playback" | "discover" | "data" | "about";

export type Route =
  | { page: "home" }
  | { page: "library"; tab?: LibraryTab }
  | { page: "search" }
  | { page: "manage" }
  | { page: "discover"; tab?: DiscoverTab }
  | { page: "mylist"; tab?: "watchlist" | "watched" | "filters" }
  | { page: "settings"; section?: SettingsSection }
  | { page: "toplist"; id: string }
  | { page: "collection"; key: string }
  | { page: "person"; id: number }
  | { page: "tmdb"; type: "tv" | "movie"; id: number; seed?: import("../discover/api").Item }
  | { page: "title"; id: number; season?: number };

/** Which top-bar item a page belongs to. */
export function sectionOf(r: Route): "home" | "library" | "discover" | "mylist" | null {
  switch (r.page) {
    case "home":
      return "home";
    case "library":
    case "manage":
    case "title":
      return "library";
    case "discover":
    case "toplist":
    case "collection":
    case "person":
    case "tmdb":
      return "discover";
    case "mylist":
      return "mylist";
    default:
      return null;
  }
}

/** The Discover sub-menu tab a page sits under, if any. */
export function discoverTabOf(r: Route): DiscoverTab | null {
  if (r.page === "discover") return r.tab ?? lastDiscoverTab;
  if (r.page === "toplist") return "toplists";
  if (r.page === "collection") return "collections";
  return null;
}

/** The last Discover tab used this session (PRD: remembered for the session). */
export let lastDiscoverTab: DiscoverTab = "foryou";
export const rememberDiscoverTab = (t: DiscoverTab) => {
  lastDiscoverTab = t;
};

export type Nav = {
  route: Route;
  go: (r: Route) => void; // top-level: replaces the stack
  push: (r: Route) => void; // drill-down: Back returns here
  back: () => void;
  canGoBack: boolean;
  play: (item: PlayItem) => void;
};

export const NavCtx = createContext<Nav>(null!);
export const useNav = () => useContext(NavCtx);

/**
 * Mark the artwork the user just clicked so the next page's hero morphs out of
 * it (view transitions match elements by name). Only one element may carry the
 * name at a time, so the previous one is cleared.
 */
let morphSource: HTMLElement | null = null;
export function morphFrom(el: HTMLElement | null) {
  if (morphSource && morphSource !== el) morphSource.style.viewTransitionName = "";
  if (el) el.style.viewTransitionName = "hero-art";
  morphSource = el;
}

// Each page reports whether it is scrolled, so the top bar can frost over content.
export const PageCtx = createContext<{ active: boolean; onScrolled: (s: boolean) => void }>({
  active: true,
  onScrolled: () => {},
});

/**
 * The scrolling area of a page. `active` narrows the page's own state for
 * panes inside a page (Discover's tabs each scroll on their own).
 */
export function PageScroll({ children, className = "", active: own = true }: { children: ReactNode; className?: string; active?: boolean }) {
  const ctx = useContext(PageCtx);
  const active = ctx.active && own;
  const onScrolled = ctx.onScrolled;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    onScrolled((ref.current?.scrollTop ?? 0) > 24);
    // Give the page keyboard focus so Page Up/Down, arrows and Space scroll it,
    // unless something inside already has focus or the user is typing somewhere
    // else: the search box lives in the top bar and opens the Search page on the
    // first letter, and taking focus then would swallow the rest of the word.
    const at = document.activeElement;
    const typing = at instanceof HTMLElement && (at.tagName === "INPUT" || at.tagName === "TEXTAREA" || at.isContentEditable);
    if (!typing && !ref.current?.contains(at)) ref.current?.focus({ preventScroll: true });
  }, [active, onScrolled]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`page ${className}`}
      onScroll={(e) => active && onScrolled(e.currentTarget.scrollTop > 24)}
    >
      {children}
    </div>
  );
}
