import { invoke } from "@tauri-apps/api/core";
import { db, pruneTitles, type Library } from "./db";
import { planLibrary, type Entry } from "./parse";
import { pool } from "../lib/pool";

export type ScanProgress = {
  library: string;
  phase: "listing" | "probing" | "saving" | "done";
  done: number;
  total: number;
  current?: string;
};

export type ScanResult = {
  titles: number;
  files: number;
  probed: number;
  removed: number;
  skipped: number;
  probeErrors: number;
  warnings: string[];
};

type Inspection = {
  fingerprint: string;
  duration: number | null;
  video: { codec: string | null; width: number | null; height: number | null; bit_depth: number | null };
  audio: unknown[];
  subs: unknown[];
  chapters: number;
  error: string | null;
};

type Existing = { path: string; size: number; mtime: number; fingerprint: string | null };

const PROBE_CONCURRENCY = 6;

const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

export async function scanLibrary(lib: Library, onProgress: (p: ScanProgress) => void): Promise<ScanResult> {
  const started = Date.now();
  const report = (p: Omit<ScanProgress, "library">) => onProgress({ library: lib.path, ...p });

  report({ phase: "listing", done: 0, total: 0 });
  const entries = await invoke<Entry[]>("list_media", { root: lib.path });
  const plan = planLibrary(baseName(lib.path), entries);
  const d = await db();

  const existing = new Map(
    (
      await d.select<Existing[]>("SELECT path, size, mtime, fingerprint FROM files WHERE library_id = $1", [lib.id])
    ).map((r) => [r.path, r]),
  );

  const all = plan.titles.flatMap((t) => t.files.map((f) => ({ t, f })));
  const stale = all.filter(({ f }) => {
    const ex = existing.get(f.entry.path!);
    return !ex || ex.size !== f.entry.size || ex.mtime !== f.entry.mtime || !ex.fingerprint;
  });

  let done = 0;
  report({ phase: "probing", done, total: stale.length });
  const probed = new Map<string, Inspection>();
  await pool(stale, PROBE_CONCURRENCY, async ({ f }) => {
    try {
      probed.set(f.entry.path!, await invoke<Inspection>("inspect_media", { path: f.entry.path }));
    } catch (e) {
      probed.set(f.entry.path!, {
        fingerprint: "", duration: null, chapters: 0, audio: [], subs: [],
        video: { codec: null, width: null, height: null, bit_depth: null },
        error: String(e),
      });
    }
    report({ phase: "probing", done: ++done, total: stale.length, current: f.entry.rel });
  });

  report({ phase: "saving", done: 0, total: all.length });
  const titleIds = new Map<string, number>();
  for (const t of plan.titles) {
    await d.execute(
      `INSERT INTO titles (key, kind, name, year, added_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET kind = excluded.kind, name = excluded.name, year = excluded.year`,
      [t.key, t.kind, t.name, t.year, started],
    );
    const [row] = await d.select<{ id: number }[]>("SELECT id FROM titles WHERE key = $1", [t.key]);
    titleIds.set(t.key, row.id);
  }

  let saved = 0;
  for (const { t, f } of all) {
    const e = f.entry;
    const sidecars = JSON.stringify(f.subs.map((s) => ({ path: s.entry.path, lang: s.lang })));
    const parse = [titleIds.get(t.key), e.rel, f.role, f.season, f.episode, f.episodeEnd, f.episodeTitle, f.extraGroup, sidecars, started];
    const p = probed.get(e.path!);
    if (p) {
      await d.execute(
        `INSERT INTO files (title_id, rel, role, season, episode, episode_end, episode_title, extra_group, sidecar_subs, seen_at,
           library_id, path, size, mtime, fingerprint, duration, video_codec, width, height, bit_depth, audio, subs, chapters, probe_error, added_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$10)
         ON CONFLICT (path) DO UPDATE SET
           title_id = excluded.title_id, rel = excluded.rel, role = excluded.role, season = excluded.season,
           episode = excluded.episode, episode_end = excluded.episode_end, episode_title = excluded.episode_title,
           extra_group = excluded.extra_group, sidecar_subs = excluded.sidecar_subs, seen_at = excluded.seen_at,
           library_id = excluded.library_id, size = excluded.size, mtime = excluded.mtime,
           fingerprint = excluded.fingerprint, duration = excluded.duration, video_codec = excluded.video_codec,
           width = excluded.width, height = excluded.height, bit_depth = excluded.bit_depth, audio = excluded.audio,
           subs = excluded.subs, chapters = excluded.chapters, probe_error = excluded.probe_error`,
        [
          ...parse,
          lib.id, e.path, e.size, e.mtime ?? 0, p.fingerprint || null, p.duration, p.video.codec,
          p.video.width, p.video.height, p.video.bit_depth, JSON.stringify(p.audio), JSON.stringify(p.subs),
          p.chapters, p.error,
        ],
      );
    } else {
      await d.execute(
        `UPDATE files SET title_id = $1, rel = $2, role = $3, season = $4, episode = $5, episode_end = $6,
           episode_title = $7, extra_group = $8, sidecar_subs = $9, seen_at = $10
         WHERE path = $11`,
        [...parse, e.path],
      );
    }
    if (++saved % 25 === 0) report({ phase: "saving", done: saved, total: all.length });
  }

  const removed = await d.execute("DELETE FROM files WHERE library_id = $1 AND seen_at < $2", [lib.id, started]);
  await pruneTitles();
  await d.execute("UPDATE libraries SET last_scan = $1 WHERE id = $2", [Date.now(), lib.id]);

  report({ phase: "done", done: all.length, total: all.length });
  return {
    titles: plan.titles.length,
    files: all.length,
    probed: stale.length,
    removed: removed.rowsAffected,
    skipped: plan.skipped.length,
    probeErrors: [...probed.values()].filter((p) => p.error).length,
    warnings: plan.titles.flatMap((t) => t.warnings.map((w) => `${t.name}: ${w}`)),
  };
}
