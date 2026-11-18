// High-level library operations, run through the job queue.
import { invoke } from "@tauri-apps/api/core";
import { addLibrary, db, getSetting, listLibraries, type Library } from "./db";
import { scanLibrary, type ScanResult } from "./scanner";
import { refreshMetadata, setMatch } from "./metadata";
import { libraryChanged } from "./store";
import type { Progress } from "./jobs";
import { kickSegments } from "./segmentScan";

type Report = (p: Progress) => void;

const PHASE: Record<string, string> = {
  listing: "Looking for videos",
  probing: "Reading files",
  saving: "Saving library",
  done: "Done",
};

export async function runMetadata(report: Report, opts?: { titleIds?: number[]; force?: boolean }) {
  const r = await refreshMetadata(report, opts);
  const parts = [
    r.matched ? `${r.matched} matched with TMDB` : null,
    r.updated.length ? `Updated ${r.updated.join(", ")}` : null,
    r.unmatched.length ? `No TMDB match for ${r.unmatched.join(", ")}` : null,
    r.errors.length ? `${r.errors.length} errors: ${r.errors[0]}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export async function scanAll(libs: Library[], report: Report): Promise<string> {
  const results: ScanResult[] = [];
  for (const lib of libs) {
    results.push(
      await scanLibrary(lib, (p) =>
        report({ label: PHASE[p.phase] ?? p.phase, done: p.done, total: p.total, current: p.current }),
      ),
    );
    libraryChanged();
  }
  const sum = (k: keyof ScanResult) => results.reduce((a, r) => a + (r[k] as number), 0);
  const warns = results.flatMap((r) => r.warnings).length;
  const scanMsg =
    `Scanned ${sum("files")} videos in ${sum("titles")} titles` +
    (sum("probed") ? ` · ${sum("probed")} read` : " · nothing changed") +
    (sum("removed") ? ` · ${sum("removed")} removed` : "") +
    (warns ? ` · ${warns} need attention` : "");
  const metaMsg = await runMetadata(report);
  kickSegments(); // new episodes: find their intros once this job is done
  return [scanMsg, metaMsg].filter(Boolean).join(" · ");
}

/**
 * On launch: add dev seed folders to an empty library, then rescan (incremental,
 * a couple of seconds when nothing changed) so new episodes show up without a
 * manual scan, then finish any pending metadata and thumbnails.
 */
export async function startup(report: Report) {
  let libs = await listLibraries();
  if (libs.length === 0) {
    const seeds = await invoke<string[]>("seed_libraries");
    if (seeds.length) {
      for (const p of seeds) await addLibrary(p);
      libs = await listLibraries();
      return scanAll(libs, report);
    }
  }
  if (libs.length && (await getSetting("rescan_on_launch")) !== "false") {
    const msg = await scanAll(libs, report);
    return /nothing changed/.test(msg) ? null : msg; // stay quiet when nothing is new
  }
  return runMetadata(report);
}

/** Forget every position and watched mark (keeps the library and artwork). */
export async function clearWatchHistory() {
  const d = await db();
  await d.execute("DELETE FROM playback");
  libraryChanged();
}

export async function fixMatch(titleId: number, choice: { type: "tv" | "movie"; id: number } | null, report: Report) {
  await setMatch(titleId, choice);
  return choice ? runMetadata(report, { titleIds: [titleId], force: true }) : (await runMetadata(report), "Using file names only");
}
