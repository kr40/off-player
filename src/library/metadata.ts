// TMDB matching, artwork caching and fallback frame grabs. Runs after a scan
// and on demand (Fix match, Refresh). Everything fetched is stored locally, so
// browsing works offline afterwards.
import { invoke } from "@tauri-apps/api/core";
import { db, getSetting, setSetting } from "./db";
import {
  candidateName,
  candidateYear,
  mapEpisodes,
  MAPPING_VERSION,
  pickBest,
  type Candidate,
  type TmdbEpisode,
} from "./match";
import { pool } from "../lib/pool";
import { makeQueue, markOnline, sleep } from "../lib/net";

export type MetaProgress = { label: string; done: number; total: number; current?: string };

type TitleForMeta = {
  id: number;
  key: string;
  kind: "show" | "movie";
  name: string;
  year: number | null;
  tmdb_id: number | null;
  tmdb_type: string | null;
  match_state: string;
};

export class NoTmdbKey extends Error {
  constructor() {
    super("No TMDB key set");
  }
}

// Every TMDB request goes through one queue: at most 8 at a time, identical
// requests shared, 429 (rate limit) retried with back-off, one retry on a
// network error, and the app's online state updated from the outcome.
const queue = makeQueue(8);

export async function tmdb<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const key = await getSetting("tmdb_key");
  if (!key) throw new NoTmdbKey();
  const clean: Record<string, string> = {};
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v !== undefined && v !== "") clean[k] = String(v);
  }
  return queue.run(`${path}?${JSON.stringify(clean)}`, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await invoke<T>("tmdb_get", { path, params: clean, key });
        markOnline(true);
        return r;
      } catch (e) {
        const msg = String(e);
        if (/TMDB 429/.test(msg) && attempt < 4) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (/unreachable/i.test(msg)) {
          if (attempt < 1) {
            await sleep(1200);
            continue;
          }
          markOnline(false);
        }
        throw e;
      }
    }
  });
}

export async function testTmdbKey(key: string): Promise<void> {
  await invoke("tmdb_get", { path: "/authentication", params: {}, key });
}

const cacheImage = (file: string | null | undefined, size: string) =>
  file ? invoke<string>("cache_tmdb_image", { file, size }).catch(() => null) : Promise.resolve(null);

export async function searchTmdb(type: "tv" | "movie", query: string, year?: number | null): Promise<Candidate[]> {
  const res = await tmdb<{ results: Candidate[] }>(`/search/${type}`, {
    query,
    include_adult: "false",
    ...(year ? (type === "tv" ? { first_air_date_year: year } : { year }) : {}),
  });
  return res.results ?? [];
}

/** Find a TMDB id for a title: hand-picked override, then the year-filtered search, then an unfiltered one. */
async function findMatch(t: TitleForMeta): Promise<{ type: "tv" | "movie"; id: number; confidence: number } | null> {
  const d = await db();
  const [ov] = await d.select<{ tmdb_type: "tv" | "movie"; tmdb_id: number }[]>(
    "SELECT tmdb_type, tmdb_id FROM match_overrides WHERE key = $1",
    [t.key],
  );
  if (ov) return { type: ov.tmdb_type, id: ov.tmdb_id, confidence: 1 };
  const type = t.kind === "show" ? "tv" : "movie";
  let results = t.year ? await searchTmdb(type, t.name, t.year) : [];
  if (!results.length) results = await searchTmdb(type, t.name);
  const best = pickBest(results, t.name, t.year);
  return best ? { type, id: best.candidate.id, confidence: best.confidence } : null;
}

function pickLogo(logos: { file_path: string; iso_639_1: string | null; vote_average: number }[] = []) {
  const png = logos.filter((l) => l.file_path.endsWith(".png"));
  const en = png.filter((l) => l.iso_639_1 === "en");
  const pool_ = en.length ? en : png.filter((l) => !l.iso_639_1);
  return pool_.sort((a, b) => b.vote_average - a.vote_average)[0]?.file_path ?? null;
}

