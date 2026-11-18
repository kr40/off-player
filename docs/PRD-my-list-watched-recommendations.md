# PRD: My List, Already Watched, and For You

**Product:** Off Player (desktop, Windows) · **Baseline:** v1.2.1 · **Target:** v1.3.0
**Status:** Implemented in v1.3.0 (see PLAN.md → "My List, Already watched, For You") · **Written:** 2026-11-17
**For:** the implementing engineer/agent. Read [PLAN.md](../PLAN.md) (design and history of every phase) and [README.md](../README.md) (run, test, tooling) first.

---

## 1. Summary

Off Player plays the user's local library and lets them browse TMDB in a Discover tab. Today a title saved from Discover only appears as a row on Home and Discover, and the app knows nothing about what the user has watched *outside* their library.

This release adds three connected things:

1. **My List** — a dedicated section for the watchlist, instead of only rows.
2. **Already watched** — one click on any title to say "I've seen this", plus a place to review those titles.
3. **For You** — suggestions of series and movies derived from what the user has watched.

## 2. Goals and non-goals

**Goals**
- The watchlist has its own page with sorting, filtering and release status.
- Marking a title as watched takes one click from any poster or detail page.
- After marking a handful of titles, the user gets relevant suggestions with a visible reason ("Because you watched…").
- Everything works with the existing TMDB key; no new accounts or keys.
- Lists and the last suggestions remain visible offline.

**Non-goals (this release)**
- Playing or acquiring titles that are not in the library. Discover remains browse-only.
- Syncing with external services (Trakt, Letterboxd, IMDb).
- AI/LLM-generated suggestions (decided against for this release; see §10, question 1).
- Per-episode "seen" tracking for titles outside the library.
- Multiple user profiles.

## 3. Users and key scenarios

Single user on their own PC, with a small local library (currently 3 series) and broad viewing history elsewhere.

1. *"I saved a few shows last week; where are they?"* → opens **My List**, sees them newest first, notices one is now released.
2. *"I've already seen Breaking Bad."* → hovers its poster in Discover, clicks **Watched**. It gets a Watched badge and stops being suggested.
3. *"What should I watch next?"* → opens **For You**, sees "Top picks for you" and "Because you watched The Office".
4. *First run of the feature* → a quick picker lets them tick 5–10 things they've seen so suggestions start immediately.

## 4. Current state (what exists in v1.2.1)

| Area | Where | Notes |
|---|---|---|
| Navigation | `src/app/nav.tsx` (`Route` union), `src/app/Shell.tsx`, `src/app/TopNav.tsx` | Top bar: Home, Series, Movies, Discover + Search and Library icons. Pages are kept mounted in a stack. |
| Watchlist store | `src/library/watchlist.ts` | `useWatchlist()`, `toggleWatchlist(item)`, `onWatchlist()`. One in-memory copy shared by all cards. |
| Watchlist table | `src-tauri/migrations/004_watchlist.sql` | `(tmdb_type, tmdb_id)` PK, name, poster, `poster_local`, backdrop, date, overview, rating, votes, added_at. |
| TMDB browsing | `src/discover/api.ts` | `Item`, `lists.*`, `details()`, `byCategory()`, `CATEGORIES`; 30-min session cache. |
| TMDB transport | `tmdb()` in `src/library/metadata.ts` → Rust `tmdb_get` (`src-tauri/src/artwork.rs`) | Host-pinned to api.themoviedb.org; path may contain only letters, digits, `/`, `_`, `-`. |
| Poster card | `src/components/browse/DiscoverCard.tsx` | Wrapper `div.dcard` containing the poster button and a separate hover `+` button. |
| TMDB detail page | `src/pages/TmdbPage.tsx` | Hero buttons: Watch trailer, + Watchlist, View on TMDB. |
| Library watch state | `src/library/progress.ts`, table `playback` | Per-file position / watched flag, keyed by file fingerprint. Library titles carry `tmdb_id` + `tmdb_type` in `titles`. |
| Home rows | `src/pages/Home.tsx` | Continue watching, Your watchlist, Your series, Top-rated episodes, Seasons. |

