// Export / import of everything the user has told the app (watch history,
// lists, reactions, choices, settings) as one JSON file, and import of IMDb's
// own "Your ratings" and watchlist exports (CSV).
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { db } from "./db";
import { libraryChanged, tasteChanged } from "./store";
import { markSeen } from "./seen";
import { addToWatchlist, ensureWatchlistLoaded } from "./watchlist";
import { runJob } from "./jobs";
import { tmdbForImdb } from "../discover/imdb";
import type { Item } from "../discover/api";
import type { Reaction } from "../discover/recommend";

const TABLES = ["playback", "title_prefs", "watchlist", "seen", "rec_dismissed", "collection_state", "saved_filters", "settings"] as const;
type Table = (typeof TABLES)[number];
export type Backup = { app: "Off Player"; version: string; exported_at: number; tables: Partial<Record<Table, Record<string, unknown>[]>> };

export async function exportData(path: string, includeKey: boolean): Promise<Record<Table, number>> {
  const d = await db();
  const tables: Backup["tables"] = {};
  const counts = {} as Record<Table, number>;
  for (const t of TABLES) {
    let rows = await d.select<Record<string, unknown>[]>(`SELECT * FROM ${t}`);
    if (t === "settings" && !includeKey) rows = rows.filter((r) => r.key !== "tmdb_key");
    tables[t] = rows;
    counts[t] = rows.length;
  }
  const body: Backup = { app: "Off Player", version: await getVersion(), exported_at: Date.now(), tables };
  await invoke("write_user_file", { path, contents: JSON.stringify(body, null, 1) });
  return counts;
}

export async function readBackup(path: string): Promise<Backup> {
  const text = await invoke<string>("read_user_file", { path });
  const b = JSON.parse(text) as Backup;
  if (b.app !== "Off Player" || typeof b.tables !== "object") throw new Error("This isn't an Off Player export file.");
  return b;
}

export const backupCounts = (b: Backup) => Object.fromEntries(TABLES.map((t) => [t, b.tables[t]?.length ?? 0])) as Record<Table, number>;

/** Merge an export into this PC's data (rows with the same key are replaced). */
export async function importData(b: Backup) {
  const d = await db();
  const cols = new Map<string, string[]>();
  for (const t of TABLES) {
    const rows = b.tables[t] ?? [];
    if (!rows.length) continue;
    if (!cols.has(t)) {
      const info = await d.select<{ name: string }[]>(`PRAGMA table_info(${t})`);
      cols.set(t, info.map((c) => c.name));
    }
    const known = cols.get(t)!;
    for (const r of rows) {
      const keys = Object.keys(r).filter((k) => known.includes(k));
      if (!keys.length) continue;
      await d.execute(
        `INSERT OR REPLACE INTO ${t} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
        keys.map((k) => r[k]),
      );
    }
  }
  libraryChanged();
  tasteChanged();
  // Stores re-read on next load; a reload is simplest for every page.
  setTimeout(() => location.reload(), 300);
}

// ---------------------------------------------------------------------------
// IMDb exports

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

export type ImdbExport = { kind: "ratings" | "watchlist"; entries: { tconst: string; title: string; rating: number | null }[] };

export function readImdbExport(text: string): ImdbExport {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const head = rows[0]?.map((h) => h.trim()) ?? [];
  const ci = head.indexOf("Const");
  if (ci < 0) throw new Error("This doesn't look like an IMDb export (no “Const” column).");
  const ri = head.indexOf("Your Rating");
  const ti = head.indexOf("Title");
  const entries = rows
    .slice(1)
    .filter((r) => /^tt\d+$/.test(r[ci] ?? ""))
    .map((r) => ({ tconst: r[ci], title: ti >= 0 ? r[ti] : r[ci], rating: ri >= 0 && r[ri] ? Number(r[ri]) : null }));
  return { kind: ri >= 0 ? "ratings" : "watchlist", entries };
}

/** IMDb 1–10 → reaction: 8–10 loved, 6–7 liked, 5 and below not for me. */
export const reactionFor = (rating: number): Reaction => (rating >= 8 ? 2 : rating >= 6 ? 1 : -1);

export function applyImdbExport(x: ImdbExport): Promise<void> {
  return runJob(async (report) => {
    const found: { item: Item; rating: number | null }[] = [];
    let done = 0;
    let missing = 0;
    const queue = [...x.entries];
    const worker = async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const item = await tmdbForImdb(e.tconst).catch(() => null);
        if (item) found.push({ item, rating: e.rating });
        else missing++;
        report({ label: "Importing from IMDb", done: ++done, total: x.entries.length, current: e.title });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (x.kind === "ratings") {
      for (const r of [2, 1, -1] as Reaction[]) {
        const group = found.filter((f) => f.rating !== null && reactionFor(f.rating) === r).map((f) => f.item);
        if (group.length) await markSeen(group, r);
      }
    } else {
      const have = await ensureWatchlistLoaded();
      for (const f of found) if (!have.some((h) => h.type === f.item.type && h.id === f.item.id)) await addToWatchlist(f.item);
    }
    return `Imported ${found.length} titles from IMDb${missing ? ` (${missing} not found on TMDB)` : ""}.`;
  });
}
