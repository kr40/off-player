// Pure matching logic for TMDB: choosing a search result for a title and
// mapping files to TMDB episodes by title when numbering disagrees.
import { titleKey } from "./parse";

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8" };
const STOP = new Set(["the", "a", "an", "and", "of", "part", "pt"]);

export function tokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // "Déjà" → "Deja", not "De ja"
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => ROMAN[t] ?? t)
    .filter((t) => !STOP.has(t));
}

/** 0..1. 1 when the names are the same ignoring punctuation and case. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  if (titleKey(a) === titleKey(b)) return 1;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => tb.has(t) && inter++);
  const dice = (2 * inter) / (ta.size + tb.size);
  const contain = inter / Math.min(ta.size, tb.size);
  return Math.min(0.99, Math.max(dice, contain * 0.9));
}

export type Candidate = {
  id: number;
  name?: string; // tv
  original_name?: string;
  title?: string; // movie
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  vote_count?: number;
  popularity?: number;
};

export const candidateName = (c: Candidate) => c.name ?? c.title ?? "";
export const candidateYear = (c: Candidate) => {
  const d = c.first_air_date || c.release_date;
  return d ? Number(d.slice(0, 4)) : null;
};

/** Pick the best search result. Returns null when nothing is a plausible match. */
export function pickBest(
  results: Candidate[],
  name: string,
  year: number | null,
): { candidate: Candidate; confidence: number } | null {
  let best: { candidate: Candidate; score: number; sim: number; yearOk: boolean } | null = null;
  for (const c of results.slice(0, 20)) {
    const sim = Math.max(
      similarity(name, candidateName(c)),
      similarity(name, c.original_name ?? c.original_title ?? ""),
    );
    const y = candidateYear(c);
    const diff = year !== null && y !== null ? Math.abs(y - year) : null;
    const yearScore = diff === null ? 0 : diff === 0 ? 30 : diff === 1 ? 15 : -15;
    const score = sim * 100 + yearScore + Math.log10(1 + (c.vote_count ?? 0)) * 4;
    if (!best || score > best.score) best = { candidate: c, score, sim, yearOk: diff === null || diff <= 1 };
  }
  if (!best || best.sim < 0.5) return null;
  const confidence =
    best.sim === 1 && best.yearOk ? 0.95 : best.sim >= 0.8 && best.yearOk ? 0.75 : Math.min(0.6, best.sim * 0.6);
  return { candidate: best.candidate, confidence };
}

export type FileForMapping = { id: number; season: number; episode: number; title: string | null };
export type TmdbEpisode = { episode_number: number; name: string };

/**
 * Similarity where words that appear in many of a season's episode names count
 * for little. Friends titles all start "The One With/Where…", so plain token
 * overlap would make unrelated episodes look alike.
 */
export function seasonSimilarity(seasonNames: string[]) {
  const n = seasonNames.length;
  const df = new Map<string, number>();
  for (const name of seasonNames) for (const t of new Set(tokens(name))) df.set(t, (df.get(t) ?? 0) + 1);
  const weight = (t: string) => Math.max(0, Math.log((n + 1) / ((df.get(t) ?? 0) + 0.5)));
  return (a: string, b: string): number => {
    if (titleKey(a) === titleKey(b)) return 1;
    const ta = new Set(tokens(a));
    const tb = new Set(tokens(b));
    let wa = 0, wb = 0, wi = 0;
    ta.forEach((t) => (wa += weight(t)));
    tb.forEach((t) => {
      const w = weight(t);
      wb += w;
      if (ta.has(t)) wi += w;
    });
    return wa + wb > 0 ? Math.min(0.99, (2 * wi) / (wa + wb)) : 0;
  };
}

/**
 * Which TMDB episode each file is. Numbers are trusted unless the file names an
 * episode title that clearly belongs to a different TMDB episode in the same
 * season (e.g. TMDB merging or splitting a two-parter, which shifts numbering).
 */
export function mapEpisodes(
  files: FileForMapping[],
  seasons: Map<number, TmdbEpisode[]>,
): Map<number, { season: number; episode: number }> {
  const out = new Map<number, { season: number; episode: number }>();
  const simFor = new Map<number, (a: string, b: string) => number>();
  for (const f of files) {
    const eps = seasons.get(f.season) ?? [];
    const same = eps.find((e) => e.episode_number === f.episode);
    let target = f.episode;
    if (f.title && eps.length) {
      let sim = simFor.get(f.season);
      if (!sim) simFor.set(f.season, (sim = seasonSimilarity(eps.map((e) => e.name))));
      const simSame = same ? sim(f.title, same.name) : 0;
      if (simSame < 0.5) {
        let bestEp: TmdbEpisode | null = null;
        let bestSim = 0;
        for (const e of eps) {
          const s = sim(f.title, e.name);
          if (s > bestSim) {
            bestSim = s;
            bestEp = e;
          }
        }
        if (bestEp && bestSim >= 0.6 && bestSim > simSame + 0.25) target = bestEp.episode_number;
      }
    }
    out.set(f.id, { season: f.season, episode: target });
  }
  return out;
}

/** Bump when mapEpisodes changes, so stored mappings are recomputed on start-up. */
export const MAPPING_VERSION = "2";