async function applyMatch(
  t: TitleForMeta,
  m: { type: "tv" | "movie"; id: number; confidence: number },
  state: string,
  report: (s: string) => void,
) {
  const d = await db();
  const details = await tmdb<any>(`/${m.type}/${m.id}`, {
    append_to_response: "images",
    include_image_language: "en,null",
  });
  report(`Artwork for ${details.name ?? details.title}`);
  const [poster, backdrop, logo] = await Promise.all([
    cacheImage(details.poster_path, "w500"),
    cacheImage(details.backdrop_path, "w1280"),
    cacheImage(pickLogo(details.images?.logos), "w500"),
  ]);
  const name = candidateName(details);
  const year = candidateYear(details);
  await d.execute("DELETE FROM episodes_meta WHERE title_id = $1", [t.id]);
  await d.execute("DELETE FROM seasons_meta WHERE title_id = $1", [t.id]);
  await d.execute(
    `UPDATE titles SET tmdb_id = $1, tmdb_type = $2, match_state = $3, match_confidence = $4,
       tmdb_name = $5, tmdb_year = $6, overview = $7, tagline = $8, genres = $9, rating = $10,
       poster = $11, backdrop = $12, logo = $13, meta_updated = $14
     WHERE id = $15`,
    [
      m.id, m.type, state, m.confidence, name, year, details.overview || null, details.tagline || null,
      JSON.stringify((details.genres ?? []).map((g: { name: string }) => g.name)),
      details.vote_average || null, poster, backdrop, logo, Date.now(), t.id,
    ],
  );

  if (m.type !== "tv") return;

  // Seasons present in the library only.
  const fileRows = await d.select<{ id: number; season: number; episode: number; episode_title: string | null }[]>(
    "SELECT id, season, episode, episode_title FROM files WHERE title_id = $1 AND role = 'episode'",
    [t.id],
  );
  const seasonNums = [...new Set(fileRows.map((f) => f.season))].sort((a, b) => a - b);
  const tmdbSeasons = new Map<number, TmdbEpisode[]>();
  const stills: { season: number; episode: number; path: string }[] = [];

  for (const sn of seasonNums) {
    let season: any;
    try {
      season = await tmdb(`/tv/${m.id}/season/${sn}`);
    } catch {
      continue; // season unknown to TMDB (e.g. specials numbering)
    }
    const sPoster = await cacheImage(season.poster_path, "w342");
    await d.execute(
      `INSERT OR REPLACE INTO seasons_meta (title_id, season, name, overview, poster, air_date, episode_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.id, sn, season.name ?? null, season.overview || null, sPoster, season.air_date ?? null, season.episodes?.length ?? null],
    );
    tmdbSeasons.set(sn, season.episodes ?? []);
    for (const e of season.episodes ?? []) {
      await d.execute(
        `INSERT OR REPLACE INTO episodes_meta (title_id, season, episode, name, overview, still, air_date, runtime, rating)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8)`,
        [t.id, sn, e.episode_number, e.name ?? null, e.overview || null, e.air_date ?? null, e.runtime ?? null, e.vote_average || null],
      );
      if (e.still_path) stills.push({ season: sn, episode: e.episode_number, path: e.still_path });
    }
    report(`Season ${sn} of ${name}`);
  }

  const mapping = mapEpisodes(
    fileRows.map((f) => ({ id: f.id, season: f.season, episode: f.episode, title: f.episode_title })),
    tmdbSeasons,
  );
  for (const [fileId, target] of mapping) {
    await d.execute("UPDATE files SET meta_season = $1, meta_episode = $2 WHERE id = $3", [target.season, target.episode, fileId]);
  }

  // Only download stills for episodes the library actually has.
  const wanted = new Set([...mapping.values()].map((v) => `${v.season}x${v.episode}`));
  const needed = stills.filter((s) => wanted.has(`${s.season}x${s.episode}`));
  let done = 0;
  await pool(needed, 8, async (s) => {
    const local = await cacheImage(s.path, "w300");
    if (local)
      await d.execute("UPDATE episodes_meta SET still = $1 WHERE title_id = $2 AND season = $3 AND episode = $4", [
        local, t.id, s.season, s.episode,
      ]);
    if (++done % 10 === 0) report(`Episode images for ${name} (${done}/${needed.length})`);
  });
}

/**
 * Recompute file→episode mapping from the TMDB episode lists already stored,
 * without the network. Returns ids of titles that now point at episodes whose
 * stills were never downloaded.
 */
async function remapStored(): Promise<number[]> {
  const d = await db();
  const titles = await d.select<{ id: number }[]>("SELECT id FROM titles WHERE tmdb_type = 'tv' AND tmdb_id IS NOT NULL");
  const needStills: number[] = [];
  for (const { id } of titles) {
    const eps = await d.select<{ season: number; episode: number; name: string | null }[]>(
      "SELECT season, episode, name FROM episodes_meta WHERE title_id = $1",
      [id],
    );
    const seasons = new Map<number, TmdbEpisode[]>();
    for (const e of eps) seasons.set(e.season, [...(seasons.get(e.season) ?? []), { episode_number: e.episode, name: e.name ?? "" }]);
    const files = await d.select<{ id: number; season: number; episode: number; episode_title: string | null }[]>(
      "SELECT id, season, episode, episode_title FROM files WHERE title_id = $1 AND role = 'episode'",
      [id],
    );
    const mapping = mapEpisodes(
      files.map((f) => ({ id: f.id, season: f.season, episode: f.episode, title: f.episode_title })),
      seasons,
    );
    for (const [fileId, t] of mapping)
      await d.execute("UPDATE files SET meta_season = $1, meta_episode = $2 WHERE id = $3", [t.season, t.episode, fileId]);
    const [missing] = await d.select<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM files f JOIN episodes_meta em
         ON em.title_id = f.title_id AND em.season = f.meta_season AND em.episode = f.meta_episode
       WHERE f.title_id = $1 AND em.still IS NULL`,
      [id],
    );
    if (missing.n > 0) needStills.push(id);
  }
  return needStills;
}

