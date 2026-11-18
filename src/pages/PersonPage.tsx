import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listTitles, type TitleRow } from "../library/db";
import { useLibraryVersion } from "../library/store";
import { person, type PersonDetail } from "../discover/api";
import { kindMatches, useKind } from "../discover/kind";
import { PageScroll } from "../app/nav";
import DiscoverCard from "../components/browse/DiscoverCard";
import { EmptyState, OfflineStrip, reveal } from "../components/browse/Grid";
import { KindSwitch } from "./DiscoverForYou";
import { tmdbImg } from "../lib/img";

/** A person: their photo, story and everything they're in or made. */
export default function PersonPage({ id }: { id: number }) {
  const v = useLibraryVersion();
  const kind = useKind();
  const [p, setP] = useState<PersonDetail | null | undefined>(undefined);
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    person(id).then((x) => alive && setP(x)).catch(() => alive && setP(null));
    return () => {
      alive = false;
    };
  }, [id, attempt]);
  useEffect(() => {
    listTitles().then(setTitles);
  }, [v]);
  const owned = useMemo(() => new Map(titles.filter((t) => t.tmdb_id).map((t) => [`${t.tmdb_type}:${t.tmdb_id}`, t.id])), [titles]);

  if (p === undefined)
    return (
      <PageScroll className="ppage">
        <div className="person-head skeleton-head"><span className="person-photo skel" /><span className="skel-lines" /></div>
      </PageScroll>
    );
  if (p === null)
    return (
      <PageScroll className="center-page">
        <EmptyState title="Couldn't load this person" text="TMDB didn't answer." action={<button className="btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button>} />
      </PageScroll>
    );

  const acting = p.acting.filter((i) => kindMatches(kind, i));
  const making = p.making.filter((i) => kindMatches(kind, i));
  const born = p.born ? new Date(`${p.born}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <PageScroll className="ppage">
      <OfflineStrip />
      <header className="person-head">
        {p.photo ? <img className="person-photo" src={tmdbImg(p.photo, "w300")} alt="" onLoad={(e) => e.currentTarget.classList.add("in")} /> : <span className="person-photo ph">{p.name.slice(0, 1)}</span>}
        <div className="person-text">
          <div className="hero-kicker">{p.dept === "Acting" ? "Actor" : p.dept || "Person"}</div>
          <h1>{p.name}</h1>
          <p className="person-facts">{[born && `Born ${born}`, p.place].filter(Boolean).join(" · ")}</p>
          {p.bio && (
            <p className={`person-bio ${more ? "open" : ""}`}>
              {p.bio}
            </p>
          )}
          <div className="row-gap">
            {p.bio.length > 420 && <button className="link-btn" onClick={() => setMore((m) => !m)}>{more ? "Less" : "Read more"}</button>}
            <button className="link-btn" onClick={() => openUrl(`https://www.themoviedb.org/person/${p.id}`)}>View on TMDB</button>
          </div>
        </div>
      </header>
      <div className="tab-head slim"><div /><KindSwitch /></div>
      {acting.length > 0 && (
        <section className="tl-group">
          <div className="tl-group-head"><h2>Acting</h2><span>{acting.length} titles</span></div>
          <div className="pgrid reveal">
            {acting.map((i, n) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={owned.get(`${i.type}:${i.id}`)} style={reveal(n)} />)}
          </div>
        </section>
      )}
      {making.length > 0 && (
        <section className="tl-group">
          <div className="tl-group-head"><h2>Directing, writing and producing</h2><span>{making.length} titles</span></div>
          <div className="pgrid reveal">
            {making.map((i, n) => <DiscoverCard key={`${i.type}:${i.id}`} item={i} libraryId={owned.get(`${i.type}:${i.id}`)} style={reveal(n)} />)}
          </div>
        </section>
      )}
      {acting.length === 0 && making.length === 0 && <EmptyState title="No titles of this type" text="Switch to All to see everything." />}
    </PageScroll>
  );
}
