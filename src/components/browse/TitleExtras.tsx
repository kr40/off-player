// Pieces shared by the TMDB title page and the library title page: both
// ratings side by side, and the "Part of …" strip linking to a collection.
import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MediaType } from "../../discover/api";
import { fmtVotes, useImdbRating } from "../../discover/imdb";
import { franchisesWith } from "../../discover/franchises";
import { fromFranchise, loadCollection, orderedEntries, useCollectionStates, type Coll } from "../../discover/collections";
import { useNav } from "../../app/nav";
import { tmdbImg } from "../../lib/img";
import { IconLayers, IconStar } from "../icons";

/** IMDb and TMDB ratings side by side. Clicking IMDb opens the title on imdb.com. */
export function RatingPair({ type, id, imdbId, tmdb, votes, name, year }: { type: MediaType; id: number; imdbId?: string | null; tmdb: number | null; votes?: number; name?: string; year?: number | null }) {
  const r = useImdbRating({ type, id, imdbId, name, year }, true);
  return (
    <span className="rating-pair">
      {r && (
        <button className="rpair imdb" onClick={() => openUrl(`https://www.imdb.com/title/${r.tconst}/`)} title={`IMDb: ${r.rating.toFixed(1)} from ${r.votes.toLocaleString()} votes. Open on IMDb.`}>
          <b className="src imdb">IMDb</b>
          {r.rating.toFixed(1)}
          <small>{fmtVotes(r.votes)}</small>
        </button>
      )}
      {tmdb ? (
        <span className="rpair" title={votes ? `TMDB: ${tmdb.toFixed(1)} from ${votes.toLocaleString()} votes` : "TMDB rating"}>
          {r ? <b className="src">TMDB</b> : <IconStar className="star" />}
          {tmdb.toFixed(1)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * "Part of Dune": the neighbouring entries in the user's chosen order, the
 * current one highlighted. Uses a franchise when one contains the title, else
 * the TMDB movie collection.
 */
export function PartOfStrip({ type, id, tmdbCollection }: { type: MediaType; id: number; tmdbCollection?: number | null }) {
  const { push } = useNav();
  const states = useCollectionStates();
  const fr = franchisesWith(type, id)[0];
  const [c, setC] = useState<Coll | null>(fr ? fromFranchise(fr) : null);
  useEffect(() => {
    if (fr) return setC(fromFranchise(fr));
    if (!tmdbCollection) return setC(null);
    let alive = true;
    loadCollection(`tmdb:${tmdbCollection}`)
      .then((x) => alive && setC(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fr?.key, tmdbCollection]);

  const st = c ? states.get(c.key) : undefined;
  const order = st?.order_id && c?.orders.some((o) => o.id === st.order_id) ? st.order_id : "release";
  const entries = useMemo(() => (c ? orderedEntries(c, order) : []), [c, order]);
  if (!c || entries.length < 2) return null;
  const at = entries.findIndex((e) => e.type === type && e.id === id);
  const from = Math.max(0, Math.min(at - 2, entries.length - 5));
  const shown = entries.slice(from, from + 5);
  return (
    <section className="partof">
      <div className="partof-head">
        <IconLayers />
        <span>Part of <b>{c.name}</b> · {at + 1} of {entries.length} {order === "release" ? "in release order" : "in story order"}</span>
        <button className="link-btn" onClick={() => push({ page: "collection", key: c.key })}>See the whole collection</button>
      </div>
      <div className="partof-row">
        {shown.map((e) => {
          const here = e.type === type && e.id === id && (!e.season || shown.filter((x) => x.id === id).length === 1);
          return (
            <button
              key={e.ref}
              className={`partof-item ${here ? "here" : ""}`}
              onClick={() => (here ? null : push({ page: "tmdb", type: e.type, id: e.id }))}
              title={e.title}
              aria-current={here ? "true" : undefined}
            >
              {e.poster ? <img src={tmdbImg(e.poster, "w185")} alt="" loading="lazy" /> : <span className="tcard-ph dcard-ph">{e.title}</span>}
              <span className="partof-name">{e.title}{e.season ? ` S${e.season}` : ""}</span>
              <span className="partof-year">{e.year ?? "TBA"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