/**
 * Match titles to TMDB and cache their artwork. By default only titles that
 * have never been matched; pass `titleIds` with `force` to redo specific ones.
 */
export async function refreshMetadata(
  onProgress: (p: MetaProgress) => void,
  opts: { titleIds?: number[]; force?: boolean } = {},
): Promise<{ matched: number; updated: string[]; unmatched: string[]; skipped: boolean; errors: string[] }> {
  const d = await db();
  const key = await getSetting("tmdb_key");
  const result = { matched: 0, updated: [] as string[], unmatched: [] as string[], skipped: !key, errors: [] as string[] };

  // Mapping rules changed since the stored mappings were made: redo them offline.
  let needStills: number[] = [];
  if ((await getSetting("mapping_version")) !== MAPPING_VERSION) {
    onProgress({ label: "Updating episode matches", done: 0, total: 0 });
    needStills = await remapStored();
    await setSetting("mapping_version", MAPPING_VERSION);
  }

  if (key) {
    let titles = await d.select<TitleForMeta[]>(
      "SELECT id, key, kind, name, year, tmdb_id, tmdb_type, match_state FROM titles ORDER BY name",
    );
    // Matched shows that gained episodes since (e.g. a new season folder) need mapping too.
    const gained = new Set(
      (
        await d.select<{ title_id: number }[]>(
          `SELECT DISTINCT f.title_id FROM files f JOIN titles t ON t.id = f.title_id
           WHERE t.tmdb_type = 'tv' AND f.role = 'episode' AND f.meta_season IS NULL`,
        )
      ).map((r) => r.title_id),
    );
    titles = opts.titleIds
      ? titles.filter((t) => opts.titleIds!.includes(t.id))
      : titles.filter((t) => t.match_state === "pending" || gained.has(t.id) || needStills.includes(t.id));
    for (const [i, t] of titles.entries()) {
      const report = (current: string) => onProgress({ label: "Matching with TMDB", done: i, total: titles.length, current });
      report(t.name);
      try {
        const m = opts.force || !t.tmdb_id ? await findMatch(t) : { type: t.tmdb_type as "tv" | "movie", id: t.tmdb_id, confidence: 1 };
        if (!m) {
          await d.execute("UPDATE titles SET match_state = 'none', match_confidence = 0 WHERE id = $1", [t.id]);
          result.unmatched.push(t.name);
          continue;
        }
        const [ov] = await d.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM match_overrides WHERE key = $1", [t.key]);
        await applyMatch(t, m, ov.n ? "confirmed" : "auto", report);
        if (t.match_state === "pending" || opts.force) result.matched++;
        else result.updated.push(t.name);
      } catch (e) {
        if (e instanceof NoTmdbKey) break;
        result.errors.push(`${t.name}: ${e}`);
      }
    }
  }
  await generateThumbnails(onProgress);
  await regrabDarkThumbnails(onProgress);
  return result;
}

