import Database from "@tauri-apps/plugin-sql";

// Same URL as DB_URL in src-tauri/src/lib.rs, where migrations are registered.
const DB_URL = "sqlite:offplayer.db";

let handle: Promise<Database> | null = null;
export const db = () => (handle ??= Database.load(DB_URL));

export type Library = { id: number; path: string; added_at: number; last_scan: number | null };

export type TitleRow = {
  id: number;
  key: string;
  kind: "show" | "movie";
  name: string;
  year: number | null;
  tmdb_id: number | null;
  tmdb_type: "tv" | "movie" | null;
  match_state: "pending" | "auto" | "confirmed" | "none";
  match_confidence: number | null;
  tmdb_name: string | null;
  tmdb_year: number | null;
  overview: string | null;
  tagline: string | null;
  genres: string | null; // JSON
  rating: number | null;
  poster: string | null;
  backdrop: string | null;
  logo: string | null;
  cover_thumb: string | null; // frame grab of the first episode, for unmatched titles
  last_added: number;
  episodes: number;
  seasons: number;
  extras: number;
  unknown: number;
  probe_errors: number;
  bytes: number;
  runtime: number | null;
  mains: number; // episodes, or the movie file(s)
  watched_mains: number; // of those, marked watched
  orig_lang?: string | null; // filled after 2.0's first launch
  collection_id?: number | null; // TMDB movie collection
};

export type FileRow = {
  id: number;
  title_id: number;
  path: string;
  rel: string;
  size: number;
  fingerprint: string | null;
  role: "episode" | "movie" | "extra" | "unknown";
  season: number | null;
  episode: number | null;
  episode_end: number | null;
  episode_title: string | null;
  extra_group: string | null;
  duration: number | null;
  video_codec: string | null;
  width: number | null;
  height: number | null;
  bit_depth: number | null;
  audio: string | null; // JSON
  subs: string | null; // JSON
  sidecar_subs: string | null; // JSON
  chapters: number | null;
  probe_error: string | null;
  meta_season: number | null;
  meta_episode: number | null;
  thumb: string | null;
  meta_name: string | null;
  meta_overview: string | null;
  meta_still: string | null;
  meta_air: string | null;
  // watch state (from the playback table, by fingerprint)
  pb_position: number | null;
  pb_watched: number | null;
  pb_last: number | null;
};

export type AudioStream = { codec: string | null; channels: number | null; lang: string | null; title: string | null; default: boolean };
export type SubStream = { codec: string | null; lang: string | null; title: string | null; forced: boolean };
export type Sidecar = { path: string; lang: string | null };

export const parseJson = <T,>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export async function listLibraries(): Promise<Library[]> {
  return (await db()).select<Library[]>("SELECT * FROM libraries ORDER BY path");
}

export async function addLibrary(path: string): Promise<Library> {
  const d = await db();
  await d.execute("INSERT OR IGNORE INTO libraries (path, added_at) VALUES ($1, $2)", [path, Date.now()]);
  const [row] = await d.select<Library[]>("SELECT * FROM libraries WHERE path = $1", [path]);
  return row;
}

export async function removeLibrary(id: number) {
  const d = await db();
  await d.execute("DELETE FROM files WHERE library_id = $1", [id]);
  await d.execute("DELETE FROM libraries WHERE id = $1", [id]);
  await pruneTitles();
}

export async function pruneTitles() {
  await (await db()).execute(
    "DELETE FROM titles WHERE id NOT IN (SELECT DISTINCT title_id FROM files WHERE title_id IS NOT NULL)",
  );
}

export async function listTitles(): Promise<TitleRow[]> {
  return (await db()).select<TitleRow[]>(`
    SELECT t.*,
      (SELECT thumb FROM files x WHERE x.title_id = t.id AND x.thumb IS NOT NULL
         ORDER BY x.role <> 'episode', x.season = 0, x.season, x.episode LIMIT 1) AS cover_thumb,
      SUM(f.role = 'episode') AS episodes,
      COUNT(DISTINCT CASE WHEN f.role = 'episode' THEN f.season END) AS seasons,
      SUM(f.role = 'extra') AS extras,
      SUM(f.role = 'unknown') AS unknown,
      SUM(f.probe_error IS NOT NULL) AS probe_errors,
      SUM(f.size) AS bytes,
      MAX(CASE WHEN f.role = 'movie' THEN f.duration END) AS runtime,
      MAX(f.added_at) AS last_added,
      SUM(f.role IN ('episode', 'movie')) AS mains,
      SUM(f.role IN ('episode', 'movie') AND p.watched = 1) AS watched_mains
    FROM titles t JOIN files f ON f.title_id = t.id
    LEFT JOIN playback p ON p.fingerprint = f.fingerprint
    GROUP BY t.id
    ORDER BY COALESCE(t.tmdb_name, t.name) COLLATE NOCASE`);
}

