// Builds src/discover/franchises/data.json from the hand-written source files:
// every entry is resolved to a TMDB id by title and year (exact name match,
// or the single result of that year), enriched with dates, artwork, runtime
// and rating, and every order is checked to contain each entry exactly once.
// Exits non-zero on anything unresolved or ambiguous; an entry can pin its id
// with "tmdb": <id> when a title is genuinely ambiguous.
//   node scripts/build-franchises.mjs        (dev app running with the debug port)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, norm } from "./tmdb-cdp.mjs";

const SRC = new URL("../src/discover/franchises/source/", import.meta.url);
const OUT = new URL("../src/discover/franchises/data.json", import.meta.url);

// Well-known TMDB movie collections shown under Collections → Popular (resolved by name).
const POPULAR = [
  "The Godfather Collection", "Rocky Collection", "Creed Collection", "The Dark Knight Collection", "Shrek Collection",
  "How to Train Your Dragon Collection", "Despicable Me Collection", "Ocean's Collection", "The Bourne Collection",
  "Die Hard Collection", "The Terminator Collection", "Kill Bill Collection", "Before Collection",
  "Spider-Man: Spider-Verse Collection", "Kung Fu Panda Collection", "Paddington Collection", "Ice Age Collection",
  "Scream Collection", "Halloween Collection", "Saw Collection", "Men in Black Collection", "Ghostbusters Collection",
  "Top Gun Collection", "Jumanji Collection", "Deadpool Collection", "Rush Hour Collection", "Taken Collection",
  "The Equalizer Collection", "Frozen Collection", "Inside Out Collection", "The Incredibles Collection", "Cars Collection",
  "Finding Nemo Collection", "Avatar Collection", "Kingsman Collection", "Sherlock Holmes Collection", "Now You See Me Collection",
  "A Quiet Place Collection", "Dune Collection", "Spider-Man (Avengers) Collection",
];

const { tmdb, close } = await connect();
const problems = [];
const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) : null);

async function resolve(e) {
  if (e.tmdb) return e.tmdb;
  const isTv = e.type === "tv";
  const params = { query: e.title, include_adult: "false" };
  if (e.year) params[isTv ? "first_air_date_year" : "primary_release_year"] = e.year;
  let res = (await tmdb(`/search/${e.type}`, params)).results ?? [];
  if (!res.length && e.year) res = (await tmdb(`/search/${e.type}`, { query: e.title, include_adult: "false" })).results ?? [];
  const name = (r) => (isTv ? r.name : r.title);
  const orig = (r) => (isTv ? r.original_name : r.original_title);
  const date = (r) => (isTv ? r.first_air_date : r.release_date);
  const close1 = (r) => !e.year || Math.abs((yearOf(date(r)) ?? 0) - e.year) <= 1;
  const exact = res.filter((r) => (norm(name(r)) === norm(e.title) || norm(orig(r)) === norm(e.title)) && close1(r));
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) {
    // Prefer the exact year, then the most voted.
    const same = exact.filter((r) => yearOf(date(r)) === e.year);
    const pick = (same.length ? same : exact).sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))[0];
    console.warn(`  ~ ${e.title} (${e.year}): ${exact.length} exact matches, took ${pick.id} "${name(pick)}" ${date(pick)}`);
    return pick.id;
  }
  const sameYear = res.filter((r) => yearOf(date(r)) === e.year);
  if (sameYear.length === 1) {
    console.warn(`  ~ ${e.title} (${e.year}): no exact name, took the only ${e.year} result "${name(sameYear[0])}" (${sameYear[0].id})`);
    return sameYear[0].id;
  }
  problems.push(`${e.title} (${e.type}, ${e.year}): ${res.length ? `ambiguous: ${res.slice(0, 4).map((r) => `${name(r)} ${date(r)} #${r.id}`).join("; ")}` : "not found"}`);
  return null;
}

