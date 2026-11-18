// Franchises: hand-curated groups of movies and series with a release order
// (computed from TMDB dates) and a story order (checked against a public
// source, recorded per franchise). Authoring files live in ./source/*.json;
// scripts/build-franchises.mjs resolves every entry to a TMDB id and writes
// ./data.json, which is all the app reads. Pure helpers only in this file.
import data from "./data.json";
import type { MediaType } from "../api";

export type FEntry = {
  ref: string;
  type: MediaType;
  id: number;
  season?: number; // a single season of a series
  title: string;
  year: number | null;
  date: string | null; // release / first air (or the season's air date)
  poster: string | null;
  backdrop: string | null;
  note?: string;
  runtime?: number; // minutes (movies)
  rating?: number; // TMDB rating when built
};

export type FOrder = { id: string; label: string; refs: string[] };

export type Franchise = {
  key: string;
  name: string;
  blurb: string;
  group: "film" | "anime";
  sources: string[];
  backdrop: string | null;
  entries: FEntry[];
  orders: FOrder[]; // story (and optional extra) orders; release is computed
  tmdbCollections?: number[]; // TMDB movie collections this franchise replaces
};

export const FRANCHISES: Franchise[] = (data as { franchises: Franchise[] }).franchises ?? [];
export const POPULAR_COLLECTIONS: { id: number; name: string; poster: string | null; backdrop: string | null; count: number }[] =
  (data as { collections?: { id: number; name: string; poster: string | null; backdrop: string | null; count: number }[] }).collections ?? [];

export const franchiseByKey = (key: string) => FRANCHISES.find((f) => f.key === key);

/** Release order: by date, undated (unreleased, unannounced) last, then by title. */
export function releaseOrder(entries: FEntry[]): string[] {
  return [...entries]
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.title.localeCompare(b.title))
    .map((e) => e.ref);
}

export function ordersOf(f: Franchise): FOrder[] {
  const rel: FOrder = { id: "release", label: "Release order", refs: releaseOrder(f.entries) };
  return [rel, ...f.orders];
}

export function inOrder(f: Franchise, orderId: string): FEntry[] {
  const order = ordersOf(f).find((o) => o.id === orderId) ?? ordersOf(f)[0];
  const by = new Map(f.entries.map((e) => [e.ref, e]));
  return order.refs.map((r) => by.get(r)).filter((e): e is FEntry => !!e);
}

export type EntryState = { watched: boolean; released: boolean };

/** Index of the first released, unwatched entry, or -1 when everything released is watched. */
export function nextUpIndex(states: EntryState[]): number {
  return states.findIndex((s) => s.released && !s.watched);
}

export function progress(states: EntryState[]): { watched: number; total: number } {
  const released = states.filter((s) => s.released);
  return { watched: released.filter((s) => s.watched).length, total: released.length };
}

/** Franchises containing a title (any of its entries). */
export function franchisesWith(type: MediaType, id: number): Franchise[] {
  return FRANCHISES.filter((f) => f.entries.some((e) => e.type === type && e.id === id));
}

/** Validation used by the build script and the tests. Returns problems, empty when fine. */
export function validate(f: Franchise): string[] {
  const out: string[] = [];
  const refs = f.entries.map((e) => e.ref);
  if (new Set(refs).size !== refs.length) out.push(`${f.key}: duplicate refs`);
  const ids = f.entries.map((e) => `${e.type}:${e.id}:${e.season ?? ""}`);
  if (new Set(ids).size !== ids.length) out.push(`${f.key}: the same title twice`);
  if (f.orders.length && !f.sources.length) out.push(`${f.key}: no source recorded for the story order`);
  for (const o of f.orders) {
    const s = [...o.refs].sort().join(",");
    if (s !== [...refs].sort().join(",")) out.push(`${f.key}: order "${o.id}" is not a permutation of the entries`);
  }
  return out;
}
