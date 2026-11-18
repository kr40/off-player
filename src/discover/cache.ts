// TMDB responses kept on disk (table api_cache) so lists, collections and
// people reopen instantly and work offline. The caller decides how fresh an
// entry must be; a stale entry is still returned when the network fails.
// TMDB's terms allow caching for at most six months: older rows are purged
// at start-up.
import { db } from "../library/db";
import { markOnline } from "../lib/net";

const mem = new Map<string, { at: number; value: unknown }>();
export const DAY = 86_400_000;
const MAX_AGE = 180 * DAY;

export async function apiCached<T>(key: string, maxAge: number, fetch: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const m = mem.get(key);
  if (m && now - m.at < maxAge) return m.value as T;
  let row: { fetched_at: number; body: string } | undefined;
  try {
    [row] = await (await db()).select<{ fetched_at: number; body: string }[]>(
      "SELECT fetched_at, body FROM api_cache WHERE key = $1",
      [key],
    );
  } catch {
    row = undefined;
  }
  if (row && now - row.fetched_at < maxAge) {
    const value = JSON.parse(row.body) as T;
    mem.set(key, { at: row.fetched_at, value });
    return value;
  }
  try {
    const value = await fetch();
    mem.set(key, { at: now, value });
    (await db())
      .execute("INSERT OR REPLACE INTO api_cache (key, fetched_at, body) VALUES ($1, $2, $3)", [key, now, JSON.stringify(value)])
      .catch(() => {});
    return value;
  } catch (e) {
    if (row) {
      markOnline(false);
      const value = JSON.parse(row.body) as T;
      mem.set(key, { at: row.fetched_at, value });
      return value;
    }
    throw e;
  }
}

/** Is there anything cached for this key (fresh or not)? */
export async function hasCached(key: string): Promise<boolean> {
  if (mem.has(key)) return true;
  const [r] = await (await db()).select<{ n: number }[]>("SELECT COUNT(*) AS n FROM api_cache WHERE key = $1", [key]);
  return (r?.n ?? 0) > 0;
}

export async function purgeOldCache() {
  const cutoff = Date.now() - MAX_AGE;
  const d = await db();
  await d.execute("DELETE FROM api_cache WHERE fetched_at < $1", [cutoff]);
  await d.execute("DELETE FROM rec_cache WHERE fetched_at < $1", [cutoff]);
}

export const clearMemCache = () => mem.clear();
