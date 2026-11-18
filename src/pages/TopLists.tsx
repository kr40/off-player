import { useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { GROUPS, listsIn, type TopList } from "../discover/toplists";
import { listProgress, tmdbListPage } from "../discover/toplistData";
import { useKind } from "../discover/kind";
import { useNearView } from "../components/browse/DiscoverCard";
import { KindSwitch } from "./DiscoverForYou";
import { tmdbImg } from "../lib/img";
import { IconTrophy } from "../components/icons";

/** Discover → Top Lists: every ranked list, grouped. */
export default function TopLists() {
  const kind = useKind();
  const fits = (l: TopList) =>
    kind === "all" ? true : kind === "anime" ? !!l.anime : l.type === kind && !l.anime;
  return (
    <div className="toplists">
      <header className="tab-head">
        <div>
          <h1>Top Lists</h1>
          <p>Ranked by rating with enough votes to mean something. Mark what you've seen and watch the count go up.</p>
        </div>
        <KindSwitch />
      </header>
      {GROUPS.map((g) => {
        const ls = listsIn(g.id).filter(fits);
        if (!ls.length) return null;
        return (
          <section key={g.id} className="tl-group">
            <div className="tl-group-head">
              <h2>{g.title}</h2>
              <span>{g.blurb}</span>
            </div>
            <div className="tl-grid">
              {ls.map((l) => <ListTile key={l.id} l={l} />)}
            </div>
          </section>
        );
      })}
      {kind === "anime" && (
        <p className="search-hint pad">More anime lists live under Browse → Anime, sorted by rating.</p>
      )}
    </div>
  );
}

/** A list tile: the backdrops of its top three titles, its name and your progress. */
export function ListTile({ l }: { l: TopList }) {
  const { push } = useNav();
  const ref = useRef<HTMLButtonElement>(null);
  const near = useNearView(ref, "400px");
  const [art, setArt] = useState<(string | null)[] | null>(null);
  useEffect(() => {
    if (!near) return;
    tmdbListPage(l, 1)
      .then((items) => setArt(items.slice(0, 3).map((i) => i.backdrop ?? i.poster)))
      .catch(() => setArt([]));
  }, [near, l]);
  const prog = listProgress.get(l.id);
  return (
    <button ref={ref} className="tl-tile" onClick={() => push({ page: "toplist", id: l.id })} title={l.blurb}>
      <span className="tl-art">
        {art === null ? (
          <span className="tl-art-skel" />
        ) : art.length === 0 ? (
          <span className="tl-art-ph"><IconTrophy /></span>
        ) : (
          art.map((a, i) => (a ? <img key={i} src={tmdbImg(a, "w300")} alt="" loading="lazy" className={`tl-art-${i}`} onLoad={(e) => e.currentTarget.classList.add("in")} /> : null))
        )}
        <span className="tl-size">{l.size}</span>
      </span>
      <span className="tl-text">
        <span className="tl-title">{l.title}</span>
        <span className="tl-blurb">{prog ? `${prog.seen} of ${prog.total} seen` : l.blurb}</span>
      </span>
      {prog && (
        <span className="tl-bar" aria-hidden><span style={{ transform: `scaleX(${prog.total ? prog.seen / prog.total : 0})` }} /></span>
      )}
    </button>
  );
}
