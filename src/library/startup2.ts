// Start-up work added in 2.0, run after the library scan job:
// - purge cached TMDB data older than six months (TMDB's terms),
// - refresh "watched" entries older than a week (same reason),
// - fill in original language, TMDB collection and IMDb id for library titles,
// - refresh IMDb ratings when enabled and a week old.
import { db, getSetting } from "./db";
import { libraryChanged } from "./store";
import { tmdb } from "./metadata";
import { purgeOldCache } from "../discover/cache";
import { refreshImdbIfStale, rememberImdbId } from "../discover/imdb";
import { refreshSeenStale } from "./seen";
import { isOnline } from "../lib/net";

export async function afterStartup() {
  await purgeOldCache().catch((e) => console.warn("cache purge", e));
  if (!(await getSetting("tmdb_key")) || !isOnline()) return;
  await backfillTitles().catch((e) => console.warn("backfill", e));
  await refreshSeenStale().catch((e) => console.warn("seen refresh", e));
  await refreshImdbIfStale().catch((e) => console.warn("imdb refresh", e));
}

/** Library titles matched before 2.0 lack these; one small request each, once. */
async function backfillTitles() {
  const d = await db();
  const rows = await d.select<{ id: number; tmdb_type: "tv" | "movie"; tmdb_id: number }[]>(
    "SELECT id, tmdb_type, tmdb_id FROM titles WHERE tmdb_id IS NOT NULL AND tmdb_type IS NOT NULL AND orig_lang IS NULL",
  );
  let changed = false;
  for (const r of rows) {
    try {
      const x = await tmdb<any>(`/${r.tmdb_type}/${r.tmdb_id}`, { append_to_response: "external_ids" });
      await d.execute("UPDATE titles SET orig_lang = $1, collection_id = $2 WHERE id = $3", [
        x.original_language ?? "",
        x.belongs_to_collection?.id ?? null,
        r.id,
      ]);
      await rememberImdbId(r.tmdb_type, r.tmdb_id, x.imdb_id || x.external_ids?.imdb_id || null);
      changed = true;
    } catch {
      // offline or not found: try again next launch
    }
  }
  if (changed) libraryChanged();
}
