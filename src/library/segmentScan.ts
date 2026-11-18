// Skip intro: the background analysis. One season at a time, one ffmpeg
// process at a time, paused while a library job runs or the player is open
// (except for the season being watched), resumable because every analysed
// episode is recorded in `segment_scans`.
//
// An episode is analysed once. New episodes are analysed when they appear (or
// with Analyze now); episodes analysed before are only used, from their cached
// fingerprints, to compare the new ones against, and their markers are left
// alone. Everything is analysed again only after Clear all markers (or Find
// intro again for one show).
import { invoke } from "@tauri-apps/api/core";
import { db } from "./db";
import { jobBusy, setBackground, type Progress } from "./jobs";
import { getPrefs, loadPrefs } from "../player/mpv";
import { audioSpan, classifyChapters, fadeWindow, normaliseChapters, regionOf, withFade, type Kind, type Span } from "./segmentRules";
import { deleteMarker, saveMarker, segmentsChanged } from "./segments";
import { displayName } from "./present";

/**
 * Recorded with each analysed episode (2: intros end at their fade; 3:
 * whole-season comparison). Raising it does not re-analyse anything; only
 * Clear all markers or Find intro again do.
 */
export const ANALYSIS_VERSION = 3;

type Season = { titleId: number; season: number; name: string; n: number };
type Ep = { path: string; fingerprint: string; duration: number; chapters: number | null };
type Found = { start: number; end: number; agreeing: number; compared: number };
type Gate = "go" | "yield" | "stop";
type Outcome = Gate | "done" | "missing";

let running = false;
let pruned = false;
/** Fingerprint of the file in the player, if it is open. */
let playing: string | null = null;
/** The season being watched, analysed first and even while the player is open. */
let priority: { titleId: number; season: number } | null = null;
/** Seasons whose files weren't reachable this session (drive unplugged): not retried until restart. */
const unreachable = new Set<string>();
/** Progress shown in the top bar, restored after a pause. */
let lastReport: Progress | null = null;

/** Measurements for PLAN.md, readable from the dev console as __offplayer.segmentStats. */
export const segmentStats = { fingerprints: 0, cached: 0, totalMs: 0, maxMs: 0, matchMs: 0, fadeMs: 0, seasons: 0, errors: 0 };

