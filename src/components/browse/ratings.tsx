// The rating shown on cards and banners. With IMDb data installed and
// "Rating shown on posters" set to IMDb it is the IMDb rating (falling back to
// TMDB's, clearly labelled, when IMDb has none); otherwise TMDB's.
import type { MediaType } from "../../discover/api";
import { useImdb, useImdbRating } from "../../discover/imdb";
import type { TitleRow } from "../../library/db";
import { IconStar } from "../icons";

export type RatedItem = {
  type: MediaType;
  id: number;
  name?: string;
  year?: number | null;
  rating: number | null;
  votes?: number;
  imdbId?: string | null;
};

/** A library title as something that can be rated (needs a TMDB match for IMDb). */
export function ratedTitle(t: TitleRow): RatedItem | null {
  if (!t.tmdb_id || !t.tmdb_type) return t.rating ? { type: t.kind === "show" ? "tv" : "movie", id: 0, rating: t.rating } : null;
  return { type: t.tmdb_type, id: t.tmdb_id, name: t.tmdb_name ?? t.name, year: t.tmdb_year ?? t.year, rating: t.rating };
}

export function useShownRating(item: RatedItem | null, near = true) {
  const imdb = useImdb();
  const on = imdb.enabled && imdb.count > 0;
  const r = useImdbRating(on && imdb.source === "imdb" && near && item && item.id ? item : null, true);
  if (r) return { src: "IMDb" as const, value: r.rating, labelled: true, title: `IMDb ${r.rating.toFixed(1)} from ${r.votes.toLocaleString()} votes` };
  if (!item?.rating) return null;
  return {
    src: "TMDB" as const,
    value: item.rating,
    labelled: on,
    title: `TMDB ${item.rating.toFixed(1)}${item.votes ? ` from ${item.votes.toLocaleString()} votes` : ""}`,
  };
}

function Body({ s }: { s: NonNullable<ReturnType<typeof useShownRating>> }) {
  return (
    <>
      {s.src === "IMDb" ? <b className="src imdb">IMDb</b> : s.labelled ? <b className="src">TMDB</b> : <IconStar className="star" />}
      {s.value.toFixed(1)}
    </>
  );
}

/** Badge in the corner of a poster. The size and position never change when the IMDb rating arrives. */
export function RatingBadge({ item, near = true }: { item: RatedItem | null; near?: boolean }) {
  const s = useShownRating(item, near);
  if (!s) return null;
  return <span className="pcard-rating" title={s.title}><Body s={s} /></span>;
}

/** The same rating inline, for banners and fact lines. */
export function InlineRating({ item }: { item: RatedItem | null }) {
  const s = useShownRating(item);
  if (!s) return null;
  return <span className="rating smart" title={s.title}><Body s={s} /></span>;
}
