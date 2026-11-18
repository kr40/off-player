# PRD: Off Player 2.0 — Find it, then watch it

**Product:** Off Player (desktop, Windows) · **Baseline:** v1.3.0 · **Target:** v2.0.0
**Status:** Implemented in v2.0.0 (results, measurements and what wasn't verified: PLAN.md → "Off Player 2.0") · **Written:** 2026-11-17
**For:** the implementing engineer/agent. Read [PLAN.md](../PLAN.md) (design and history of every phase), [README.md](../README.md) (run, test, tooling) and the previous PRD ([My List, Already Watched, For You](PRD-my-list-watched-recommendations.md)) first. This document assumes all three.

---

## 1. Summary

Off Player does two jobs. It plays the media a person owns, with resume and watch history. And it helps them decide what to watch next. Version 1.3 does the first job well and the second job partly: Discover has rows, categories, search and suggestions, but no real filtering, no ranked lists, no franchises, and only one source of ratings.

Version 2.0 finishes the second job and makes the whole app fit to hand to someone else:

1. **A reorganised menu** — four top-level places with clear jobs, a sub-menu inside Discover, one global search, settings behind a gear.
2. **Browse with real filters** — rating, year, runtime, language, status, streaming service, keywords, sort.
3. **Top Lists** — Top 250 movies, Top 250 series, top by genre, era, theme and country, for movies, series and anime, with "you've seen 37 of 250".
4. **IMDb ratings** — IMDb's free data files downloaded to the PC: IMDb rating beside the TMDB rating everywhere, and lists ranked by IMDb rating.
5. **Collections** — Dune, Star Wars, the MCU, anime sagas: every entry in release order or story order, across movies and series, tied to what the user owns and has watched.
6. **A design and motion standard** — one set of animation rules, loading, empty and error states for every page, keyboard use, no layout jumps.
7. **Ready to share** — first-run setup, no dependence on tools the recipient has to install, an About page with the required credits, data backup, an honest privacy statement.

No new paid service or account is needed. TMDB (already in use) covers items 2, 3 and most of 5. IMDb's data files cover item 4. Story order (item 5) is the one thing no free source provides reliably, so it ships as a small curated file inside the app.

## 2. Goals and non-goals

**Goals**
- A new user can install the app, finish setup in under two minutes, and reach either their library or a useful Discover page.
- "What should I watch next?" can be answered five ways: suggestions, filters, top lists, collections, search.
- Every title shows where it stands: in the library, watched, on the watchlist, part of a collection, and its rating from both sources when available.
- Movies, series and anime are all first-class: every list, filter and collection works for each.
- The app feels finished: nothing overlaps, jumps, flashes or dead-ends; motion is consistent and never blocks input.
- Everything already cached keeps working offline.

**Non-goals (this release)**
- Playing, streaming or acquiring titles that are not in the library. Discover stays browse-only; "Where to watch" links out.
- Accounts, cloud sync, multiple profiles, mobile or TV apps, macOS or Linux builds.
- Matching imdb.com's official Top 250 chart exactly (see §8.4).
- AI-generated suggestions. TMDB's API terms prohibit using TMDB content "in connection with" a machine-learning or AI application, so this stays out.
- Per-episode watched tracking for shows that are not in the library.
- Translation of the interface (English only; the "where to watch" country setting stays).
- Skip intro, subtitle download, mini player (listed in §16).

## 3. Users and key scenarios

**Primary user:** the owner, on a Windows PC with a 2560-wide display, a local library on `D:\Media`, and a long viewing history elsewhere.
**New in 2.0 — the recipient:** a friend who is sent the installer. They may have no library at all, no TMDB key, and no ffmpeg installed. The app must be useful to them anyway.

| # | Scenario | Path in 2.0 |
|---|---|---|
| 1 | "A good crime series from the last five years, finished, rated 8+." | Discover → Browse: Series, Crime, 2021–2026, Status Ended, Rating 8+, sort by rating. |
| 2 | "What are the best movies ever, and how many have I seen?" | Discover → Top Lists → Top 250 movies. Header shows "37 of 250 seen"; switch to Unseen only. |
| 3 | "Best mafia movies." | Top Lists → By theme → Mafia. |
| 4 | "I want to watch Dune properly." | Collections → Dune. Switch Release order / Story order. First unwatched entry is marked Next up. |
| 5 | "Is this any good?" | Any title page shows IMDb 8.7 and TMDB 8.4 side by side. |
| 6 | "Popular anime right now, and the classics." | Type switch → Anime, anywhere in Discover; Top Lists → Top anime series / movies. |
| 7 | "I own Star Trek TNG; what comes next in the franchise?" | TNG's page shows "Part of Star Trek"; the collection page marks owned and watched entries and plays the next owned one. |
| 8 | Recipient's first launch | Welcome → add a folder (or skip) → TMDB key with guided steps → optional IMDb ratings → "what have you watched?" → Home. |
| 9 | "Find Oppenheimer / find that actor's other films." | One search box in the top bar: library results first, then TMDB titles, collections, people. |

## 4. Current state (v1.3.0)

| Area | Where | Notes |
|---|---|---|
| Top bar | `src/app/TopNav.tsx`, routes in `src/app/nav.tsx`, page stack in `src/app/Shell.tsx` | Home, Series, Movies, Discover, My List; Search icon (library only); Library icon (Manage page; Settings is a modal opened from Manage). |
| Discover | `src/pages/Discover.tsx`, `src/discover/api.ts` | Hero, All/Series/Movies switch, Categories dropdown (16 categories in `src/discover/genres.ts`), TMDB search box, suggestion rows, fixed rows. Uses `/discover/{type}` only for categories. 30-minute in-memory cache. |
| Suggestions | `src/discover/recommend.ts` (pure), `src/discover/recs.ts` | Watched set → TMDB recommendations → ranked rows with reasons. `rec_cache` table, 7-day life. |
| Lists | `src/library/watchlist.ts`, `src/library/seen.ts`, `src/pages/MyList.tsx` | Watchlist, Watched (manual + derived from library), reactions, Undo toast (`src/components/Toast.tsx`), quick picker. |
| Detail page | `src/pages/TmdbPage.tsx` | Hero, facts, where to watch, cast, seasons, "More like this". `details()` already returns `belongs_to_collection` data from TMDB but ignores it. |
| Cards | `src/components/browse/DiscoverCard.tsx`, `cards.tsx`, `Row.tsx` | Poster card with action stack (Watchlist, Watched, Not interested). Landscape library cards with the reworked hover (v1.2.1). |
| TMDB transport | Rust `tmdb_get` in `src-tauri/src/artwork.rs` | Host-pinned; path limited to letters, digits, `/`, `_`, `-`; everything else as query parameters. `reqwest` 0.13 with `json`, `native-tls`, `query`. |
| Database | SQLite via `tauri-plugin-sql`, migrations 001–005 registered in `src-tauri/src/lib.rs` | `%APPDATA%\com.offplayer.app\offplayer.db`, shared by dev and release builds. |
| External tools | `ffprobe` / `ffmpeg` looked up on PATH (`media.rs`, `artwork.rs`) | Needed for scanning, thumbnails and scrub previews. A recipient will not have them. |
| Settings | `src/components/Settings.tsx` | TMDB key, playback, library options. No About page, no onboarding. |
| Tests / tooling | Vitest (57 tests), `scripts/cdp.mjs`, `at.mjs`, `hover-probe.mjs`, `peek.ps1` | See README → "Checking the window". |

## 5. Navigation and information architecture

The top bar has grown one item per feature. 2.0 reorganises it around the two jobs.

### 5.1 Site map

```
Top bar:  [←]  Off Player   Home   Library   Discover   My List        [ Search… ]  [jobs]  [⚙]

Home        What to do right now: resume, next up, picks, your list.
Library     Everything you own.
              tabs: All · Series · Movies · Anime (only if owned) · Collections (owned)
              tools: Categories, sort, "Manage folders" (opens the Manage page)
Discover    Everything you could watch.
              sub-menu (second bar, stays visible while scrolling):
              For You · Browse · Top Lists · Collections · Coming Soon
My List     Watchlist · Watched · Saved filters
Search      One box in the top bar; results page with sections.
⚙ Settings  A full page, not a modal: General · Library · Playback · Discover & ratings · Data & privacy · About
```

### 5.2 What moves

| Today | In 2.0 |
|---|---|
| Series, Movies (two top-bar items) | **Library** with tabs. Routes `series` / `movies` remain as deep links into the tabs. |
| Library icon → Manage page → Settings modal | **Library → Manage folders** for folders, matches and scanning. **⚙** opens Settings as its own page. |
| Search icon (library only) + search box inside Discover | One **global search** field in the top bar (§10). |
| Discover's Categories dropdown and All/Series/Movies switch | Stay on For You. Browse replaces them with the full filter bar. |
| Suggestions prompt, Top picks, Because you watched | **Discover → For You**. |

### 5.3 Rules
- A top-bar item is highlighted for every page beneath it (a collection page highlights Discover; a library title page highlights Library).
- The Discover sub-menu remembers the last tab for the session; `go({ page: "discover" })` opens For You on first use.
- The type switch is **All · Series · Movies · Anime** wherever it appears. The choice is shared across Discover tabs for the session.
- Back (Esc, Backspace, mouse back, the arrow) always returns to the previous page with its scroll position and filters intact (pages stay mounted in the stack; keep that).
- Route additions: `library` (`tab?`), `discover` (`tab?: "foryou" | "browse" | "toplists" | "collections" | "soon"`), `toplist` (`id`), `collection` (`key`), `person` (`id`), `settings` (`section?`), `search` (`q?`). `routeKey` in `Shell.tsx` must include the id/key for the new detail routes.

### 5.4 Home (row order)
Hero (resume target, else featured) → Continue watching → **Next up in your collections** (first unwatched, owned entry of each followed collection, max 12) → Top picks for you (12, See all → Discover) → Your watchlist (12, See all → My List) → **Out now from your list** (released since saved, or new episode this week) → Recently added → Your series → Your movies → Top-rated episodes → Seasons. Rows with nothing to show are omitted. A user with no library sees: hero from trending, Top picks or the suggestions prompt, watchlist, three Top List teasers, three Collection teasers.

### 5.5 Acceptance criteria
- N1. The top bar shows exactly Home, Library, Discover, My List, the search field, and the settings gear; every v1.3 page is reachable within two clicks.
- N2. Discover's sub-menu stays visible while scrolling and switches tabs without reloading already-loaded tabs.
- N3. Back restores scroll position and filter state on Browse, a Top List and a Collection.
- N4. With an empty library, no page shows an empty shell: Home and Library show purposeful empty states with a next action.
- N5. Settings opens as a page; every v1.3 setting still exists; `Esc` returns.

## 6. Browse — filters

**Where:** Discover → Browse. A filter bar above an endless poster grid.

### 6.1 Filters

All map to TMDB `/discover/movie` and `/discover/tv` query parameters (verified against the API reference on 2026-11-17).

| Filter | Control | Movies | Series |
|---|---|---|---|
| Type | Series · Movies · Anime | endpoint | endpoint |
| Genres | multi-select panel (reuse `CategoryMenu` layout), match any / match all toggle | `with_genres` (`\|` = any, `,` = all) | same |
| Year | decade chips (pre-1970, 70s … 2020s) + From / To | `primary_release_date.gte/.lte` | `first_air_date.gte/.lte` |
| Rating | slider 5.0–9.0 (step 0.5) | `vote_average.gte` | same |
| Votes | "Well known / Any" (well known = 500+ movies, 200+ series) | `vote_count.gte` | same |
| Runtime | Under 90 min · 90–120 · Over 120 (movies); Under 30 · 30–60 · Over 60 per episode (series) | `with_runtime.gte/.lte` | same |
| Language | searchable list, top 12 pinned | `with_original_language` | same |
| Status | Ongoing · Ended · Miniseries | — | `with_status` (0 returning, 3 ended), `with_type` (2 miniseries) — verify the numeric values with a live call |
| Available on | streaming services in the user's country (logos) | `with_watch_providers` + `watch_region` | same |
| Themes | type-ahead keyword search, chips | `with_keywords` (ids from `/search/keyword`) | same |
| Hide | Watched · In my library · On my watchlist (three toggles) | applied in the app | same |
| Sort | Popularity · Rating · Newest · Oldest · Most votes · Box office (movies) · A–Z | `sort_by` | `sort_by` |

- **Anime** = Animation genre (16) with original language Japanese. Applied as `with_genres=16&with_original_language=ja` on either endpoint; the type switch then offers Series / Movies inside Anime. Implemented once in `src/discover/api.ts` and reused by Top Lists and For You.
- Sorting by rating always adds a vote floor (movies 300, series 150) so unknown titles with three votes do not lead.
- Series always exclude News, Reality, Soap and Talk (`NO_DAILIES`, already in `api.ts`) unless the user picks one of those genres.

### 6.2 Behaviour
- Changing a filter updates the grid after 250 ms; the grid shows skeletons, never a blank area. The previous results stay visible, dimmed, until new ones arrive.
- Active filters appear as removable chips in one row under the bar, with **Clear all**. The result count is not shown (TMDB's totals are capped and misleading); show "No titles match" with the nearest-fix hint ("Try a lower rating") when empty.
- Endless scroll: next page is requested 1.5 screens before the end; stop at TMDB's limit (page 500) or the end of results. Cards use `content-visibility: auto` so 1,000+ cards stay smooth.
- The last-used filter set is restored when Browse is reopened (setting `browse_filters`); **Reset** returns to defaults.
- **Save filter** stores the current set under a name in My List → Saved filters (table `saved_filters`); opening one loads Browse with it.
- Every card is the existing `DiscoverCard` with its actions.
- With IMDb data installed (§8), the Rating control gains a source switch **TMDB / IMDb**. In IMDb mode the query runs against the local IMDb table (genre, year, rating, votes, runtime are available there) and each visible page is mapped to TMDB through `/find` (cached). Filters IMDb data cannot answer (language, available on, themes, status) are disabled with a tooltip saying why. This mode is **P1**; everything else in §6 is P0.

### 6.3 Acceptance criteria
- F1. Scenario 1 in §3 can be built in six clicks or fewer and returns only ended crime series from 2021–2026 rated 8.0+.
- F2. Any combination of filters either shows results or the empty message; no combination errors or spins forever.
- F3. Filters, sort and scroll position survive opening a title and coming back.
- F4. The three Hide toggles remove watched, owned and saved titles without leaving gaps in the grid.
- F5. Anime shows only Japanese animation, for both series and movies.
- F6. Scrolling through 600 cards holds the frame budget in §11.3.
- F7. Offline, Browse shows the last loaded results with a "You're offline" strip and a Retry button; no error page.

## 7. Top Lists

**Where:** Discover → Top Lists (gallery) → a list page.

### 7.1 Gallery
Groups of list tiles (landscape tiles made from the backdrops of the list's first three titles, title, one-line description, and "37 / 250 seen" once any are seen).

| Group | Lists (each for movies and for series unless noted) |
|---|---|
| The essentials | Top 250 movies · Top 250 series · Top 100 anime series · Top 50 anime movies · Most popular this week (movies / series / anime) · Most popular of all time (by votes) |
| By genre | Top 100 in each of the 16 categories in `genres.ts` (where the category exists for that type) |
| By era | Classics (before 1970) · 1970s · 1980s · 1990s · 2000s · 2010s · 2020s |
| By theme | Mafia & organised crime · Heist · Time travel · Space · Dystopia · Superhero · Spy · War · Courtroom · Based on a true story · Coming of age · Serial killer · Zombie · Martial arts · Sport · Road trip · Revenge · Post-apocalyptic |
| Around the world | Korean · Japanese (live action) · Indian (Hindi, Tamil, Telugu) · French · Spanish · German · Italian · British |
| Short on time | Movies under 90 minutes · Miniseries · Finished series of three seasons or fewer |
| Hidden gems | Rated 7.8+ with few votes (TMDB 300–3,000; with IMDb data 5,000–50,000) |

### 7.2 How a list is defined
One module, `src/discover/toplists.ts`, exports an array of definitions. Nothing about a list lives anywhere else.

```ts
type TopList = {
  id: string;                       // "top-movies", "theme-mafia-movies"
  group: "essentials" | "genre" | "era" | "theme" | "world" | "short" | "gems";
  title: string;
  blurb: string;
  type: "movie" | "tv";
  anime?: boolean;
  size: 50 | 100 | 250;
  tmdb: Record<string, string | number>;   // /discover parameters
  imdb?: { kinds: ("movie" | "series")[]; genres?: string[]; yearFrom?: number; yearTo?: number; minVotes: number };
};
```

- TMDB ranking: `sort_by=vote_average.desc` plus a vote floor. Floors: Top 250 movies 3,000 votes; Top 250 series 1,000; genre and era lists 1,000 / 400; theme and world lists 300 / 150. Tune during implementation so each list fills to its size with well-known titles; record the final numbers in the module.
- Theme lists use `with_keywords`. **Do not type keyword ids from memory.** Add `scripts/resolve-keywords.mjs`, which calls `/search/keyword` for each theme, prints candidates with their title counts, and writes the chosen ids into the module. A theme may combine several keywords with `|`.
- A 250-item list is 13 TMDB pages. Fetch the first two immediately and the rest as the user scrolls. Cache every page in the database (`api_cache`, §12) for 7 days so reopening a list costs nothing and works offline.

### 7.3 List page
- Header: backdrop collage, title, blurb, **progress** ("37 of 250 seen", thin bar), ranking source switch **TMDB / IMDb** when the list has an `imdb` definition and IMDb data is installed.
- Controls: **All / Unseen / Seen**, **Hide what I own**, view switch **Grid / Ranked rows**, **Pick one for me** (opens a random unseen title).
- Grid view: `DiscoverCard` with a rank numeral (large, outlined, bottom-left, in the style of a "Top 10" row). Ranked rows view: rank, poster, title, year, both ratings, genres, one-line overview, actions — for people who want to read down a chart.
- Rank numbers are the list's ranks, not positions after filtering (hiding seen titles leaves gaps in the numbers, which is the point).
- "Seen" = the watched set from v1.3 (manual marks and library-derived).
- **Add all unseen to watchlist** is offered for lists of 50; not for 100 or 250.

### 7.4 Acceptance criteria
- T1. Top 250 movies and Top 250 series each load 250 ranked titles; rank 1 appears within 1.5 s on a warm cache and within 3 s cold.
- T2. Every list in §7.1 opens with at least 80 % of its size filled; none shows an obviously wrong title in its first 20 (spot-check each theme list by eye and record the check).
- T3. Marking a title watched on a list page updates the progress and, with Unseen selected, removes the card on the same render.
- T4. Reopening a list within 7 days makes no TMDB list requests (count them as in the C6 check of the previous PRD).
- T5. Offline, a previously opened list still shows, with placeholders for posters that are not cached.
- T6. The source switch re-ranks the same page without navigation and remembers the choice (`rating_source`).

## 8. IMDb ratings

### 8.1 What IMDb allows (read before building)
IMDb publishes data files at `https://datasets.imdbws.com/`, refreshed daily, "for personal and non-commercial use". Its help page adds: the data must come only from those files; no scraping; no republishing or building a competing database; and this credit must be shown: **"Information courtesy of IMDb (https://www.imdb.com). Used with permission."** Consequences for the design:

- The app **downloads the files on each user's own PC**. The data is never bundled in the installer or redistributed.
- It is **opt-in**, explained in plain words at first run and in Settings, and removable.
- Nothing is fetched from imdb.com pages. Links to a title's IMDb page open in the user's browser.
- The credit line appears in About and under any IMDb-ranked list. Use the text "IMDb", not IMDb's logo.

### 8.2 Data import

| File | Size on 2026-11-17 | Used for |
|---|---|---|
| `title.ratings.tsv.gz` | 8.8 MB | `tconst`, `averageRating`, `numVotes` |
| `title.basics.tsv.gz` | 230 MB | `tconst`, `titleType`, `primaryTitle`, `startYear`, `runtimeMinutes`, `genres` |

Format: gzip, tab-separated, UTF-8, header line, `\N` for missing values.

- A Rust command (`imdb_sync`) downloads both files as streams, decompresses on the fly (`flate2`; add `stream` to `reqwest`'s features), and never writes the raw files to disk. Host pinned to `datasets.imdbws.com`, HTTPS only, same style as `tmdb_get`.
- Load ratings into memory first (about 1.6 million small rows), then stream basics and keep a row only if `titleType` is `movie`, `tvMovie`, `tvSeries` or `tvMiniSeries`, it is not adult, and it has at least **1,000 votes**. Expect on the order of 100,000 rows; measure and record the real number and the resulting database growth in PLAN.md.
- Compute a weighted rating per kept row: `WR = (v / (v + m)) · R + (m / (v + m)) · C`, with `m = 25,000` and `C` = the mean rating of kept rows of the same kind. Store it.
- Write rows to table `imdb_titles` (§12). Recommended path: Rust sends batches of about 2,000 rows to the front end over a Tauri channel and the front end writes each batch as a single multi-row `INSERT OR REPLACE`. Do not rely on `BEGIN` / `COMMIT` across separate `execute` calls: `tauri-plugin-sql` uses a connection pool, so they may land on different connections. Import into a fresh table and swap names at the end so a failed download leaves the old data intact.
- Runs as a job (`runJob`) with progress in the top bar ("Getting IMDb ratings… 42 %"); can be cancelled; the app stays usable throughout.
- Refresh: at start-up, when online and the data is older than 7 days, re-run in the background. Setting `imdb_data_at` holds the last success time. Settings shows "IMDb ratings: 104,212 titles, updated 3 days ago", **Update now** and **Remove IMDb data**.

### 8.3 Linking IMDb to TMDB
The app's titles are TMDB titles; IMDb data is keyed by `tconst` (`tt0111161`). Table `ext_ids` holds the link, both ways.

| Direction | How | When |
|---|---|---|
| TMDB → IMDb | Movie details already include `imdb_id`. For series add `external_ids` to `append_to_response`. | Whenever `details()` runs (detail page, watchlist refresh, library metadata). |
| TMDB → IMDb for cards | `/movie/{id}/external_ids` or `/tv/{id}/external_ids` | Lazily for cards that are on screen (IntersectionObserver), four requests at a time, de-duplicated, stored permanently. |
| IMDb → TMDB | `/find/{tconst}?external_source=imdb_id` → `movie_results` / `tv_results` | For IMDb-ranked lists and IMDb-mode Browse, per visible page, stored permanently. A `tconst` TMDB does not know is stored as "no match" and skipped. |

Library titles get their IMDb id during the normal metadata pass, so the library is fully linked without extra work.

### 8.4 Where IMDb ratings appear
- **Title pages (TMDB and library):** both ratings side by side — `IMDb 8.7 (1.2M)` and `TMDB 8.4`. Clicking the IMDb rating opens `https://www.imdb.com/title/{tconst}/` in the browser.
- **Cards:** one rating badge, as today. Setting **Rating shown on posters: TMDB / IMDb** (`rating_source`). With IMDb chosen, a card whose link or rating is not known yet shows the TMDB rating and swaps without moving anything when the IMDb one arrives. The badge carries a small "IMDb" or "TMDB" label so the two are never confused.
- **Top Lists:** source switch on list pages (§7.3). IMDb-ranked lists sort by the weighted rating with a 25,000-vote minimum for the 250s (5,000 for genre and era lists).
- **Naming:** the lists are called "Top 250 by IMDb rating", never "the IMDb Top 250". They are computed on the PC from public votes; IMDb's own chart uses an undisclosed subset of voters, so the two will differ slightly. Say this in the list's info tooltip.
- **Sorting:** My List, Library and Browse (IMDb mode) can sort by IMDb rating.
- Without IMDb data the app behaves exactly as v1.3 with no empty slots, no prompts beyond one line in Settings and the onboarding step.

### 8.5 Acceptance criteria
- I1. Enabling IMDb ratings downloads and imports in the background; the app stays responsive (no frame over 100 ms attributable to the import) and survives being closed mid-import (old data, or none, remains; no half-filled table).
- I2. After import, The Shawshank Redemption, The Godfather and Breaking Bad show an IMDb rating on their pages that matches `title.ratings` for their `tconst`.
- I3. "Top 250 movies by IMDb rating" shows 250 titles, each resolved to a TMDB title with artwork; any unresolved entries are skipped without leaving gaps in the layout.
- I4. With the poster setting on IMDb, a Discover row shows IMDb ratings for at least 90 % of its cards within 3 s on the second visit, and no card changes size when a rating swaps.
- I5. Remove IMDb data deletes the table contents and every IMDb rating disappears on the next render; TMDB ratings remain.
- I6. The credit line in §8.1 is present in About and under IMDb-ranked lists.
- I7. No request goes to any imdb.com host other than `datasets.imdbws.com` (check the network log).

## 9. Collections

**Where:** Discover → Collections; Library → Collections (owned); links from title pages; Home row.

### 9.1 Two kinds

| Kind | Source | Contains | Orders |
|---|---|---|---|
| **Movie collection** | TMDB (`/collection/{id}`, `/search/collection`, `belongs_to_collection` on a movie) | Movies only | Release order |
| **Franchise** | Curated file shipped with the app | Movies, series, single seasons | Release order, Story order, and optionally one more named order |

A franchise may absorb TMDB collections (the Star Wars franchise includes the Star Wars movie collection); where a franchise exists, the movie collection page redirects to it.

### 9.2 Franchise data
- Authoring source: `src/discover/franchises/source/*.json`, one file per franchise, written by hand:

```jsonc
{
  "key": "dune",
  "name": "Dune",
  "blurb": "Frank Herbert's desert planet, from the Sisterhood's origins to Paul Atreides.",
  "sources": ["https://… (where the story order was checked)"],
  "entries": [
    { "ref": "prophecy", "type": "tv",    "title": "Dune: Prophecy",  "year": 2024, "note": "Set 10,000 years before Paul Atreides." },
    { "ref": "part1",    "type": "movie", "title": "Dune",            "year": 2021 },
    { "ref": "part2",    "type": "movie", "title": "Dune: Part Two",  "year": 2024 }
  ],
  "orders": { "story": ["prophecy", "part1", "part2"] }
}
```

- An entry is a movie, a whole series, or one season (`"type": "tv", "season": 2`). Episode-level entries are out of scope.
- Release order is **computed** from TMDB dates, never written by hand. `orders.story` lists every `ref`; an optional third order has a display name.
- `scripts/build-franchises.mjs` resolves each entry to a TMDB id by title and year, fails loudly on anything ambiguous or missing, checks that every order contains each `ref` exactly once, and writes `src/discover/franchises/data.json` (ids only, plus names for offline display). The app reads only the built file. Unreleased entries are allowed when TMDB lists them.
- **Accuracy rule:** story orders are the reason this feature exists. Each one must be checked against a public reference whose URL is recorded in `sources`. Do not write an order from memory. Where fans disagree (the MCU, Star Wars with its series), pick the studio's official timeline when one exists and say so in the blurb.
- Launch set, at least 25. Film and TV: Marvel Cinematic Universe · Star Wars · Star Trek · DC Extended Universe · X-Men · Spider-Man (all eras) · Batman (all eras) · Middle-earth · Wizarding World · Dune · Alien & Predator · Planet of the Apes · MonsterVerse · Jurassic Park · The Matrix · Terminator · Mad Max · Blade Runner · Mission: Impossible · James Bond · Fast & Furious · John Wick · The Hunger Games · Game of Thrones · Breaking Bad universe · The Walking Dead · The Witcher. Anime: Dragon Ball · Naruto · One Piece (series and films) · Attack on Titan · Demon Slayer · Jujutsu Kaisen · Evangelion · Fate · Monogatari · Mobile Suit Gundam (Universal Century).
- Studio Ghibli and similar "by studio" groupings are Top Lists (TMDB `with_companies`), not collections, because they have no order.

### 9.3 Collections tab
- Search field (franchises by name, then TMDB `/search/collection`).
- Rows: **Continue** (collections the user has started) · **In your library** · **Franchises** · **Anime sagas** · **Popular movie collections** (a fixed list of TMDB collection ids resolved by the build script).
- A collection tile: wide artwork, name, "9 movies · 3 series", progress ring when started.

### 9.4 Collection page
- Hero: backdrop, name, blurb, counts, total runtime of movies, progress ("5 of 12 watched"), buttons **Play next** (when the next entry is owned) or **Next up: <title>**, **Follow** (adds its Next up to Home), **Add all to watchlist**.
- **Order switch:** Release order · Story order (· third order if defined). The choice is remembered per collection (`collection_state`). Switching animates entries to their new positions (§11.2).
- **Timeline:** a numbered vertical list. Each entry: poster, title, year, type badge (Movie, Series, Season 2), the note if any, both ratings, and its state:
  - **In your library** → Play / Resume button, real progress for series and seasons.
  - **Watched** → tick (manual mark, or derived from the library).
  - **On your watchlist** / none → the usual Watchlist and Watched actions.
  - **Not released yet** → date.
- **Next up** = the first entry in the chosen order that is released and not watched. It is visually marked and is where the page scrolls on open.
- For a title not in the library, a season entry takes its watched state from the series as a whole (documented limit; see non-goals).
- Movie collections from TMDB use the same page with release order only.

### 9.5 Links from elsewhere
- **Title pages** (TMDB and library): a "Part of **Dune**" strip under the hero with the neighbouring entries in the user's chosen order, the current one highlighted, and a link to the collection. A movie that belongs to a TMDB collection but no franchise shows the TMDB collection.
- **Cards:** no badge (too noisy).
- **Home:** "Next up in your collections" (§5.4).
- **After playback** of the last episode or a movie that is a collection entry: the existing up-next panel offers the next owned entry in the chosen order.

### 9.6 Acceptance criteria
- C1. Every launch franchise opens with all entries resolved, artwork present, and both orders available; the build script exits non-zero on any unresolved entry.
- C2. Release order equals ascending TMDB date for every franchise (automated test over the built file plus cached dates).
- C3. Switching order re-sorts the same entries (same count before and after) and the choice survives a restart.
- C4. For Star Trek, TNG shows as In your library with its real watched progress, and Play next starts the correct file.
- C5. Marking entries watched moves Next up immediately; marking all gives 100 % and removes the collection from Home's row.
- C6. A movie in a TMDB collection shows the "Part of" strip; opening it lists every part in release order.
- C7. Offline, a previously opened collection renders fully from the built file and caches.

## 10. Global search, people, and Coming Soon

### 10.1 Global search (P0)
- A search field in the top bar (`/` focuses it). Typing opens the search page; results update as you type (250 ms).
- Sections, in order: **In your library** (titles, then episodes — today's `Search.tsx` logic) · **Collections** (franchises by name, then TMDB collections) · **Series and movies** (TMDB `/search/multi`) · **People** (TMDB). Empty sections are omitted. The library section works offline; the others show one quiet "offline" line.
- Type switch and "Hide what I own" apply to the TMDB section. Enter on the first result opens it.

### 10.2 Person page (P1)
Clicking a cast member (today not clickable) or a person result opens a page: photo, name, known for, and their titles as a poster grid split into Acting and Directing/Creating, sorted by popularity, with the usual card states and actions. Source: `/person/{id}` with `combined_credits`.

### 10.3 Coming Soon (P1)
Discover → Coming Soon. Three parts: **From your list** (watchlist titles not yet released, by date; and next episodes of series on the watchlist or in the library, from `next_episode_to_air`) · **This month** · **Later**, grouped by month with date headers. Released items get an **Out now** badge for 14 days and feed Home's "Out now from your list" row. No Windows notifications in this release.

### 10.4 Acceptance criteria
- G1. One query returns library, collection, TMDB and people results in that order; a title that is owned appears once, in the library section.
- G2. Offline, library results still appear within 100 ms of typing.
- G3. (P1) A person page lists their titles and each card behaves like any other card.
- G4. (P1) A watchlist title with a future date appears under From your list in date order and gains Out now on its release day.

## 11. Design and motion standard

The app is meant to be shown to other people. "Works" is not the bar; this section is.

### 11.1 Motion tokens (define once in `src/styles/base.css`, use everywhere)

| Token | Value | Use |
|---|---|---|
| `--t-fast` | 120 ms | hover colour, button press, badge swap |
| `--t-base` | 200 ms | menus, chips, toasts, tab indicator |
| `--t-slow` | 320 ms | cards growing, panels, order switch |
| `--t-page` | 480 ms | page cross-fade, hero image change |
| `--ease` | existing | everything that enters or moves |
| `--ease-out-soft` | `cubic-bezier(.2, .8, .2, 1)` | things settling into place |

### 11.2 Patterns (each has one implementation, reused)

| Pattern | Rule |
|---|---|
| Page change | Existing View Transitions cross-fade and card-to-hero morph. New pages opt in (collection tile → collection hero, list tile → list header). |
| Rows and grids appearing | Items fade and rise 8 px, staggered 30 ms, at most 12 items staggered, only the first time they enter the viewport. |
| Images | Never pop. Reserve the box (aspect ratio), show the skeleton, fade the image in over `--t-base` after it has decoded. |
| Skeleton → content | Same size and position as the content; cross-fade; no reflow. |
| Card hover | Keep v1.2.1 behaviour exactly (no neighbour movement). Poster cards lift 4 px with a ring; actions fade in. `scripts/hover-probe.mjs` must still report 0 px drift. |
| Sub-menu and tabs | One sliding underline indicator that moves between items. |
| Filter chips | Enter with scale .9 → 1 and fade; leave by collapsing width; the row never jumps. |
| Order switch (collections) | Entries move to their new places (FLIP: measure, transform, release) over `--t-slow`; numbers count to their new values. |
| Counts and progress | "37 of 250" rolls; progress bars and rings animate from the previous value. |
| Menus, dialogs, toasts | Existing `pop` and `toastIn`. Dialogs scale .98 → 1 with fade. No `backdrop-filter` on full-window layers. |
| Hero | Cross-fade between images; a 20 s, 3 % slow zoom on the still image, paused when the window is not focused. |
| Rank numerals | Large outlined numerals; on hover the outline fills. |

### 11.3 Budgets and rules
- Animate only `transform` and `opacity` (and `clip-path` where already used). Never animate layout properties or `box-shadow` (use a separate shadow layer, as the cards do).
- 60 fps target on integrated graphics; on the owner's machine no frame over 25 ms during: row scroll, grid scroll with 600 cards, order switch with 40 entries, opening a menu. Extend `hover-probe.mjs` into a general `scripts/frame-probe.mjs` that records frame times for a scripted interaction.
- No layout shift after first paint of a page: a probe records element positions at first paint and after images load; movement over 1 px fails.
- Input is never blocked by an animation; anything can be clicked mid-transition.
- `prefers-reduced-motion`: cross-fades only, no movement, no zoom, no stagger.
- **Layering scale** (two overlap bugs were fixed in 1.3.0 because layers were chosen ad hoc). Define and use only these: `--z-row-hover: 3` · `--z-raised: 4` (boxes that sit over a row's hover area) · `--z-sticky: 10` (filter bar, sub-menu) · `--z-menu: 20` (dropdown panels, always inside a `--z-sticky` or higher parent) · `--z-topbar: 30` · `--z-modal: 40` · `--z-toast: 50`. Replace existing literals.
- **Grids:** children of every CSS grid get `min-width: 0`; cards are `width: 100%` (a `<button>` sizes to its content otherwise — the cause of the overlapping posters fixed in 1.3.0).

### 11.4 States every page must have
Loading (skeleton in the final layout) · Empty (one sentence and one action) · Error (what failed, Retry) · Offline (cached content plus a quiet strip) · No TMDB key (what it enables, button to Settings). A checklist table of page × state goes into PLAN.md and is ticked off with a screenshot each.

### 11.5 Layout, type and input
- Layouts hold from 1024 × 640 to 3840 × 2160. Grids cap card width (posters 150–210 px) and add columns rather than scaling cards up; text columns cap at about 70 characters.
- Text is never cut mid-word without an ellipsis, and anything cut has a tooltip with the full text.
- Body text contrast at least 4.5 : 1; controls at least 32 × 32 px; visible focus ring on every focusable element.
- **Keyboard:** Tab reaches everything in visual order. In rows and grids, arrow keys move focus between cards, Enter opens, `W` toggles Watched, `L` toggles Watchlist on the focused card. `/` search, `Esc` back or close, `g` then `h` / `l` / `d` / `m` jumps to Home / Library / Discover / My List. The shortcuts overlay in the player gains a browse section, opened with `?`.
- One icon family (the existing `icons.tsx` stroke set); no emoji; no text glyphs as icons (replace the `+` and `×` characters used as buttons with icons).

### 11.6 Acceptance criteria
- D1. `frame-probe` passes the four budgets in §11.3 on the release build.
- D2. The layout-shift probe passes on Home, Discover (each tab), a Top List, a Collection, My List, a title page.
- D3. Every page × state in the checklist has a screenshot in `docs/screens/2.0/`.
- D4. With reduced motion on, no element translates or scales during navigation, hover, or the order switch.
- D5. Every action available by mouse on Browse, a Top List and a Collection page can be done with the keyboard alone.
- D6. No literal `z-index` values remain outside the token definitions (grep).
- D7. At 1024 × 640 and at 3840 × 2160 no page has horizontal scrolling, overlapping elements, or cards wider than their cap.

## 12. Data model

New migration `src-tauri/migrations/006_discover2.sql`, registered in `src-tauri/src/lib.rs`. Never edit an applied migration.

```sql
-- TMDB responses kept on disk (list pages, collections, people), so lists and
-- collections reopen instantly and work offline. Caller decides freshness.
CREATE TABLE api_cache (
  key        TEXT PRIMARY KEY,      -- path + sorted params
  fetched_at INTEGER NOT NULL,
  body       TEXT NOT NULL          -- JSON, already reduced to Item[] or the fields used
);

-- Link between TMDB titles and IMDb ids, both directions.
CREATE TABLE ext_ids (
  tmdb_type  TEXT NOT NULL,
  tmdb_id    INTEGER NOT NULL,
  imdb_id    TEXT,                  -- NULL = looked up, none exists
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (tmdb_type, tmdb_id)
);
CREATE INDEX ext_ids_imdb ON ext_ids (imdb_id);
-- IMDb ids TMDB does not know (so /find is not repeated).
CREATE TABLE imdb_unmatched (tconst TEXT PRIMARY KEY, checked_at INTEGER NOT NULL);

-- IMDb ratings, imported on this PC from IMDb's public files (opt-in).
CREATE TABLE imdb_titles (
  tconst   TEXT PRIMARY KEY,
  kind     TEXT NOT NULL,           -- 'movie' | 'series'
  title    TEXT NOT NULL,
  year     INTEGER,
  runtime  INTEGER,
  genres   TEXT,                    -- comma-separated IMDb genre names
  rating   REAL NOT NULL,
  votes    INTEGER NOT NULL,
  weighted REAL NOT NULL
);
CREATE INDEX imdb_rank ON imdb_titles (kind, weighted DESC);
CREATE INDEX imdb_votes ON imdb_titles (kind, votes DESC);

-- Per-collection choices. key = 'franchise:dune' | 'tmdb:10' (TMDB collection id).
CREATE TABLE collection_state (
  key       TEXT PRIMARY KEY,
  order_id  TEXT,                   -- 'release' | 'story' | custom
  followed  INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER
);

CREATE TABLE saved_filters (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  params     TEXT NOT NULL,         -- JSON of the Browse filter state
  created_at INTEGER NOT NULL
);
```

- **TMDB's six-month rule.** TMDB's terms forbid keeping its data cached for more than six months. `api_cache` rows older than 180 days are deleted at start-up. The watchlist already refreshes weekly; extend the same refresh to `seen` rows (name, poster, date) so no stored TMDB data goes stale beyond the limit, and re-fetch `rec_cache` rows on the same schedule they already have.
- Settings keys: `onboarded`, `discover_tab`, `browse_filters`, `rating_source`, `imdb_enabled`, `imdb_data_at`, `imdb_count`, `type_filter`.
- `Item` gains `imdbId?: string`, `imdbRating?: number`, `imdbVotes?: number`, filled when known. `Detail` gains `collection: { id: number; name: string } | null` and `imdbId`.
- Posters for Top Lists and Collections are remote images (as in Discover today), with the title placeholder on failure. Collection pages the user has **followed** cache their posters to disk (`cache_tmdb_image`) so the Home row renders offline.

## 13. Ready to share

The owner wants to give the installer to other people. Each item below is something that works on the owner's PC today only because of how that PC is set up.

### 13.1 First run (P0)
A full-window, five-step setup shown when `onboarded` is not set. Every step can be skipped; all of it can be re-run from Settings → General.

1. **Welcome** — one sentence on each job (watch what you own; find what's next).
2. **Your library** — Add a folder, or "I'll do this later". Scanning starts in the background and setup continues.
3. **Artwork and Discover** — why a free TMDB key is needed, three numbered steps with an "Open TMDB" button, a paste box that verifies the key (existing `testTmdbKey`). Skipping leaves the library working and Discover explaining what it needs.
4. **IMDb ratings (optional)** — what it adds, that it downloads about 240 MB once and keeps roughly 100,000 ratings, that the data stays on this PC, with Enable / Not now.
5. **What have you watched?** — the existing quick picker (only if a key was given).

Then Home. A returning v1.3 user (database already has titles or a key) skips setup and sees a one-time "What's new in 2.0" card instead.

### 13.2 No hidden requirements (P0)
- **ffmpeg / ffprobe.** Ship them with the app: add `ffmpeg.exe` and `ffprobe.exe` (an LGPL build) to the bundle resources next to the libmpv files, and resolve the path at run time — bundled copy first, then PATH. If neither is found the app still scans by file name, plays everything, and shows one line in Manage: "Thumbnails and durations need ffmpeg." Record the installer size before and after.
- **WebView2.** Confirm the NSIS bundle uses Tauri's download bootstrapper so a PC without WebView2 gets it during install.
- **No owner-specific values** in the build: no seeded folders (the env-var hooks stay, dev only), `authors` in `Cargo.toml` set properly, no absolute paths in code. Do **not** change the app identifier `com.offplayer.app` — it decides the data folder, and changing it would orphan the owner's database.
- **TMDB key.** Each person uses their own free key (default). One shared key inside the installer would expose it to anyone who unpacks the app and ties every copy to the owner's TMDB account; see §15, question 1.

### 13.3 About, credits and privacy (P0)
Settings → About:
- App name, version, "Check for updates" (opens the releases page if a URL is configured in `tauri.conf.json`; hidden otherwise).
- **Credits required by the data sources:** the TMDB logo (one of TMDB's approved versions, less prominent than the app's own mark) with "This product uses the TMDB API but is not endorsed or certified by TMDB."; "Availability data by JustWatch." (already on title pages); "Information courtesy of IMDb (https://www.imdb.com). Used with permission."
- **Licences** of bundled software: mpv / libmpv, ffmpeg, Tauri, React, the Geist font, and Rust and npm dependencies (generate the list at build time), with a note on where the source of the LGPL/GPL components can be obtained.
- **Privacy, in plain words:** no account; nothing about what you own or watch leaves this PC; the app contacts only `api.themoviedb.org`, `image.tmdb.org`, and (if enabled) `datasets.imdbws.com`; trailers and "where to watch" open in your browser.
- **Use:** TMDB's and IMDb's terms allow personal, non-commercial use only. The app must stay free; say so on this page.

### 13.4 Data safety (P0 backup, P1 export)
- Before applying any new migration, copy `offplayer.db` to `backups\offplayer-<version>-<date>.db` and keep the three most recent. (During 1.3.0 testing the database was backed up and restored by hand; make it automatic.)
- **Export my data / Import** (P1): one JSON file with watch history, watchlist, watched titles and reactions, dismissed suggestions, collection choices, saved filters and settings (never the TMDB key unless the user ticks a box).
- **Import from IMDb** (P1): read an IMDb "Your ratings" or watchlist export (CSV with `Const` = `tconst`), map through `/find`, add rated titles to Watched (10–8 → Loved it, 7–6 → Liked it, 5 and below → Not for me) and watchlist rows to the watchlist. Shows a preview with counts before applying.

### 13.5 Robustness (P0)
- One request queue for TMDB: at most 8 in flight, identical requests shared, HTTP 429 honoured with `Retry-After`, exponential back-off on network errors, and a visible offline state instead of per-row errors.
- The error boundary shows a page with "Go home" and "Copy details", not a blank window.
- A database from a newer version (migration number higher than the build knows) shows a clear message instead of failing to start.

### 13.6 Distribution notes (documentation, not code)
- The installer is unsigned, so Windows SmartScreen shows "Windows protected your PC" and the recipient must click **More info → Run anyway**. Put this, with a screenshot, in a short `docs/INSTALL.md` to send with the installer. Buying a code-signing certificate removes the warning; that is a cost decision for the owner (§15, question 4).
- No auto-update in this release.

### 13.7 Acceptance criteria
- S1. On a clean Windows user profile with no ffmpeg on PATH and no app data, the installer runs, setup appears, and both paths work: skip everything → usable Library empty state and Discover explaining the key; complete everything → library scanned with thumbnails, Discover populated.
- S2. With `ffmpeg` removed from PATH, scanning, thumbnails and scrub previews still work using the bundled copies.
- S3. About shows all three credits, the licence list, the privacy statement and the version.
- S4. Upgrading a v1.3.0 database creates a backup file and keeps every title, watch position, list entry and setting.
- S5. Network log during a full session contains only the hosts listed in §13.3.
- S6. Pulling the network cable mid-session produces the offline strip, not error dialogs; reconnecting recovers without a restart.
- S7. (P1) Export then Import on a fresh profile reproduces lists, watched titles and reactions exactly.

## 14. Implementation notes

### 14.1 Suggested structure

```
src/discover/
  api.ts            + discover(), collection(), person(), searchAll(), externalIds(), findByImdb()
  queue.ts          request queue, de-duplication, 429 handling, offline detection
  cache.ts          api_cache read/write with a max age per call
  filters.ts        filter state ⇄ TMDB params (pure, tested)
  toplists.ts       list definitions (§7.2)
  imdb.ts           import job, lookups, useImdbRating(), weighted lists
  franchises/       source/*.json, data.json (built), index.ts (types, lookups, orders — pure, tested)
src/pages/
  Library.tsx  Browse.tsx → DiscoverBrowse.tsx  TopLists.tsx  TopListPage.tsx
  Collections.tsx  CollectionPage.tsx  PersonPage.tsx  ComingSoon.tsx  Search.tsx (global)
  SettingsPage.tsx  Onboarding.tsx
src/components/
  SubNav.tsx  FilterBar.tsx  RatingPair.tsx  RankCard.tsx  Timeline.tsx  ProgressRing.tsx  PartOfStrip.tsx
src-tauri/src/imdb.rs     imdb_sync (stream, gunzip, filter, batch)
scripts/
  build-franchises.mjs  resolve-keywords.mjs  frame-probe.mjs  shift-probe.mjs
```

The existing `src/pages/Browse.tsx` (library grid) becomes the body of Library's tabs; name the new Discover page distinctly to avoid confusion.

### 14.2 Pitfalls already hit in this codebase
1. Schema changes need a Rust rebuild; dev and release builds share one database. A build without migration 006 refuses a database that has it. Back up before testing and restore after (§14.3).
2. `tmdb_get` rejects paths with characters outside letters, digits, `/`, `_`, `-`. `/find/tt0111161`, `/collection/10`, `/watch/providers/movie` are fine; every `x.gte` goes in the query.
3. Do not call `getProperty(..., "node")` on the mpv plugin (native crash); pass track ids as strings. Do not tidy those call sites.
4. React StrictMode is off on purpose; module-level stores must tolerate hot reload re-running effects.
5. A `<button>` inside a `<button>` is invalid; card actions are siblings inside `div.dcard`.
6. Avoid `backdrop-filter` on full-window overlays.
7. Row cards must not move their neighbours on hover.
8. A row's track extends 230 px below itself for hover room and paints over whatever follows unless that element is positioned on a higher layer (§11.3 layering scale).
9. Buttons used as grid items size to their content; give them `width: 100%; min-width: 0`.
10. `tauri-plugin-sql` pools connections: multi-statement transactions across separate calls are not safe. Use single statements (multi-row inserts) or one `execute` containing the whole batch.
11. SQLite allows at most 32,766 bound parameters per statement; size insert batches accordingly.
12. `cargo` is not on PATH in the agent's shell; prepend `%USERPROFILE%\.cargo\bin`.

### 14.3 Verification rules
- The owner is often at the PC and now has real data in the app. Before any test session: check nothing is playing, close the app, **copy `offplayer.db` aside**. After: close the dev app, restore the copy, relaunch the release build without the debug port. Say that this was done.
- Test muted and through the debugging port (`OFFPLAYER_START_MUTED=1`, `scripts/cdp.mjs`, `scripts/at.mjs`); never the real mouse or sound.
- The clean-profile test (S1) needs a second Windows user or a VM; if neither is available, simulate with a temporary `APPDATA` and a PATH without ffmpeg, and say which was done.
- Finish each milestone with `npm test`, `npx tsc --noEmit`, `npm run tauri build`, and an entry in PLAN.md.

### 14.4 Tests to add (Vitest)
- `filters.ts`: every filter to its TMDB parameters for movies and for series; anime; vote floors when sorting by rating; round-trip of saved filter state.
- Top lists: every definition has valid parameters, unique id, and a size; IMDb weighted-rating maths; list ranking with seen / owned hiding keeps original ranks.
- Franchises: built file validates (every order is a permutation of the entries; release order ascending by date; no duplicate ids; every franchise has a source URL).
- Collections: Next up for combinations of owned / watched / unreleased; season entries; progress.
- IMDb import: TSV parsing with `\N`, type and vote filtering, batch sizing, table swap on failure (Rust unit tests for the parser and filter).
- Queue: de-duplication, concurrency cap, 429 back-off.
- Search: section ordering and de-duplication of owned titles.

## 15. Open questions (defaults chosen so work can start)

| # | Question | Default in this PRD |
|---|---|---|
| 1 | Should a shared copy include the owner's TMDB key so recipients skip that step? | **No.** Each person adds their own free key in setup. A bundled key can be extracted by anyone and is tied to the owner's TMDB account. |
| 2 | Is IMDb data on by default? | **No, opt-in** (240 MB download, and IMDb's terms are personal-use). Offered in setup and Settings. |
| 3 | Bundle ffmpeg in the installer? | **Yes** (LGPL build). Larger installer; nothing for the recipient to install. |
| 4 | Buy a code-signing certificate to remove the SmartScreen warning? | **No**; document the warning in `docs/INSTALL.md`. |
| 5 | Top Lists and Collections as Discover tabs or as top-bar items? | **Discover tabs**, keeping the top bar at four items. |
| 6 | Which rating shows on posters by default once IMDb data is installed? | **TMDB**, with a setting to switch; title pages always show both. |
| 7 | How is "anime" defined? | Animation with original language Japanese. |
| 8 | Which story order when fans disagree? | The studio's official timeline when one exists; otherwise the most widely cited, with the source recorded. |
| 9 | Auto-update? | **Not in 2.0.** A "Check for updates" link if a releases URL is configured. |
| 10 | Is this release numbered 2.0.0, or a series of 1.x releases? | Milestones ship as 1.4–1.7 builds for the owner; the shareable release is **2.0.0**. |

## 16. Later (not in scope)

Release notifications in Windows · missing-episode detection for owned shows · Trakt and Letterboxd import · shuffle / random episode · viewing statistics and a yearly summary · user-made collections and custom orders · episode-level entries in franchises (anime arcs) · skip intro and credits · subtitle download · mini player · macOS / Linux builds · interface translations · auto-update with signed releases.

## 17. Delivery plan

Each milestone ends with a release build the owner can use. Priorities: **P0** must ship in 2.0; **P1** should; anything unfinished at M6 moves to §16 with a note.

| Milestone | Scope | Done when |
|---|---|---|
| **M1 — Structure** (1.4.0) | Migration 006 and automatic backup; request queue and `api_cache`; layering and motion tokens; new top bar, Library page, Discover sub-menu, Settings page; global search (P0 part) | N1–N5, G1–G2, D6, S4 pass; nothing from 1.3 lost |
| **M2 — Browse** (1.5.0) | Filter bar, endless grid, chips, saved filters, anime type everywhere | F1–F7 pass |
| **M3 — Top Lists** (1.5.x) | List definitions, keyword script, gallery, list page with progress and views (TMDB ranking) | T1–T5 pass |
| **M4 — IMDb** (1.6.0) | Import job, `ext_ids` linking, ratings on pages and cards, IMDb-ranked lists, source switch; P1: IMDb-mode Browse, IMDb import file | I1–I7, T6 pass |
| **M5 — Collections** (1.7.0) | Franchise source files and build script (≥ 25, sources recorded), Collections tab, collection page with orders and timeline, "Part of" strip, Home row, up-next hand-off | C1–C7 pass |
| **M6 — Finish and share** (2.0.0) | Onboarding, bundled ffmpeg, About / credits / privacy, robustness items, every page × state, keyboard, probes, `docs/INSTALL.md`; P1: person page, Coming Soon, export / import | D1–D5, D7, S1–S3, S5–S6 pass (and G3–G4, S7 if P1 done); installer built, clean-profile test recorded |

## 18. References

- TMDB API reference — Discover movie: https://developer.themoviedb.org/reference/discover-movie · Discover TV: https://developer.themoviedb.org/reference/discover-tv · Collection details: https://developer.themoviedb.org/reference/collection-details · Find by id: https://developer.themoviedb.org/reference/find-by-id
- TMDB API terms of use (non-commercial, attribution, six-month cache limit, no ML/AI use): https://www.themoviedb.org/api-terms-of-use
- IMDb non-commercial datasets (files, columns, daily refresh): https://developer.imdb.com/non-commercial-datasets/ · download host https://datasets.imdbws.com/
- IMDb conditions and required credit line: https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX
