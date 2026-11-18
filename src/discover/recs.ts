// For You: TMDB recommendation lists per seed, cached in the database for a
// week (so suggestions work offline and stay within rate limits), ranked by
// the pure functions in recommend.ts.
import { useMemo, useSyncExternalStore } from "react";
import { db, getSetting, listTitles, setSetting } from "../library/db";
import { onTasteChanged, tasteChanged } from "../library/store";
import { useSeen, watchedSet } from "../library/seen";
import { ensureWatchlistLoaded } from "../library/watchlist";
import { tmdb } from "../library/metadata";
import { toItem, type Item, type MediaType } from "./api";
import { forYou, keyOf, pickSeeds, MIN_SEEDS, type Scored, type Seed, type SeedRef } from "./recommend";

const WEEK = 7 * 86400000;

export type RecState = {
  status: "idle" | "off" | "few" | "loading" | "ready" | "empty";
  seedCount: number;
  libraryKeys: string[]; // library titles in the watched set, for a live seed count
  picks: Scored[];
  because: { seed: Seed; items: Item[] }[];
  reasons: Map<string, SeedRef[]>;
};

let state: RecState = { status: "idle", seedCount: 0, libraryKeys: [], picks: [], because: [], reasons: new Map() };
const subs = new Set<() => void>();
const setState = (s: RecState) => {
  state = s;
  subs.forEach((f) => f());
};

let cache: Map<string, { at: number; items: Item[] }> | null = null;
let dismissed: Set<string> | null = null;
const inflight = new Set<string>();
const failed = new Set<string>(); // this session; offline or TMDB errors
/** Count of recommendation requests made this session (checked by the C6 test over CDP). */
export let recRequests = 0;
(window as unknown as { __recRequests?: () => number }).__recRequests = () => recRequests;

async function loadCache() {
  const rows = await (await db()).select<{ seed_type: MediaType; seed_id: number; fetched_at: number; results: string }[]>(
    "SELECT * FROM rec_cache",
  );
  const m = new Map<string, { at: number; items: Item[] }>();
  for (const r of rows) {
    try {
      m.set(`${r.seed_type}:${r.seed_id}`, { at: r.fetched_at, items: JSON.parse(r.results) });
    } catch {
      // ignore a bad row; it will be refetched
    }
  }
  return m;
}
async function loadDismissed() {
  const rows = await (await db()).select<{ tmdb_type: MediaType; tmdb_id: number }[]>("SELECT tmdb_type, tmdb_id FROM rec_dismissed");
  return new Set(rows.map((r) => `${r.tmdb_type}:${r.tmdb_id}`));
}

async function fetchSeed(s: Seed) {
  const k = keyOf(s);
  recRequests++;
  const res = await tmdb<{ results: any[] }>(`/${s.type}/${s.id}/recommendations`, { include_adult: "false" });
  const items = (res.results ?? [])
    .map((r) => toItem(r, s.type))
    .filter((i): i is Item => !!i && !!i.poster);
  const at = Date.now();
  cache!.set(k, { at, items });
  await (await db()).execute(
    "INSERT OR REPLACE INTO rec_cache (seed_type, seed_id, fetched_at, results) VALUES ($1, $2, $3, $4)",
    [s.type, s.id, at, JSON.stringify(items)],
  );
}

function fetchMissing(seeds: Seed[]) {
  const need = seeds.filter((s) => {
    const k = keyOf(s);
    const c = cache!.get(k);
    return (!c || Date.now() - c.at > WEEK) && !inflight.has(k) && !failed.has(k);
  });
  if (!need.length) return;
  for (const s of need) inflight.add(keyOf(s));
  const queue = [...need];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        await fetchSeed(s);
      } catch {
        failed.add(keyOf(s));
      } finally {
        inflight.delete(keyOf(s));
        schedule();
      }
    }
  };
  for (let i = 0; i < 4; i++) worker();
}

let running = false;
let again = false;
async function compute() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await computeOnce();
    } while (again);
  } catch (e) {
    console.warn("recs", e);
  } finally {
    running = false;
  }
}

