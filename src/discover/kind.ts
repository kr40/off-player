// The All · Series · Movies · Anime switch, shared by every Discover tab for
// the session and remembered between launches.
import { useSyncExternalStore } from "react";
import { getSetting, setSetting } from "../library/db";
import type { Item, MediaType } from "./api";
import { isAnime } from "./api";

export type Kind = "all" | "tv" | "movie" | "anime";
export const KINDS: { id: Kind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tv", label: "Series" },
  { id: "movie", label: "Movies" },
  { id: "anime", label: "Anime" },
];

let kind: Kind = "all";
let loaded = false;
const subs = new Set<() => void>();

export function useKind(): Kind {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!loaded) {
        loaded = true;
        getSetting("type_filter").then((v) => {
          if (v === "all" || v === "tv" || v === "movie" || v === "anime") {
            kind = v;
            subs.forEach((g) => g());
          }
        });
      }
      return () => subs.delete(f);
    },
    () => kind,
  );
}

/** Set from the value read before first render (app/preload.ts). */
export function hydrateKind(v: string | null) {
  if (v === "all" || v === "tv" || v === "movie" || v === "anime") kind = v;
  loaded = true;
}

export function setKind(k: Kind) {
  kind = k;
  loaded = true;
  subs.forEach((g) => g());
  setSetting("type_filter", k);
}

/** Does an item pass the switch? */
export const kindMatches = (k: Kind, i: Item) => k === "all" || (k === "anime" ? isAnime(i) : i.type === k);

/** Endpoints to query for a kind: anime may be either series or movies. */
export const kindTypes = (k: Kind): MediaType[] => (k === "tv" ? ["tv"] : k === "movie" ? ["movie"] : ["tv", "movie"]);
