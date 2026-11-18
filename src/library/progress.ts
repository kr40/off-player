// Watch state: positions, watched flags, Continue Watching, per-show track choice.
// Everything is keyed by file fingerprint, so renaming or moving files keeps history.
import { db } from "./db";

/** At or past this fraction an episode counts as watched. */
export const WATCHED_AT = 0.92;
/** Below this fraction nothing is recorded (an accidental click shouldn't land in Continue Watching). */
export const MIN_PROGRESS = 0.02;
/** Resume this many seconds before the saved point. */
export const RESUME_REWIND = 5;

export type SaveResult = "ignored" | "progress" | "watched";

export function classify(position: number, duration: number): SaveResult {
  if (!(duration > 0) || !(position >= 0)) return "ignored";
  const f = position / duration;
  if (f >= WATCHED_AT) return "watched";
  if (f < MIN_PROGRESS) return "ignored";
  return "progress";
}

export async function savePosition(fingerprint: string | null | undefined, position: number, duration: number): Promise<SaveResult> {
  if (!fingerprint) return "ignored";
  const kind = classify(position, duration);
  if (kind === "ignored") return kind;
  const d = await db();
  const now = Date.now();
  if (kind === "watched") {
    // Watched episodes restart from the beginning if played again.
    await d.execute(
      `INSERT INTO playback (fingerprint, position, duration, watched, last_played, dismissed)
       VALUES ($1, 0, $2, 1, $3, 0)
       ON CONFLICT (fingerprint) DO UPDATE SET position = 0, duration = excluded.duration, watched = 1,
         last_played = excluded.last_played, dismissed = 0`,
      [fingerprint, duration, now],
    );
  } else {
    await d.execute(
      `INSERT INTO playback (fingerprint, position, duration, watched, last_played, dismissed)
       VALUES ($1, $2, $3, 0, $4, 0)
       ON CONFLICT (fingerprint) DO UPDATE SET position = excluded.position, duration = excluded.duration,
         last_played = excluded.last_played, dismissed = 0`,
      [fingerprint, position, duration, now],
    );
  }
  return kind;
}

/** Mark files watched or unwatched by hand. Doesn't touch "last played", so it doesn't reorder Continue Watching. */
export async function setWatched(fingerprints: (string | null)[], watched: boolean) {
  const d = await db();
  for (const fp of fingerprints) {
    if (!fp) continue;
    await d.execute(
      `INSERT INTO playback (fingerprint, position, watched) VALUES ($1, 0, $2)
       ON CONFLICT (fingerprint) DO UPDATE SET position = 0, watched = excluded.watched`,
      [fp, watched ? 1 : 0],
    );
  }
}

/**
 * Mark every episode (or the movie) of a library title watched or unwatched,
 * as the title page's menu does. Returns an undo that puts each file's
 * previous position and watched flag back.
 */
export async function markTitleWatched(titleId: number, watched: boolean): Promise<() => Promise<void>> {
  const d = await db();
  const before = await d.select<{ fingerprint: string; position: number | null; watched: number | null; had: number }[]>(
    `SELECT DISTINCT f.fingerprint, p.position, p.watched, p.fingerprint IS NOT NULL AS had
     FROM files f LEFT JOIN playback p ON p.fingerprint = f.fingerprint
     WHERE f.title_id = $1 AND f.role IN ('episode', 'movie') AND f.fingerprint IS NOT NULL`,
    [titleId],
  );
  await setWatched(before.map((b) => b.fingerprint), watched);
  return async () => {
    for (const b of before) {
      if (b.had) await d.execute("UPDATE playback SET position = $2, watched = $3 WHERE fingerprint = $1", [b.fingerprint, b.position ?? 0, b.watched ?? 0]);
      else await d.execute("DELETE FROM playback WHERE fingerprint = $1", [b.fingerprint]);
    }
  };
}

/** Remove a title from Continue Watching until something in it is played again. */
export async function dismissTitle(titleId: number) {
  await (await db()).execute(
    "UPDATE playback SET dismissed = 1 WHERE fingerprint IN (SELECT fingerprint FROM files WHERE title_id = $1)",
    [titleId],
  );
}

