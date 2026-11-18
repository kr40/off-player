// Sorting and filtering for My List. Pure, so it's unit-tested.
import type { Item, MediaType } from "../discover/api";
import type { Reaction } from "../discover/recommend";

export type ListSort = "added" | "release" | "name" | "rating" | "imdb";
export type ListStatus = "all" | "released" | "soon";
export type WatchedSort = "marked" | "name" | "reaction";

export const LIST_SORTS: { id: ListSort; label: string }[] = [
  { id: "added", label: "Date added" },
  { id: "release", label: "Release date" },
  { id: "name", label: "Name A–Z" },
  { id: "rating", label: "TMDB rating" },
  { id: "imdb", label: "IMDb rating" },
];

/** "Coming soon" = release / first-air date in the future (or not announced yet). */
export const isComingSoon = (date: string | null, now = Date.now()) =>
  !date || new Date(`${date}T00:00:00`).getTime() > now;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export function filterSaved<T extends Item>(list: T[], type: "all" | MediaType, status: ListStatus, now = Date.now()): T[] {
  return list.filter(
    (i) =>
      (type === "all" || i.type === type) &&
      (status === "all" || (status === "soon" ? isComingSoon(i.date, now) : !isComingSoon(i.date, now))),
  );
}

export function sortSaved<T extends Item & { addedAt: number }>(list: T[], sort: ListSort, imdb: Map<string, number> = new Map()): T[] {
  const out = [...list];
  if (sort === "added") out.sort((a, b) => b.addedAt - a.addedAt);
  // Release date: newest first; titles without a date (not announced) last.
  if (sort === "release") out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || byName(a, b));
  if (sort === "name") out.sort(byName);
  if (sort === "rating") out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b));
  if (sort === "imdb") out.sort((a, b) => (imdb.get(`${b.type}:${b.id}`) ?? -1) - (imdb.get(`${a.type}:${a.id}`) ?? -1) || byName(a, b));
  return out;
}

export function sortWatched<T extends Item & { seenAt: number; reaction: Reaction }>(list: T[], sort: WatchedSort): T[] {
  const out = [...list];
  if (sort === "marked") out.sort((a, b) => b.seenAt - a.seenAt);
  if (sort === "name") out.sort(byName);
  if (sort === "reaction") out.sort((a, b) => b.reaction - a.reaction || b.seenAt - a.seenAt);
  return out;
}