const key = (s: { titleId: number; season: number }) => `${s.titleId}:${s.season}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Start the analysis if it isn't running. Safe to call any number of times. */
export function kickSegments() {
  if (running) return;
  running = true;
  run()
    .catch((e) => console.warn("segments", e))
    .finally(() => {
      running = false;
      setBackground(null);
    });
}

/** The player opened a file: its season (if not done yet) jumps the queue. */
export async function segmentsPlayerOpened(fingerprint: string | null | undefined) {
  playing = fingerprint ?? "?";
  if (!fingerprint) return;
  const d = await db();
  const [row] = await d.select<{ title_id: number; season: number }[]>(
    `SELECT f.title_id, f.season FROM files f JOIN titles t ON t.id = f.title_id
     WHERE f.fingerprint = $1 AND f.role = 'episode' AND f.season > 0 AND t.kind = 'show' LIMIT 1`,
    [fingerprint],
  );
  if (!row || playing !== fingerprint) return;
  const todo = await seasonsToDo();
  if (todo.some((s) => s.titleId === row.title_id && s.season === row.season)) {
    priority = { titleId: row.title_id, season: row.season };
    kickSegments();
  }
}

export function segmentsPlayerClosed() {
  playing = null;
  priority = null;
}

/** Seasons with episodes never analysed, in name order. `n` counts those new episodes. */
async function seasonsToDo(): Promise<Season[]> {
  const rows = await (await db()).select<{ title_id: number; season: number; name: string; tmdb_name: string | null; n: number }[]>(
    `SELECT f.title_id, f.season, t.name, t.tmdb_name, COUNT(DISTINCT f.fingerprint) AS n
     FROM files f JOIN titles t ON t.id = f.title_id
     WHERE t.kind = 'show' AND f.role = 'episode' AND f.season > 0
       AND f.fingerprint IS NOT NULL AND f.duration > 0
       AND NOT EXISTS (SELECT 1 FROM segment_scans s WHERE s.fingerprint = f.fingerprint)
     GROUP BY f.title_id, f.season
     ORDER BY COALESCE(t.tmdb_name, t.name) COLLATE NOCASE, f.season`,
  );
  return rows
    .map((r) => ({ titleId: r.title_id, season: r.season, name: displayName({ name: r.name, tmdb_name: r.tmdb_name }), n: r.n }))
    .filter((s) => !unreachable.has(key(s)));
}

async function run() {
  await loadPrefs();
  if (!getPrefs().detectSegments) return;
  if (!pruned) {
    pruned = true;
    const keep = await (await db()).select<{ fingerprint: string }[]>("SELECT DISTINCT fingerprint FROM files WHERE fingerprint IS NOT NULL");
    invoke<number>("segment_cache_prune", { keep: keep.map((k) => k.fingerprint) }).catch((e) => console.warn("prune", e));
  }
  for (;;) {
    if (!getPrefs().detectSegments) return;
    const todo = await seasonsToDo();
    if (!todo.length) return;
    const wanted = priority && todo.find((s) => s.titleId === priority!.titleId && s.season === priority!.season);
    if (priority && !wanted) priority = null; // already done
    const s = wanted || todo[0];
    const left = todo.length;
    const outcome = await analyseSeason(s, (done, total) => {
      lastReport = { label: "Finding intros", done, total, current: `${s.name} S${s.season}${left > 1 ? ` · ${left - 1} more season${left > 2 ? "s" : ""}` : ""}` };
      setBackground(lastReport);
    });
    if (outcome === "stop") return;
    if (outcome === "missing") unreachable.add(key(s));
    if (outcome === "done") {
      segmentStats.seasons++;
      if (priority && key(priority) === key(s)) priority = null;
    }
    segmentsChanged();
  }
}

/** Wait until this season may use the disk: no job running, and the player closed unless this is the season being watched. */
async function gate(s: Season): Promise<Gate> {
  let waited = false;
  for (;;) {
    if (!getPrefs().detectSegments) return "stop";
    const mine = !!priority && key(priority) === key(s);
    if (priority && !mine) return "yield";
    if (!jobBusy() && (playing === null || mine)) {
      if (waited) setBackground(lastReport);
      return "go";
    }
    if (!waited) {
      waited = true;
      setBackground(null);
    }
    await sleep(1000);
  }
}

async function analyseSeason(s: Season, report: (done: number, total: number) => void): Promise<Outcome> {
  const d = await db();
  const rows = await d.select<Ep[]>(
    `SELECT path, fingerprint, duration, chapters FROM files
     WHERE title_id = $1 AND season = $2 AND role = 'episode' AND fingerprint IS NOT NULL AND duration > 0
     ORDER BY episode, rel`,
    [s.titleId, s.season],
  );
  const seen = new Set<string>();
  const eps = rows.filter((e) => !seen.has(e.fingerprint) && seen.add(e.fingerprint));
  const scanned = new Set(
    (
      await d.select<{ fingerprint: string }[]>(
        `SELECT s.fingerprint FROM segment_scans s JOIN files f ON f.fingerprint = s.fingerprint
         WHERE f.title_id = $1 AND f.season = $2 AND f.role = 'episode'`,
        [s.titleId, s.season],
      )
    ).map((r) => r.fingerprint),
  );
  const fresh = eps.filter((e) => !scanned.has(e.fingerprint));
  if (!fresh.length) return "done";
  const isNew = (e: Ep) => !scanned.has(e.fingerprint);

  // 1. Chapters (new episodes only): named intros and credits need no audio work; boundaries help snap edges.
  const starts = new Map<string, number[]>();
  const fromChapters = new Map<string, Record<Kind, Span | null>>();
  for (const ep of fresh) {
    if (!ep.chapters) continue;
    const g = await gate(s);
    if (g !== "go") return g;
    let list: { title: string | null; start: number; end: number }[] = [];
    try {
      list = await invoke("media_chapters", { path: ep.path });
    } catch (e) {
      if (String(e).startsWith("MISSING")) return "missing";
    }
    const chapters = normaliseChapters(list, ep.duration);
    starts.set(ep.fingerprint, chapters.map((c) => c.start).filter((t) => t > 0));
    const found = classifyChapters(chapters, ep.duration);
    fromChapters.set(ep.fingerprint, found);
    for (const kind of ["intro", "credits"] as Kind[]) {
      if (found[kind]) await saveMarker(ep.fingerprint, kind, "chapter", found[kind]);
      else await deleteMarker(ep.fingerprint, kind, "chapter");
    }
  }

  // 2. Audio: fingerprint the new episodes' regions, then compare them with the whole season.
  const errors = new Map<string, string>();
  const total = fresh.length * 2; // one fingerprint per new episode for each of intro and credits
  let done = 0;
  report(0, total);
  const fingerprint = async (ep: Ep, kind: Kind, cachedOnly: boolean): Promise<"ok" | "skip" | "missing"> => {
    const r = regionOf(kind, ep.duration);
    try {
      const m = await invoke<{ items: number; cached: boolean; ms: number }>("segment_fingerprint", {
        path: ep.path,
        fingerprint: ep.fingerprint,
        region: kind,
        start: r.start,
        length: r.length,
        cachedOnly,
      });
      if (m.cached) segmentStats.cached++;
      else {
        segmentStats.fingerprints++;
        segmentStats.totalMs += m.ms;
        segmentStats.maxMs = Math.max(segmentStats.maxMs, m.ms);
      }
      return "ok";
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("MISSING")) return "missing";
      if (msg.startsWith("NOT_CACHED")) return "skip";
      errors.set(ep.fingerprint, msg.slice(0, 300));
      segmentStats.errors++;
      return "skip";
    }
  };
  for (const kind of ["intro", "credits"] as Kind[]) {
    const covered = fresh.every((ep) => fromChapters.get(ep.fingerprint)?.[kind]);
    if (covered) report((done += fresh.length), total);
    if (!covered) {
      for (const ep of fresh) {
        const g = await gate(s);
        if (g !== "go") return g;
        if ((await fingerprint(ep, kind, false)) === "missing") return "missing";
        report(++done, total);
      }
      // Episodes analysed before are compared only from their cached fingerprints, unless
      // too few are cached to compare with (cache cleared): then the nearest are read again.
      const old = eps.filter((e) => !isNew(e));
      const usable: Ep[] = [];
      for (const ep of old) if ((await fingerprint(ep, kind, true)) === "ok") usable.push(ep);
      if (old.length && usable.length + fresh.length < 3) {
        for (const ep of old.filter((e) => !usable.includes(e)).slice(0, 4)) {
          const g = await gate(s);
          if (g !== "go") return g;
          if ((await fingerprint(ep, kind, false)) === "missing") return "missing";
        }
      }
      const t0 = performance.now();
      const found = await invoke<(Found | null)[]>("segment_match", { region: kind, fingerprints: eps.map((e) => e.fingerprint) });
      segmentStats.matchMs += performance.now() - t0;
      for (const [i, ep] of eps.entries()) {
        if (!isNew(ep)) continue; // markers of episodes analysed before stay as they are
        const f = found[i];
        let span = f ? audioSpan(kind, f, ep.duration, starts.get(ep.fingerprint) ?? []) : null;
        if (span && kind === "intro") {
          // The title sequence can outlast its music by a few seconds: end it at the fade.
          const g = await gate(s);
          if (g !== "go") return g;
          const w = fadeWindow(span);
          const t0 = performance.now();
          try {
            span = withFade(span, await invoke<number | null>("segment_intro_tail", { path: ep.path, start: w.start, length: w.length }));
          } catch (e) {
            if (String(e).startsWith("MISSING")) return "missing";
          }
          segmentStats.fadeMs += performance.now() - t0;
        }
        if (span && f) await saveMarker(ep.fingerprint, kind, "audio", span, Math.round((f.agreeing / Math.max(1, f.compared)) * 100) / 100);
        else await deleteMarker(ep.fingerprint, kind, "audio");
      }
    } else {
      for (const ep of fresh) await deleteMarker(ep.fingerprint, kind, "audio");
    }
  }

  // 3. Record the work, including "nothing found" and failures.
  const now = Date.now();
  for (const ep of fresh) {
    await d.execute("INSERT OR REPLACE INTO segment_scans (fingerprint, version, scanned_at, error) VALUES ($1, $2, $3, $4)", [
      ep.fingerprint,
      ANALYSIS_VERSION,
      now,
      errors.get(ep.fingerprint) ?? null,
    ]);
  }
  return "done";
}

// ---------------------------------------------------------------------------
// Settings and title-page actions

export type SegmentStatus = { episodes: number; analysed: number; intros: number; credits: number; failed: number };

export async function segmentStatus(): Promise<SegmentStatus> {
  const d = await db();
  const eps = await d.select<{ fingerprint: string; analysed: number; failed: number }[]>(
    `SELECT f.fingerprint,
            MAX(s.fingerprint IS NOT NULL) AS analysed,
            MAX(s.error IS NOT NULL) AS failed
     FROM files f JOIN titles t ON t.id = f.title_id
     LEFT JOIN segment_scans s ON s.fingerprint = f.fingerprint
     WHERE t.kind = 'show' AND f.role = 'episode' AND f.season > 0 AND f.fingerprint IS NOT NULL AND f.duration > 0
     GROUP BY f.fingerprint`,
  );
  const rows = await d.select<{ fingerprint: string; kind: Kind; start_s: number | null; source: string }[]>(
    "SELECT fingerprint, kind, start_s, source FROM segments",
  );
  const PRI: Record<string, number> = { manual: 0, chapter: 1, audio: 2 };
  const best = new Map<string, { pri: number; has: boolean }>();
  for (const r of rows) {
    const k = `${r.fingerprint}|${r.kind}`;
    const cur = best.get(k);
    if (!cur || PRI[r.source] < cur.pri) best.set(k, { pri: PRI[r.source], has: r.start_s !== null });
  }
  const has = (fp: string, kind: Kind) => !!best.get(`${fp}|${kind}`)?.has;
  return {
    episodes: eps.length,
    analysed: eps.filter((e) => e.analysed).length,
    intros: eps.filter((e) => has(e.fingerprint, "intro")).length,
    credits: eps.filter((e) => has(e.fingerprint, "credits")).length,
    failed: eps.filter((e) => e.failed).length,
  };
}

/** Analyse one show again (manual markers stay). */
export async function reanalyseTitle(titleId: number) {
  await (await db()).execute(
    "DELETE FROM segment_scans WHERE fingerprint IN (SELECT fingerprint FROM files WHERE title_id = $1 AND fingerprint IS NOT NULL)",
    [titleId],
  );
  unreachable.clear();
  kickSegments();
}

/** Forget every found intro and credits (and, if asked, the user's own markers). They are found again while finding is on. */
export async function clearAllMarkers(includeManual: boolean) {
  const d = await db();
  await d.execute(includeManual ? "DELETE FROM segments" : "DELETE FROM segments WHERE source <> 'manual'");
  await d.execute("DELETE FROM segment_scans");
  segmentsChanged();
}

/** Analyze now: episodes never analysed, plus files that failed or weren't reachable. Never the rest. */
export async function analyseNow() {
  await (await db()).execute("DELETE FROM segment_scans WHERE error IS NOT NULL");
  unreachable.clear();
  kickSegments();
}