async function computeOnce() {
  if (!(await getSetting("tmdb_key"))) return setState({ ...state, status: "off" });
  cache ??= await loadCache();
  dismissed ??= await loadDismissed();
  const [inputs, titles, watchlist] = await Promise.all([watchedSet(), listTitles(), ensureWatchlistLoaded()]);
  const seeds = pickSeeds(inputs);
  const libraryKeys = inputs.filter((s) => s.source !== "manual").map(keyOf);
  if (seeds.length < MIN_SEEDS)
    return setState({ status: "few", seedCount: seeds.length, libraryKeys, picks: [], because: [], reasons: new Map() });
  const lists = new Map<string, Item[]>();
  for (const s of seeds) {
    const c = cache.get(keyOf(s));
    if (c) lists.set(keyOf(s), c.items);
  }
  const r = forYou(seeds, lists, {
    watched: new Set(inputs.map(keyOf)),
    library: new Set(titles.filter((t) => t.tmdb_id && t.tmdb_type).map((t) => `${t.tmdb_type}:${t.tmdb_id}`)),
    dismissed,
    watchlist: new Set(watchlist.map(keyOf)),
  });
  const reasons = new Map<string, SeedRef[]>();
  for (const row of r.because) for (const i of row.items) reasons.set(keyOf(i), [{ type: row.seed.type, id: row.seed.id, name: row.seed.name }]);
  for (const p of r.picks) reasons.set(keyOf(p.item), p.reasons);
  fetchMissing(seeds);
  const busy = inflight.size > 0;
  const status = r.picks.length || r.because.length ? "ready" : busy ? "loading" : "empty";
  setState({ status, seedCount: seeds.length, libraryKeys, picks: r.picks, because: r.because, reasons });
}

let timer = 0;
function schedule() {
  window.clearTimeout(timer);
  timer = window.setTimeout(compute, 250);
}
onTasteChanged(schedule);

/** Suggestions for the For You rows. Watched and dismissed titles drop out on the same render. */
export function useRecommendations(): RecState {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (state.status === "idle") compute();
      return () => subs.delete(f);
    },
    () => state,
  );
  const seen = useSeen();
  return useMemo(() => {
    const gone = new Set([...seen.map(keyOf), ...(dismissed ?? [])]);
    // While asking for more seeds, count marks the moment they're made rather than after the recompute.
    const seedCount = s.status === "few" ? new Set([...seen.map(keyOf), ...s.libraryKeys]).size : s.seedCount;
    if (!gone.size) return { ...s, seedCount };
    return {
      ...s,
      seedCount,
      picks: s.picks.filter((p) => !gone.has(keyOf(p.item))),
      because: s.because.map((b) => ({ ...b, items: b.items.filter((i) => !gone.has(keyOf(i))) })),
    };
  }, [s, seen]);
}

// The "Tell us what you've watched" prompt can be closed; remembered in settings.
let promptHidden = false;
let promptLoaded = false;
const promptSubs = new Set<() => void>();
export function hydratePrompt(v: string | null) {
  promptHidden = v === "true";
  promptLoaded = true;
}
export function usePromptHidden(): boolean {
  return useSyncExternalStore(
    (f) => {
      promptSubs.add(f);
      if (!promptLoaded) {
        promptLoaded = true;
        getSetting("foryou_prompt_hidden").then((v) => {
          promptHidden = v === "true";
          promptSubs.forEach((g) => g());
        });
      }
      return () => promptSubs.delete(f);
    },
    () => promptHidden,
  );
}
export async function setPromptHidden(v: boolean) {
  promptHidden = v;
  promptLoaded = true;
  promptSubs.forEach((g) => g());
  await setSetting("foryou_prompt_hidden", v ? "true" : "false");
}

/** Why a title is suggested, if it is. */
export function useRecReason(type: MediaType, id: number): SeedRef[] | undefined {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
  return s.reasons.get(`${type}:${id}`);
}

/** "Not interested": never suggest this title again. Returns an undo. */
export async function dismissRec(item: Item): Promise<() => Promise<void>> {
  dismissed ??= await loadDismissed();
  const k = keyOf(item);
  dismissed.add(k);
  // Drop it from the current rows right away.
  setState({
    ...state,
    picks: state.picks.filter((p) => keyOf(p.item) !== k),
    because: state.because.map((b) => ({ ...b, items: b.items.filter((i) => keyOf(i) !== k) })),
  });
  await (await db()).execute("INSERT OR REPLACE INTO rec_dismissed (tmdb_type, tmdb_id, at) VALUES ($1, $2, $3)", [item.type, item.id, Date.now()]);
  tasteChanged();
  return async () => {
    dismissed!.delete(k);
    await (await db()).execute("DELETE FROM rec_dismissed WHERE tmdb_type = $1 AND tmdb_id = $2", [item.type, item.id]);
    tasteChanged();
  };
}
