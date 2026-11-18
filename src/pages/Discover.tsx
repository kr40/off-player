import { useEffect, useState } from "react";
import { getSetting } from "../library/db";
import { PageScroll, useNav, lastDiscoverTab, type DiscoverTab } from "../app/nav";
import DiscoverForYou from "./DiscoverForYou";
import DiscoverBrowse from "./DiscoverBrowse";
import TopLists from "./TopLists";
import Collections from "./Collections";
import ComingSoon from "./ComingSoon";
import { IconLayers } from "../components/icons";

/**
 * Discover: For You · Browse · Top Lists · Collections · Coming Soon. The
 * sub-menu lives in the top bar; a tab stays mounted once visited, so going
 * back to it doesn't reload or lose its scroll position.
 */
export default function Discover({ tab }: { tab?: DiscoverTab }) {
  const { push } = useNav();
  const active = tab ?? lastDiscoverTab;
  const [visited, setVisited] = useState<Set<DiscoverTab>>(() => new Set([active]));
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  useEffect(() => {
    setVisited((v) => (v.has(active) ? v : new Set(v).add(active)));
  }, [active]);
  useEffect(() => {
    getSetting("tmdb_key").then((k) => setHasKey(!!k));
  }, []);

  if (hasKey === false)
    return (
      <PageScroll className="center-page">
        <div className="empty-state big">
          <div className="empty-icon" aria-hidden><IconLayers /></div>
          <h3>Discover needs a free TMDB key</h3>
          <p>Suggestions, top lists, collections and search for any show or movie come from TMDB. It takes two minutes and is free.</p>
          <button className="btn primary" onClick={() => push({ page: "settings", section: "discover" })}>Add a TMDB key</button>
        </div>
      </PageScroll>
    );

  const panes: [DiscoverTab, () => React.ReactNode][] = [
    ["foryou", () => <DiscoverForYou />],
    ["browse", () => <DiscoverBrowse />],
    ["toplists", () => <TopLists />],
    ["collections", () => <Collections />],
    ["soon", () => <ComingSoon />],
  ];
  return (
    <>
      {panes.map(([id, render]) =>
        visited.has(id) ? (
          <div key={id} className="dtab-host" style={{ display: id === active ? "block" : "none" }}>
            <PageScroll active={id === active} className={`dtab dtab-${id}`}>{render()}</PageScroll>
          </div>
        ) : null,
      )}
    </>
  );
}
