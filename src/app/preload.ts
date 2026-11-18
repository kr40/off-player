// Settings that change what a page shows are read once before the first
// render, so pages don't paint with defaults and then jump (PRD 2.0 §11.3).
import { getSetting } from "../library/db";
import { hydrateKind } from "../discover/kind";
import { hydrateBrowse } from "../discover/browseState";
import { hydrateImdb } from "../discover/imdb";
import { hydratePrompt } from "../discover/recs";
import { hydrateHide } from "../library/seen";

const KEYS = ["type_filter", "imdb_enabled", "imdb_count", "imdb_data_at", "rating_source", "browse_filters", "foryou_prompt_hidden", "hide_watched_in_discover"] as const;

export async function preloadSettings() {
  const v = Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, await getSetting(k).catch(() => null)] as const))) as Record<(typeof KEYS)[number], string | null>;
  hydrateKind(v.type_filter);
  hydrateBrowse(v.browse_filters);
  hydrateImdb(v.imdb_enabled, v.imdb_count, v.imdb_data_at, v.rating_source);
  hydratePrompt(v.foryou_prompt_hidden);
  hydrateHide(v.hide_watched_in_discover);
}
