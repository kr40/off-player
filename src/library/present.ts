// Display helpers shared by every page: names, episode labels, tech badges and
// the item handed to the player.
import { parseJson, type AudioStream, type FileRow, type Sidecar, type SubStream, type TitleRow } from "./db";
import { audioCodec, channels, fmtRuntime, resolution, videoCodec } from "../lib/format";
import type { PlayItem } from "../components/Player";
import { RESUME_REWIND } from "./progress";

export const displayName = (t: Pick<TitleRow, "tmdb_name" | "name">) => t.tmdb_name ?? t.name;
export const displayYear = (t: Pick<TitleRow, "tmdb_year" | "year">) => t.tmdb_year ?? t.year;
export const genresOf = (t: Pick<TitleRow, "genres">) => parseJson<string[]>(t.genres, []);

/** TMDB's name, unless the file is a double episode or shares its TMDB entry with
 *  another file (a two-parter TMDB merged) — then the file's own "(1)/(2)" title. */
export const epName = (f: Pick<FileRow, "episode_end" | "episode_title" | "meta_name" | "episode">, shared = false) =>
  (f.episode_end || shared) && f.episode_title ? f.episode_title : f.meta_name || f.episode_title || `Episode ${f.episode}`;

export const epCode = (f: Pick<FileRow, "season" | "episode" | "episode_end">) =>
  `S${f.season} E${f.episode}${f.episode_end ? `–${f.episode_end}` : ""}`;

/** Files whose TMDB entry is used by more than one file. */
export function sharedChecker(files: FileRow[]) {
  const use = new Map<string, number>();
  for (const f of files)
    if (f.role === "episode" && f.meta_episode !== null) {
      const k = `${f.meta_season}x${f.meta_episode}`;
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  return (f: FileRow) => (use.get(`${f.meta_season}x${f.meta_episode}`) ?? 0) > 1;
}

export function playItem(t: TitleRow, f: FileRow, shared = false, opts: { fromStart?: boolean } = {}): PlayItem {
  const name = displayName(t);
  const resumeAt = !opts.fromStart && !f.pb_watched && f.pb_position ? Math.max(0, f.pb_position - RESUME_REWIND) : 0;
  return {
    fingerprint: f.fingerprint,
    titleKey: t.key,
    resumeAt,
    path: f.path,
    title:
      f.role === "episode" ? epName(f, shared)
      : f.role === "movie" ? name
      : f.episode_title || f.rel.split("/").pop()!,
    eyebrow:
      f.role === "episode" ? `${name} · ${epCode(f)}`
      : f.role === "movie" ? [displayYear(t), fmtRuntime(f.duration)].filter(Boolean).join(" · ")
      : `${name} · Extra`,
    subs: parseJson<Sidecar[]>(f.sidecar_subs, []),
    titleId: t.id,
    fileId: f.id,
  };
}

/** Episodes in watch order: season 1 onwards, specials last. */
export function watchOrder(files: FileRow[]): FileRow[] {
  return files
    .filter((f) => f.role === "episode")
    .sort((a, b) => ((a.season || 999) - (b.season || 999)) || (a.episode! - b.episode!) || a.rel.localeCompare(b.rel));
}

/** "1080p HEVC 10-bit", "Dolby Digital 5.1", "Subtitles" — most common across the title's main files. */
export function techSummary(files: FileRow[]): string[] {
  const mode = (xs: string[]) => {
    const c = new Map<string, number>();
    xs.filter(Boolean).forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };
  const main = files.filter((f) => f.role === "episode" || f.role === "movie");
  const video = mode(main.map((f) => [resolution(f.width, f.height), videoCodec(f.video_codec), f.bit_depth === 10 ? "10-bit" : ""].filter(Boolean).join(" ")));
  const audio = mode(main.map((f) => {
    const streams = parseJson<AudioStream[]>(f.audio, []);
    const a = streams.find((x) => x.default) ?? streams[0];
    return a ? `${audioCodec(a.codec)} ${channels(a.channels)}`.trim() : "";
  }));
  const withSubs = main.filter((f) => parseJson<Sidecar[]>(f.sidecar_subs, []).length || parseJson<SubStream[]>(f.subs, []).length).length;
  const subs = withSubs === main.length ? "Subtitles" : withSubs ? `Subtitles on ${withSubs}/${main.length}` : "";
  return [video, audio, subs].filter(Boolean);
}

/** The very first thing to play: S1 E1 (not specials), or the movie. */
export function firstEpisode(files: FileRow[]): FileRow | undefined {
  const eps = watchOrder(files);
  return eps[0] ?? files.find((f) => f.role === "movie");
}

/** Fraction watched for progress bars: 1 when watched, null when never started. */
export function progressOf(f: Pick<FileRow, "pb_watched" | "pb_position" | "duration">): number | null {
  if (f.pb_watched) return 1;
  if (f.pb_position && f.duration) return Math.min(1, f.pb_position / f.duration);
  return null;
}

export type UpNext = { file: FileRow; mode: "resume" | "next" | "start" };

/**
 * What Play should do for a title: resume the last thing played if unfinished,
 * otherwise the next unwatched episode after it, otherwise start from the top.
 * Returns undefined when everything after the last-played episode is watched.
 */
export function nextUp(files: FileRow[]): UpNext | undefined {
  const order = files.some((f) => f.role === "episode") ? watchOrder(files) : files.filter((f) => f.role === "movie");
  if (!order.length) return undefined;
  const played = order.filter((f) => f.pb_last).sort((a, b) => b.pb_last! - a.pb_last!);
  const last = played[0];
  if (!last) {
    const fresh = order.find((f) => !f.pb_watched);
    return fresh ? { file: fresh, mode: fresh === order[0] ? "start" : "next" } : undefined;
  }
  if (!last.pb_watched && (last.pb_position ?? 0) > 0) return { file: last, mode: "resume" };
  const after = order.slice(order.indexOf(last) + 1).find((f) => !f.pb_watched);
  return after ? { file: after, mode: "next" } : undefined;
}