## 5. Feature A — My List (dedicated watchlist section)

### 5.1 Entry points
- New top-bar item **My List**, after Discover. Route `{ page: "mylist"; tab?: "watchlist" | "watched" }`.
- The existing "Your watchlist" rows on Home and Discover stay, capped at 12 cards, with a **See all** link in the row header that opens My List.

### 5.2 Page layout
- Header: title "My List", count, and two tabs: **Watchlist** (default) and **Watched** (§6.4).
- Controls (right side): type switch All / Series / Movies; status switch All / Released / Coming soon; sort menu.
- Body: poster grid (reuse `.pgrid` and `DiscoverCard`).

### 5.3 Behaviour
| Item | Requirement |
|---|---|
| Sort | Date added (default, newest first), Release date, Name A–Z, TMDB rating. Remember the choice (`settings` key `mylist_sort`). |
| Status | "Coming soon" = release/first-air date in the future. Card badge shows the date; released items show the rating. |
| In-library titles | If a saved title is now in the library (match on `tmdb_type` + `tmdb_id`), show "In your library" and open the library page. Do not auto-remove it. |
| Remove | Tick button on the card (existing behaviour). Show an **Undo** toast for 5 s. |
| Mark watched | Card action "Watched" (§6.2). Marking watched removes the title from the watchlist (with Undo). |
| Refresh | Saved data goes stale (dates move, posters change). When My List opens and the device is online, refresh any entry whose `refreshed_at` is older than 7 days via `details()`; max 4 concurrent requests; silent on failure. |
| Empty state | "Nothing saved yet. Find something in Discover." with a button to Discover. |
| Offline | Page renders fully from the database and cached posters. |

### 5.4 Acceptance criteria
- A1. My List appears in the top bar and opens a grid of every saved title.
- A2. Sort and both switches work together; the sort choice survives an app restart.
- A3. Removing shows Undo; Undo restores the entry in its original position.
- A4. A title whose date has passed since it was saved shows as Released after a refresh.
- A5. With the network disabled, the page still shows every poster.
- A6. Home and Discover rows show at most 12 cards and a working See all link.

## 6. Feature B — Already watched

### 6.1 Concept
A **watched set**: titles the user has seen anywhere. It has two sources:

| Source | How it enters the set | Weight as a suggestion seed |
|---|---|---|
| Manual | User clicks Watched on a TMDB title | 1.0 |
| Library, finished | Library movie watched, or a series with every owned episode watched | 1.0 |
| Library, in progress | Series with ≥ 3 episodes or ≥ 20 % of owned episodes watched | 0.6 |

Library entries are **derived at read time** from `playback` joined to `files`/`titles`; they are not copied into the new table, so they can never drift from real watch state. Titles without a TMDB match are ignored.

Optional **reaction** on any manually watched title: Loved it / Liked it (default) / Not for me. Reactions change seed weight (§7.2).

### 6.2 Where the control appears
| Surface | Control |
|---|---|
| `DiscoverCard` (hover) | Second round button under the `+`: an eye/check icon, tooltip "I've watched this". Filled when set. |
| `TmdbPage` hero | Button **Watched** / **✓ Watched** beside + Watchlist. When set, show the three reactions inline. |
| My List → Watchlist cards | Same hover button; also removes from the watchlist. |
| Library title page | No new control. The existing "Mark all episodes as watched" already feeds the set. |

Rules:
- Toggling is instant and optimistic; show an Undo toast.
- A watched title shows a small **Watched** badge on its poster everywhere in Discover.
- Setting Watched removes the title from the watchlist. Unsetting does not re-add it.
- Hover buttons must be siblings of the poster button, not nested inside it (see §9, pitfall 5).