/** Frame grabs for files without a TMDB still (all of them when offline / unmatched). */
export async function generateThumbnails(onProgress: (p: MetaProgress) => void): Promise<number> {
  const d = await db();
  const rows = await d.select<{ id: number; path: string; fingerprint: string; duration: number | null; rel: string }[]>(`
    SELECT f.id, f.path, f.fingerprint, f.duration, f.rel
    FROM files f
    JOIN titles t ON t.id = f.title_id
    LEFT JOIN episodes_meta em
      ON em.title_id = f.title_id AND em.season = f.meta_season AND em.episode = f.meta_episode
    WHERE f.thumb IS NULL AND f.fingerprint IS NOT NULL AND f.probe_error IS NULL
      AND em.still IS NULL
      AND NOT (f.role = 'movie' AND t.backdrop IS NOT NULL)`);
  let done = 0;
  await pool(rows, 4, async (r) => {
    // A fifth of the way in avoids cold opens, logos and black frames.
    const at = r.duration ? Math.min(r.duration * 0.2, 600) : 60;
    try {
      const thumb = await invoke<string>("grab_frame", { path: r.path, at, fingerprint: r.fingerprint });
      await d.execute("UPDATE files SET thumb = $1 WHERE id = $2", [thumb, r.id]);
    } catch (e) {
      console.warn("grab_frame", r.rel, e);
    }
    onProgress({ label: "Making thumbnails", done: ++done, total: rows.length, current: r.rel });
  });
  return rows.length;
}

/** Bump when the frame-grab method improves, to re-check existing thumbnails once. */
const THUMBS_VERSION = "2";
/** A 480px JPEG under this size is almost certainly a black or near-black frame. */
const DARK_BYTES = 9000;

/** Re-grab thumbnails that came out black, using the better frame picker and a later point. */
export async function regrabDarkThumbnails(onProgress: (p: MetaProgress) => void): Promise<number> {
  if ((await getSetting("thumbs_version")) === THUMBS_VERSION) return 0;
  const d = await db();
  const rows = await d.select<{ id: number; path: string; fingerprint: string; duration: number | null; thumb: string }[]>(
    "SELECT id, path, fingerprint, duration, thumb FROM files WHERE thumb IS NOT NULL AND probe_error IS NULL",
  );
  const dark = new Set(await invoke<string[]>("small_images", { paths: rows.map((r) => r.thumb), maxBytes: DARK_BYTES }));
  const todo = rows.filter((r) => dark.has(r.thumb));
  let done = 0;
  await pool(todo, 4, async (r) => {
    const at = r.duration ? r.duration * 0.35 : 120;
    try {
      const thumb = await invoke<string>("grab_frame", { path: r.path, at, fingerprint: r.fingerprint, force: true });
      await d.execute("UPDATE files SET thumb = $1 WHERE id = $2", [thumb, r.id]);
    } catch (e) {
      console.warn("regrab", r.path, e);
    }
    onProgress({ label: "Improving thumbnails", done: ++done, total: todo.length });
  });
  await setSetting("thumbs_version", THUMBS_VERSION);
  return todo.length;
}

/** Pin a title to a TMDB entry chosen by hand, or to "no match" (id null). */
export async function setMatch(titleId: number, choice: { type: "tv" | "movie"; id: number } | null) {
  const d = await db();
  const [t] = await d.select<{ key: string }[]>("SELECT key FROM titles WHERE id = $1", [titleId]);
  if (!t) return;
  if (choice) {
    await d.execute("INSERT OR REPLACE INTO match_overrides (key, tmdb_type, tmdb_id) VALUES ($1, $2, $3)", [
      t.key, choice.type, choice.id,
    ]);
  } else {
    await d.execute("DELETE FROM match_overrides WHERE key = $1", [t.key]);
    await d.execute("DELETE FROM episodes_meta WHERE title_id = $1", [titleId]);
    await d.execute("DELETE FROM seasons_meta WHERE title_id = $1", [titleId]);
    await d.execute(
      `UPDATE titles SET tmdb_id = NULL, tmdb_type = NULL, match_state = 'none', match_confidence = 0,
         tmdb_name = NULL, tmdb_year = NULL, overview = NULL, tagline = NULL, genres = NULL, rating = NULL,
         poster = NULL, backdrop = NULL, logo = NULL WHERE id = $1`,
      [titleId],
    );
    await d.execute("UPDATE files SET meta_season = NULL, meta_episode = NULL WHERE title_id = $1", [titleId]);
  }
}
