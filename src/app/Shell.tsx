import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { NavCtx, PageCtx, rememberDiscoverTab, type Nav, type Route } from "./nav";
import TopNav from "./TopNav";
import Home from "../pages/Home";
import TitlePage from "../pages/TitlePage";
import Library from "../pages/Library";
import Search from "../pages/Search";
import Manage from "../pages/Manage";
import Discover from "../pages/Discover";
import TmdbPage from "../pages/TmdbPage";
import MyList from "../pages/MyList";
import SettingsPage from "../pages/SettingsPage";
import TopListPage from "../pages/TopListPage";
import CollectionPage from "../pages/CollectionPage";
import PersonPage from "../pages/PersonPage";
import Toaster from "../components/Toast";
import ShortcutHelp from "../components/ShortcutHelp";
import { runJob } from "../library/jobs";
import { startup } from "../library/actions";
import { afterStartup } from "../library/startup2";
import { kickSegments } from "../library/segmentScan";
import { focusSearch } from "./searchStore";
import type { PlayItem } from "../components/Player";
import "../styles/browse.css";
import "../styles/v2.css";

let startedOnce = false; // survives hot reload of this module's component

const routeKey = (r: Route) =>
  r.page === "title" ? `title:${r.id}`
  : r.page === "tmdb" ? `tmdb:${r.type}:${r.id}`
  : r.page === "toplist" ? `toplist:${r.id}`
  : r.page === "collection" ? `collection:${r.key}`
  : r.page === "person" ? `person:${r.id}`
  : r.page;

/** Cross-fade between pages where the webview supports view transitions. */
function transition(update: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    d.startViewTransition(() => flushSync(update));
  } else update();
}

export default function Shell({ onPlay, playing }: { onPlay: (i: PlayItem) => void; playing: boolean }) {
  const [stack, setStack] = useState<Route[]>([{ page: "home" }]);
  const [scrolled, setScrolled] = useState(false);
  const [help, setHelp] = useState(false);
  const route = stack[stack.length - 1];

  const go = useCallback((r: Route) => transition(() => setStack([r])), []);
  const push = useCallback(
    (r: Route) =>
      transition(() =>
        setStack((s) => (routeKey(s[s.length - 1]) === routeKey(r) ? [...s.slice(0, -1), r] : [...s, r])),
      ),
    [],
  );
  const back = useCallback(() => transition(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))), []);

  useEffect(() => {
    if (route.page === "discover" && route.tab) rememberDiscoverTab(route.tab);
  }, [route]);

  const nav: Nav = useMemo(
    () => ({ route, go, push, back, canGoBack: stack.length > 1, play: onPlay }),
    [route, go, push, back, stack.length, onPlay],
  );

  // Once per launch: seed dev folders, finish pending metadata and thumbnails,
  // then the 2.0 extras (cache purge, links to IMDb and collections, IMDb refresh).
  useEffect(() => {
    if (startedOnce) return;
    startedOnce = true;
    // Finding intros starts last; it waits by itself while any job runs or the player is open.
    runJob((r) => startup(r))
      .then(() => afterStartup())
      .finally(() => kickSegments());
  }, []);

  // Esc / Backspace / mouse back go back; "/" focuses search; "g" then a letter jumps; "?" shows shortcuts.
  useEffect(() => {
    const blocked = () => playing || !!document.querySelector(".modal-backdrop, .onboarding");
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if (blocked() || e.ctrlKey || e.altKey || e.metaKey) return;
      if ((e.key === "Escape" || (e.key === "Backspace" && !typing(e.target))) && stack.length > 1) {
        e.preventDefault();
        back();
        return;
      }
      if (typing(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        focusSearch();
      } else if (e.key === "?") {
        setHelp((h) => !h);
      } else if (e.key === "g") {
        g = Date.now();
      } else if (Date.now() - g < 1200) {
        const to: Record<string, Route> = {
          h: { page: "home" },
          l: { page: "library" },
          d: { page: "discover" },
          m: { page: "mylist" },
          s: { page: "settings" },
        };
        if (to[e.key]) {
          e.preventDefault();
          go(to[e.key]);
        }
        g = 0;
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3 && !blocked()) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [playing, stack.length, back, go]);

  return (
    <NavCtx.Provider value={nav}>
      <div className="app">
        <TopNav solid={scrolled} />
        {stack.map((r, i) => {
          const active = i === stack.length - 1;
          return (
            <div key={`${i}:${routeKey(r)}`} className="page-host" style={{ display: active ? "block" : "none" }}>
              <PageCtx.Provider value={{ active, onScrolled: setScrolled }}>
                <Page route={r} />
              </PageCtx.Provider>
            </div>
          );
        })}
        {!playing && <Toaster />}
        {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      </div>
    </NavCtx.Provider>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "home": return <Home />;
    case "library": return <Library tab={route.tab} />;
    case "search": return <Search />;
    case "manage": return <Manage />;
    case "discover": return <Discover tab={route.tab} />;
    case "mylist": return <MyList tab={route.tab} />;
    case "settings": return <SettingsPage section={route.section} />;
    case "toplist": return <TopListPage id={route.id} />;
    case "collection": return <CollectionPage ckey={route.key} />;
    case "person": return <PersonPage id={route.id} />;
    case "tmdb": return <TmdbPage type={route.type} id={route.id} seed={route.seed} />;
    case "title": return <TitlePage id={route.id} initialSeason={route.season} />;
  }
}
