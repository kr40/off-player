// Skip intro: reading and writing markers (the `segments` table), and a change
// notifier so the player picks up markers found while it is open.
import { useSyncExternalStore } from "react";
import { db } from "./db";
import { effectiveMarker, type Kind, type Marker, type SegmentRow, type Source, type Span } from "./segmentRules";

let version = 0;
const subs = new Set<() => void>();

export function segmentsChanged() {
  version++;
  subs.forEach((f) => f());
}

export function useSegmentsVersion(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
}

export type FileMarkers = { rows: SegmentRow[]; intro: Marker | null; credits: Marker | null };

export async function loadMarkers(fingerprint: string): Promise<FileMarkers> {
  const rows = await (await db()).select<SegmentRow[]>(
    "SELECT kind, start_s, end_s, source, confidence FROM segments WHERE fingerprint = $1",
    [fingerprint],
  );
  return { rows, intro: effectiveMarker(rows, "intro"), credits: effectiveMarker(rows, "credits") };
}

/** Insert or replace one source's marker. A null span means "none". */
export async function saveMarker(fingerprint: string, kind: Kind, source: Source, span: Span | null, confidence: number | null = null) {
  await (await db()).execute(
    `INSERT OR REPLACE INTO segments (fingerprint, kind, start_s, end_s, source, confidence, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [fingerprint, kind, span?.start ?? null, span?.end ?? null, source, confidence, Date.now()],
  );
}

export async function deleteMarker(fingerprint: string, kind: Kind, source: Source) {
  await (await db()).execute("DELETE FROM segments WHERE fingerprint = $1 AND kind = $2 AND source = $3", [fingerprint, kind, source]);
}

/** Markers read from the file's chapters while it plays; only written when they differ. */
export async function saveChapterMarkers(fingerprint: string, found: Record<Kind, Span | null>, rows: SegmentRow[]) {
  let changed = false;
  for (const kind of ["intro", "credits"] as Kind[]) {
    const have = rows.find((r) => r.kind === kind && r.source === "chapter");
    const want = found[kind];
    const same = have ? !!want && Math.abs((have.start_s ?? -1) - want.start) < 0.01 && Math.abs((have.end_s ?? -1) - want.end) < 0.01 : !want;
    if (same) continue;
    if (want) await saveMarker(fingerprint, kind, "chapter", want);
    else await deleteMarker(fingerprint, kind, "chapter");
    changed = true;
  }
  if (changed) segmentsChanged();
}

/** The user's own marker for one file: a span, or null for "there is none". */
export async function setManual(fingerprint: string, kind: Kind, span: Span | null) {
  await saveMarker(fingerprint, kind, "manual", span);
  segmentsChanged();
}

/** Back to automatic: drop the user's marker so the detected one applies again. */
export async function clearManual(fingerprint: string, kind: Kind) {
  await deleteMarker(fingerprint, kind, "manual");
  segmentsChanged();
}

/**
 * Give the same hand-set times to the other episodes of this file's season
 * that have no marker of their own. Returns how many episodes changed.
 */
export async function applyToSeason(fingerprint: string, kind: Kind, span: Span): Promise<number> {
  const d = await db();
  const others = await d.select<{ fingerprint: string }[]>(
    `SELECT DISTINCT f.fingerprint FROM files f
     JOIN files me ON me.fingerprint = $1 AND me.role = 'episode'
     WHERE f.title_id = me.title_id AND f.season = me.season AND f.role = 'episode'
       AND f.fingerprint IS NOT NULL AND f.fingerprint <> $1
       AND NOT EXISTS (SELECT 1 FROM segments s WHERE s.fingerprint = f.fingerprint AND s.kind = $2 AND s.source = 'manual')`,
    [fingerprint, kind],
  );
  for (const o of others) await saveMarker(o.fingerprint, kind, "manual", span);
  segmentsChanged();
  return others.length;
}

/** The season the file belongs to, as "S3", for menu labels. */
export async function seasonOf(fingerprint: string): Promise<number | null> {
  const rows = await (await db()).select<{ season: number | null }[]>(
    "SELECT season FROM files WHERE fingerprint = $1 AND role = 'episode' LIMIT 1",
    [fingerprint],
  );
  return rows[0]?.season ?? null;
}
