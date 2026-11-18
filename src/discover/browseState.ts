// Browse's filter state: shared so My List → Saved filters can load a set,
// and remembered between launches (setting browse_filters).
import { useSyncExternalStore } from "react";
import { db, getSetting, setSetting } from "../library/db";
import { DEFAULT_FILTERS, parseFilters, type BrowseFilters } from "./filters";

let filters: BrowseFilters = DEFAULT_FILTERS;
let loaded = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let saveTimer = 0;

export function useBrowseFilters(): BrowseFilters {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!loaded) {
        loaded = true;
        getSetting("browse_filters").then((v) => {
          if (v) {
            filters = parseFilters(v);
            emit();
          }
        });
      }
      return () => subs.delete(f);
    },
    () => filters,
  );
}

export function hydrateBrowse(v: string | null) {
  if (v) filters = parseFilters(v);
  loaded = true;
}

export function setBrowseFilters(next: BrowseFilters) {
  filters = next;
  loaded = true;
  emit();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => setSetting("browse_filters", JSON.stringify(filters)), 400);
}

// ---------------------------------------------------------------------------
// Saved filters (table saved_filters)

export type SavedFilter = { id: number; name: string; params: string; created_at: number };
let saved: SavedFilter[] = [];
let savedLoaded = false;
const savedSubs = new Set<() => void>();

async function loadSaved() {
  saved = await (await db()).select<SavedFilter[]>("SELECT * FROM saved_filters ORDER BY created_at DESC");
  savedSubs.forEach((f) => f());
}

export function useSavedFilters(): SavedFilter[] {
  return useSyncExternalStore(
    (f) => {
      savedSubs.add(f);
      if (!savedLoaded) {
        savedLoaded = true;
        loadSaved().catch(() => {});
      }
      return () => savedSubs.delete(f);
    },
    () => saved,
  );
}

export async function saveFilter(name: string, f: BrowseFilters) {
  await (await db()).execute("INSERT INTO saved_filters (name, params, created_at) VALUES ($1, $2, $3)", [name, JSON.stringify(f), Date.now()]);
  await loadSaved();
}

export async function deleteFilter(id: number): Promise<() => Promise<void>> {
  const old = saved.find((s) => s.id === id);
  await (await db()).execute("DELETE FROM saved_filters WHERE id = $1", [id]);
  await loadSaved();
  return async () => {
    if (!old) return;
    await (await db()).execute("INSERT INTO saved_filters (id, name, params, created_at) VALUES ($1, $2, $3, $4)", [old.id, old.name, old.params, old.created_at]);
    await loadSaved();
  };
}