### 6.3 Quick picker (seeding)
Opened from the For You empty state and from My List → Watched ("Add titles").
- A dialog with a search box and a grid of popular titles (`/trending/all/week` + `/tv/top_rated` + `/movie/top_rated`, de-duplicated, library titles excluded).
- Click toggles selection; a counter shows "7 selected"; **Done** saves all at once.
- No minimum, but copy encourages "Pick at least 5 for better suggestions".

### 6.4 Watched tab (in My List)
- Grid of manually watched titles, newest first; sort by Date marked / Name / Your reaction.
- Card shows the reaction; clicking the card opens the TMDB page; hover button un-marks.
- A collapsed section "From your library" lists the derived titles (read-only, links to library pages).

### 6.5 Settings
In Settings → Library:
- "Hide titles I've watched in Discover rows" (default **off**; when off they stay visible with a badge).
- "Clear watched list" (two-step confirm, same pattern as Clear watch history). Does not touch library playback.

### 6.6 Acceptance criteria
- B1. One click on a Discover poster marks it watched; the badge appears without a reload and persists after restart.
- B2. Marking watched from the watchlist removes it there; Undo reverses both.
- B3. A library series with all owned episodes watched appears under "From your library" without any manual action, and disappears if episodes are marked unwatched.
- B4. The quick picker saves multiple selections in one action and can be reopened.
- B5. With "Hide watched" on, watched titles are absent from Discover rows and search results are unaffected.

## 7. Feature C — For You (suggestions)

### 7.1 Where it appears
- **Discover**, new first rows (below "Your watchlist"): "Top picks for you", then up to three "Because you watched *X*" rows.
- **Home**: one "Top picks for you" row after Continue watching (max 12 cards, See all → Discover).
- Each card's tooltip and the detail page show the reason: "Because you watched A and B".
- Card hover gets a third action, **Not interested**, which removes the card and never suggests it again.

### 7.2 How suggestions are produced
Source: TMDB's own `/{type}/{id}/recommendations` for each seed. No extra service.

1. **Seeds** = the watched set (§6.1). Use at most 40: all "Loved it", then most recently marked/played.
2. **Seed weight** = source weight × reaction factor (Loved 2.0, Liked 1.0, Not for me −1.0).
3. **Fetch** page 1 of recommendations per seed (20 candidates). Cache per seed in the database for 7 days; refresh in the background, 4 requests at a time.
4. **Score** each candidate:

   `score = Σ over seeds ( seedWeight × 1 / (1 + rank / 8) ) + genreAffinity + quality`

   - `rank` = position in that seed's list (0-based).
   - `genreAffinity` (0 to 0.5) = overlap between the candidate's genres and the user's genre profile (weighted share of each genre across seeds).
   - `quality` (0 to 0.3) = scaled TMDB rating, only when vote count ≥ 200.
   - Candidates with a non-positive total are dropped.
5. **Exclude**: watched set, library titles, dismissed titles. Titles already on the watchlist are excluded from "Top picks" (the user already knows them).
6. **Diversify** "Top picks": no more than 3 consecutive cards of the same type, and no more than 5 cards whose strongest seed is the same title.
7. **Reasons**: store the top two contributing seeds per candidate.
8. "Because you watched X" rows: the three most recent seeds with weight ≥ 1.0, each showing that seed's own list after exclusions.

The scoring step must be a **pure function** (`seeds + cached lists + exclusions → ranked list with reasons`) in its own module so it can be unit-tested without the network.

### 7.3 States
| State | Behaviour |
|---|---|
| Fewer than 3 seeds | Replace the rows with a card: "Tell us what you've watched to get suggestions" → opens the quick picker. |
| Loading first time | Skeleton cards (existing `.dskel`). |
| Offline | Show the last computed list from the cache; no error. Suggestion posters are remote images, so a card whose image fails to load shows a placeholder with the title instead of a broken image. |
| No TMDB key | Hidden (Discover already explains the key requirement). |
| Seeds changed | Recompute immediately from cache, fetch missing seeds in the background, update rows when done. |