const franchises = [];
const files = readdirSync(SRC).filter((f) => f.endsWith(".json")).sort();
for (const file of files) {
  const src = JSON.parse(readFileSync(new URL(file, SRC), "utf8"));
  console.log(`${src.key}: ${src.entries.length} entries`);
  const entries = [];
  const collections = new Set();
  let best = { votes: -1, backdrop: null };
  for (const e of src.entries) {
    const id = await resolve(e);
    if (!id) continue;
    const d = await tmdb(`/${e.type}/${id}`);
    let date = (e.type === "tv" ? d.first_air_date : d.release_date) || null;
    let poster = d.poster_path ?? null;
    // A pinned entry keeps its written title (TMDB calls the Animated Series just "Star Trek").
    let title = e.tmdb ? e.title : (e.type === "tv" ? d.name : d.title) ?? e.title;
    if (e.season) {
      const s = await tmdb(`/tv/${id}/season/${e.season}`).catch(() => null);
      if (!s) {
        problems.push(`${e.title}: season ${e.season} not on TMDB`);
        continue;
      }
      date = s.air_date || null;
      poster = s.poster_path ?? poster;
    }
    if (d.belongs_to_collection) collections.add(d.belongs_to_collection.id);
    if ((d.vote_count ?? 0) > best.votes && d.backdrop_path) best = { votes: d.vote_count, backdrop: d.backdrop_path };
    entries.push({
      ref: e.ref,
      type: e.type,
      id,
      ...(e.season ? { season: e.season } : {}),
      title,
      year: yearOf(date),
      date,
      poster,
      backdrop: d.backdrop_path ?? null,
      ...(e.note ? { note: e.note } : {}),
      ...(e.type === "movie" && d.runtime ? { runtime: d.runtime } : {}),
      ...(d.vote_count > 20 && d.vote_average ? { rating: Math.round(d.vote_average * 10) / 10 } : {}),
    });
  }
  const refs = entries.map((x) => x.ref);
  const orders = Object.entries(src.orders ?? {}).map(([id, list]) => {
    const missing = src.entries.map((x) => x.ref).filter((r) => !list.includes(r));
    const extra = list.filter((r) => !src.entries.some((x) => x.ref === r));
    const dupes = list.filter((r, i) => list.indexOf(r) !== i);
    if (missing.length || extra.length || dupes.length) problems.push(`${src.key}: order "${id}" missing [${missing}] extra [${extra}] repeated [${dupes}]`);
    return { id, label: src.orderLabels?.[id] ?? "Story order", refs: list.filter((r) => refs.includes(r)) };
  });
  if (orders.length && !(src.sources ?? []).length) problems.push(`${src.key}: story order without a source`);
  franchises.push({
    key: src.key,
    name: src.name,
    blurb: src.blurb,
    group: src.group ?? "film",
    sources: src.sources ?? [],
    backdrop: best.backdrop,
    entries,
    orders,
    tmdbCollections: [...collections],
  });
}

const franchiseColls = new Set(franchises.flatMap((f) => f.tmdbCollections));
const popular = [];
for (const name of POPULAR) {
  const res = (await tmdb("/search/collection", { query: name })).results ?? [];
  const hit = res.find((c) => norm(c.name) === norm(name)) ?? res.find((c) => norm(c.name).startsWith(norm(name.replace(/ Collection$/, ""))));
  if (!hit) {
    console.warn(`  ~ collection not found: ${name}`);
    continue;
  }
  if (franchiseColls.has(hit.id)) continue;
  const c = await tmdb(`/collection/${hit.id}`);
  const released = (c.parts ?? []).filter((p) => p.release_date).length;
  if (released < 2) continue;
  popular.push({ id: c.id, name: c.name, poster: c.poster_path ?? null, backdrop: c.backdrop_path ?? null, count: released });
}
close();

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), franchises, collections: popular }, null, 0));
console.log(`\nwrote data.json: ${franchises.length} franchises, ${franchises.reduce((a, f) => a + f.entries.length, 0)} entries, ${popular.length} popular collections`);