/** Titles with something played and not dismissed, most recent first. */
export async function recentTitleIds(limit = 20): Promise<number[]> {
  const rows = await (await db()).select<{ title_id: number }[]>(
    `SELECT f.title_id, MAX(p.last_played) AS lp
     FROM playback p JOIN files f ON f.fingerprint = p.fingerprint
     WHERE p.last_played IS NOT NULL AND p.dismissed = 0 AND f.role IN ('episode', 'movie')
     GROUP BY f.title_id ORDER BY lp DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.title_id);
}

// ---------------------------------------------------------------------------
// Per-show audio / subtitle choice

export type SubPref = { mode: "off" } | { mode: "on"; lang: string | null; external: boolean; title: string | null };
export type AudioPref = { lang: string | null; title: string | null };

export async function getTitlePrefs(key: string | undefined): Promise<{ audio: AudioPref | null; subs: SubPref | null }> {
  if (!key) return { audio: null, subs: null };
  const [row] = await (await db()).select<{ audio: string | null; subs: string | null }[]>(
    "SELECT audio, subs FROM title_prefs WHERE key = $1",
    [key],
  );
  const parse = <T,>(s: string | null | undefined): T | null => {
    try {
      return s ? (JSON.parse(s) as T) : null;
    } catch {
      return null;
    }
  };
  return { audio: parse<AudioPref>(row?.audio), subs: parse<SubPref>(row?.subs) };
}

export async function setTitlePref(key: string | undefined, kind: "audio" | "subs", value: AudioPref | SubPref) {
  if (!key) return;
  await (await db()).execute(
    `INSERT INTO title_prefs (key, ${kind}) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET ${kind} = excluded.${kind}`,
    [key, JSON.stringify(value)],
  );
}

type Track = { id: number; type: string; lang?: string; title?: string; external?: boolean };

// ISO 639-2 (bibliographic and terminology) → 639-1, for the languages that
// actually show up in media files. Anything else compares as written.
const ISO3: Record<string, string> = {
  eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", dut: "nl", nld: "nl",
  swe: "sv", nor: "no", nob: "no", dan: "da", fin: "fi", pol: "pl", rus: "ru", ukr: "uk", cze: "cs", ces: "cs",
  hun: "hu", rum: "ro", ron: "ro", gre: "el", ell: "el", tur: "tr", ara: "ar", heb: "he", hin: "hi", tam: "ta",
  tel: "te", ben: "bn", jpn: "ja", kor: "ko", chi: "zh", zho: "zh", tha: "th", vie: "vi", ind: "id", may: "ms",
  msa: "ms", per: "fa", fas: "fa",
};
export function normLang(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toLowerCase();
  if (!c || c === "und") return null;
  return ISO3[c] ?? (c.length > 2 ? c.slice(0, 2) : c);
}

/** Best track for a saved preference: same language, source and title, then looser. */
export function pickSub(tracks: Track[], pref: SubPref): number | "no" | null {
  if (pref.mode === "off") return "no";
  const subs = tracks.filter((t) => t.type === "sub");
  const lang = (t: Track) => normLang(t.lang);
  const want = normLang(pref.lang);
  const tiers = [
    (t: Track) => lang(t) === want && !!t.external === pref.external && (t.title ?? null) === pref.title,
    (t: Track) => lang(t) === want && !!t.external === pref.external,
    (t: Track) => lang(t) === want,
    (t: Track) => !!t.external === pref.external && want === null,
  ];
  for (const ok of tiers) {
    const hit = subs.find(ok);
    if (hit) return hit.id;
  }
  return null;
}

export function pickAudio(tracks: Track[], pref: AudioPref): number | null {
  const audio = tracks.filter((t) => t.type === "audio");
  if (audio.length < 2) return null;
  const want = normLang(pref.lang);
  if (want === null) return null;
  const hit =
    audio.find((t) => normLang(t.lang) === want && (t.title ?? null) === pref.title) ??
    audio.find((t) => normLang(t.lang) === want);
  return hit?.id ?? null;
}