### 7.4 Acceptance criteria
- C1. With ≥ 3 seeds, "Top picks for you" shows at least 10 titles, none of which is watched, in the library, or dismissed.
- C2. Every suggestion exposes a reason naming one or two seeds.
- C3. Marking a suggestion Watched or Not interested removes it within one render and it does not return after restart.
- C4. Reacting "Not for me" to a seed lowers or removes titles that came only from that seed (covered by a unit test).
- C5. After suggestions have loaded once, they still appear with the network disabled.
- C6. Opening Discover with 40 seeds issues no more than 40 recommendation requests the first time and none on the next open within 7 days.

## 8. Data model

New migration `src-tauri/migrations/005_watched_and_recs.sql`, registered in `src-tauri/src/lib.rs` like 001–004. Never edit an applied migration.

```sql
ALTER TABLE watchlist ADD COLUMN refreshed_at INTEGER;

-- Titles the user says they have seen (outside the library).
CREATE TABLE seen (
  tmdb_type     TEXT NOT NULL,
  tmdb_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  poster        TEXT,
  poster_local  TEXT,
  backdrop      TEXT,
  date          TEXT,
  genres        TEXT,              -- JSON array of TMDB genre ids
  reaction      INTEGER NOT NULL DEFAULT 1,  -- 2 loved, 1 liked, -1 not for me
  seen_at       INTEGER NOT NULL,
  PRIMARY KEY (tmdb_type, tmdb_id)
);

-- "Not interested" on a suggestion.
CREATE TABLE rec_dismissed (
  tmdb_type TEXT NOT NULL, tmdb_id INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (tmdb_type, tmdb_id)
);

-- TMDB recommendation lists per seed, so suggestions work offline and stay within rate limits.
CREATE TABLE rec_cache (
  seed_type TEXT NOT NULL, seed_id INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  results   TEXT NOT NULL,         -- JSON array of Item (+ genre ids)
  PRIMARY KEY (seed_type, seed_id)
);
```

When a title is marked watched, cache its poster to disk the same way `toggleWatchlist` does (`cache_tmdb_image`, size `w342`) and store the path in `poster_local`, so the Watched tab renders offline.

Settings keys: `mylist_sort`, `hide_watched_in_discover`.
`Item` in `src/discover/api.ts` needs `genreIds: number[]` (TMDB list responses include `genre_ids`).

## 9. Implementation notes and known pitfalls

**Suggested structure**
- `src/library/seen.ts` — store shaped like `watchlist.ts` (`useSeen()`, `toggleSeen()`, `setReaction()`), plus `watchedSet()` that merges manual and library-derived seeds.
- `src/discover/recommend.ts` — pure scoring; `src/discover/recs.ts` — cache, fetching, `useRecommendations()`.
- `src/pages/MyList.tsx`, `src/components/SeenPicker.tsx`, a small `Toast` with Undo.
- Extend `DiscoverCard` with an action stack (Watchlist, Watched, Not interested when applicable).

**Pitfalls already hit in this codebase (details in PLAN.md)**
1. Schema changes need a Rust rebuild; the dev app and the installed/release app share one database at `%APPDATA%\com.offplayer.app\offplayer.db`. A build without migration 005 will refuse a database that has it.
2. `tmdb_get` rejects paths with characters outside letters, digits, `/`, `_`, `-`. Put everything else in query parameters.
3. Do not call `getProperty(..., "node")` on the mpv plugin (native crash) and pass track ids as strings. Not needed for this work, but do not "tidy" those call sites.
4. React StrictMode is off on purpose; module-level stores must tolerate hot reload re-running effects.
5. A `<button>` inside a `<button>` is invalid; card actions are siblings inside `div.dcard`.
6. Avoid `backdrop-filter` on full-window overlays (artefacts over the transparent window).
7. Row cards must not move their neighbours on hover (fixed in 1.2.1; `scripts/hover-probe.mjs` verifies it).

