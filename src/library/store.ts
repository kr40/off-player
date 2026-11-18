// Tiny change notifiers: anything that writes to the library calls
// libraryChanged(); pages read useLibraryVersion() and reload when it moves.
// tasteChanged() fires when the watched set, watchlist or dismissals change,
// so suggestions can be recomputed.
import { useSyncExternalStore } from "react";

let version = 0;
const subs = new Set<() => void>();
const tasteSubs = new Set<() => void>();

export function libraryChanged() {
  version++;
  subs.forEach((f) => f());
  tasteSubs.forEach((f) => f()); // playback changes feed the watched set
}

export function useLibraryVersion(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
}

export const tasteChanged = () => tasteSubs.forEach((f) => f());
export function onTasteChanged(f: () => void): () => void {
  tasteSubs.add(f);
  return () => tasteSubs.delete(f);
}