export async function titleFiles(titleId: number): Promise<FileRow[]> {
  return (await db()).select<FileRow[]>(
    `SELECT f.*, em.name AS meta_name, em.overview AS meta_overview, em.still AS meta_still, em.air_date AS meta_air,
            p.position AS pb_position, p.watched AS pb_watched, p.last_played AS pb_last
     FROM files f
     LEFT JOIN episodes_meta em
       ON em.title_id = f.title_id AND em.season = f.meta_season AND em.episode = f.meta_episode
     LEFT JOIN playback p ON p.fingerprint = f.fingerprint
     WHERE f.title_id = $1
     ORDER BY f.role = 'extra', f.role = 'unknown', f.season, f.episode, f.rel`,
    [titleId],
  );
}

export async function getTitle(id: number): Promise<TitleRow | undefined> {
  return (await listTitles()).find((t) => t.id === id);
}

export type EpisodeRow = FileRow & { meta_rating: number | null };

const EPISODE_SELECT = `
  SELECT f.*, em.name AS meta_name, em.overview AS meta_overview, em.still AS meta_still,
         em.air_date AS meta_air, em.rating AS meta_rating,
         p.position AS pb_position, p.watched AS pb_watched, p.last_played AS pb_last
  FROM files f
  LEFT JOIN episodes_meta em
    ON em.title_id = f.title_id AND em.season = f.meta_season AND em.episode = f.meta_episode
  LEFT JOIN playback p ON p.fingerprint = f.fingerprint`;

/** Every episode in the library, for search. */
export async function allEpisodes(): Promise<EpisodeRow[]> {
  return (await db()).select<EpisodeRow[]>(`${EPISODE_SELECT} WHERE f.role = 'episode' ORDER BY f.title_id, f.season, f.episode`);
}

/** Highest-rated episodes (by TMDB), a few per show, interleaved so one show doesn't fill the row. */
export async function topEpisodes(perTitle = 6, limit = 24): Promise<EpisodeRow[]> {
  const rows = await (await db()).select<EpisodeRow[]>(
    `${EPISODE_SELECT}
     WHERE f.role = 'episode' AND em.rating IS NOT NULL AND em.rating > 0 AND f.season > 0
     ORDER BY em.rating DESC`,
  );
  const byTitle = new Map<number, EpisodeRow[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    const k = `${r.title_id}:${r.meta_season}x${r.meta_episode}`;
    if (seen.has(k)) continue; // both halves of a merged two-parter
    seen.add(k);
    const list = byTitle.get(r.title_id) ?? [];
    if (list.length < perTitle) byTitle.set(r.title_id, [...list, r]);
  }
  const lists = [...byTitle.values()];
  const out: EpisodeRow[] = [];
  for (let i = 0; i < perTitle; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out.slice(0, limit);
}

export type SeasonRow = {
  title_id: number;
  season: number;
  name: string | null;
  overview: string | null;
  poster: string | null;
  air_date: string | null;
  episode_count: number | null;
  owned: number; // episode files in the library for this season
};

/** Seasons present in the library, with TMDB season info where matched. */
export async function listSeasons(titleId?: number): Promise<SeasonRow[]> {
  return (await db()).select<SeasonRow[]>(
    `SELECT f.title_id, f.season, sm.name, sm.overview, sm.poster, sm.air_date, sm.episode_count,
            COUNT(*) AS owned
     FROM files f
     LEFT JOIN seasons_meta sm ON sm.title_id = f.title_id AND sm.season = f.season
     WHERE f.role = 'episode' ${titleId ? "AND f.title_id = $1" : ""}
     GROUP BY f.title_id, f.season
     ORDER BY f.title_id, f.season`,
    titleId ? [titleId] : [],
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await (await db()).select<{ value: string | null }[]>("SELECT value FROM settings WHERE key = $1", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null) {
  const d = await db();
  if (value === null) await d.execute("DELETE FROM settings WHERE key = $1", [key]);
  else await d.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)", [key, value]);
}