**Verification rules**
- The user is often at the PC. Test with the app launched muted and driven over the debugging port (`OFFPLAYER_START_MUTED=1`, `scripts/cdp.mjs`, `scripts/at.mjs`); never use the real mouse or play sound. See README → "Checking the window".
- Delete any watchlist / seen / dismissed rows created while testing, and say so.
- Finish by bumping to 1.3.0, running `npm test`, `npx tsc --noEmit`, `npm run tauri build`, and relaunching the release build without the debug port.

**Tests to add (Vitest)**
- Scoring: ranking order, multi-seed boost, exclusions, diversity caps, negative reaction (C4), fewer-than-3-seeds result.
- Watched-set derivation from playback rows: finished vs in-progress thresholds.
- My List sorting and status filter.

## 10. Open questions (defaults chosen so work can start)

| # | Question | Default in this PRD |
|---|---|---|
| 1 | Should suggestions come from TMDB data, or from an AI model given the watched list? | **Decided by the user (2026-11-17): TMDB data.** An AI option stays in §11 as a possible follow-up only. |
| 2 | Should in-progress library shows count as watched for suggestions? | Yes, at reduced weight (0.6). |
| 3 | Hide watched titles in Discover? | No; show a badge, with a setting to hide. |
| 4 | Is "My List" one top-bar item with two tabs, or two separate items (Watchlist, Watched)? | One item, two tabs, to keep the top bar short. |
| 5 | Should reactions (Loved / Not for me) ship in the first cut? | Yes; they are cheap and noticeably improve results. |

## 11. Suggested further features (not in scope here)

Ordered by expected value for this user.

| Feature | What it does | Why |
|---|---|---|
| **Release alerts** | "Out now" badge and an optional Windows notification when a watchlist title is released or a show gets a new episode; a small release calendar. | Makes the watchlist useful over time; builds directly on §5.3 refresh. |
| **Missing episodes** | Compare owned episodes with TMDB's season lists and show gaps on the show page. | Cheap with data already stored; helps with large collections. |
| **Import watch history** | Import a Trakt, Letterboxd or IMDb export file to fill the watched set. | Removes the manual seeding step. |
| **Shuffle / random episode** | "Play something" for a show (good for sitcoms such as Friends). | One button, high everyday use. |
| **Collections** | Group related titles (e.g. all Star Trek series) under one tile. | Already noted in PLAN.md §13. |
| **Skip intro and credits** | Use chapter markers, later audio matching, to offer Skip Intro. | Deferred earlier by the user; common request once binge-watching. |
| **Subtitle download** | Find and attach subtitles for files that have none. | Snowfall has no subtitles today. |
| **Ask for a suggestion (AI)** | Type "something light, under 30 minutes" and get picks from the watched set and library. | Natural extension of For You; needs an API key and consent. |
| **Viewing stats** | Hours watched, most-watched shows, a yearly summary. | Low effort from existing playback data. |
| **Backup and restore** | Export/import watch history, lists and settings as one file. | Protects data now that the app holds more of it. |
| **Mini player** | Keep playing in a small always-on-top window while browsing. | Quality-of-life for desktop use. |

## 12. Delivery plan

| Milestone | Scope | Done when |
|---|---|---|
| M1 | Migration 005, `seen` store, Watched control on cards and detail page, My List page with both tabs, Undo toast, row caps and See all | A1–A6, B1–B3 pass |
| M2 | Recommendation cache and scoring, For You rows on Discover and Home, reasons, Not interested | C1–C6 pass, unit tests green |
| M3 | Quick picker, reactions, Settings options, watchlist refresh | B4–B5, A4 pass; release 1.3.0 built and running |
