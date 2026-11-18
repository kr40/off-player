// The top bar's search field and the Search page share this state.
import { useSyncExternalStore } from "react";

let query = "";
const subs = new Set<() => void>();
let enterHandler: (() => void) | null = null;
let input: HTMLInputElement | null = null;

export function useSearchQuery(): string {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => query,
  );
}
export function setSearchQuery(q: string) {
  if (q === query) return;
  query = q;
  subs.forEach((f) => f());
}
/** The Search page registers what Enter opens (its first result). */
export const onSearchEnter = (fn: (() => void) | null) => {
  enterHandler = fn;
};
export const searchEnter = () => enterHandler?.();
export const registerSearchInput = (el: HTMLInputElement | null) => {
  input = el;
};
export const focusSearch = () => {
  input?.focus();
  input?.select();
};
