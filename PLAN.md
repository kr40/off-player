# Off Player — plan

A Netflix-style desktop app for the media already on this PC. It scans your folders, turns files into a browsable library with artwork, plays anything, and remembers exactly where you stopped.

## 1. What it does

- **Library**: point it at folders (e.g. `D:\TV`, `D:\Movies`). It finds shows, seasons, episodes and movies from file and folder names.
- **Artwork and info**: posters, backdrops, title logos, episode stills, synopses and runtimes, downloaded once and cached to disk. After that the app works fully offline.
- **Resume**: position is saved continuously. Home opens with a Continue Watching row; one click resumes mid-episode.
- **Up next**: finishing an episode queues the next one with a countdown. A show's main button is always "play the next unwatched episode".
- **Plays everything**: MKV, HEVC/H.265, AV1, 10-bit, AC3/E-AC3/DTS audio, embedded and external subtitles (SRT, ASS, PGS), multiple audio tracks.

## 2. The key technical decision: playback engine

A browser `<video>` tag is not enough. Chromium-based shells cannot reliably play MKV, AC3/E-AC3/DTS audio or embedded subtitle tracks, which describes most TV rips. The two real options:

| | A. Embed mpv (recommended) | B. Browser video + ffmpeg transcoding |
|---|---|---|
| Format support | Everything, direct play | Whatever ffmpeg can convert live |
| Quality | Original, GPU decoded on the GPU | Audio re-encoded, image subtitles lost |
| Seeking | Instant | Restarts the transcode |
| Complexity | Low: mpv does the work | High: a small Jellyfin |

**Choice: Tauri 2 + libmpv**, using `tauri-plugin-libmpv` (0.3.x, Windows is its fully tested platform). mpv renders the video inside the app window and the web UI sits on top as a transparent layer, so the controls are ordinary HTML/CSS and can look exactly as designed.

Risk: the plugin is young (0.3.x). Phase 0 exists to prove it on a real file before anything else is built. Fallback if it fails: `tauri-plugin-mpv`, which drives a separate mpv process over IPC.

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 (WebView2) | Small, fast start, native window, libmpv plugin |
| Playback | libmpv via `tauri-plugin-libmpv` | Plays every format, hardware decoding |
| UI | React + TypeScript + Vite | Component model suits rows/cards/player overlay |
| Styling / motion | Tailwind v4 + Motion | Design tokens, spring and shared-element animation |
| Data | SQLite (`tauri-plugin-sql`) | One local file, survives reinstalls |
| File probing | `ffprobe` / `ffmpeg` (already installed) | Duration, tracks, chapters, thumbnails |
| Metadata | TMDB API | Posters, backdrops, logos, episode stills |

Rust stays a thin shell (window + plugins). Scanner, matching, watch-state and UI logic are all TypeScript.

**To install first**: Rust toolchain (`rustup`) and Microsoft C++ Build Tools. Node 26, ffmpeg and WebView2 are already present. No Rust, mpv or VLC on the machine today; libmpv DLLs are fetched by the plugin's setup script and bundled with the app.

## 4. Design direction

Researched references: Netflix's 2025 TV redesign (top navigation bar, fewer and larger titles, cards that expand in place with details, calmer motion, no auto-playing previews), Plex's art-led "new experience", and the newer Jellyfin/Plex clients praised for looks (Zuno, Neptune, FluentFin). What to take from them:

**Principle: the artwork is the interface.** Chrome is minimal and dark; colour comes from the content.

- **Canvas**: near-black (`#0B0B0F`), with a soft ambient glow sampled from the focused title's backdrop that crossfades as you move between titles.
- **Navigation**: a floating translucent bar at the top (Home, Shows, Movies, Search) that is clear over the hero and frosts on scroll. No sidebar.
- **Home hero**: full-bleed backdrop of whatever you are most likely to resume. Title shown as its logo art, not text. One primary button: "Resume S3 E15 · 23 min left", with a thin progress line.
- **Rows**: Continue Watching (16:9 episode stills, progress bar, time left), Up Next, Recently Added, Shows, Movies. Fewer, larger cards than classic Netflix.
- **Cards**: on hover a card grows in place and reveals synopsis, runtime and a play button; neighbours slide aside. Posters are 2:3, episodes 16:9.
- **Show page**: backdrop header with logo, season switcher, episode list with still, title, runtime, synopsis, and a progress bar or watched tick per episode.
- **Player**: edge-to-edge video. Controls fade in on mouse move and out after 3 s over a bottom scrim. Thick scrubber with chapter ticks and thumbnail preview on hover; play, ±10 s, volume on the left; audio/subtitle picker, speed, episode drawer, fullscreen on the right. A "Next episode" card with a countdown ring at the credits. 4:3 shows are pillarboxed on black.
- **Type**: one variable sans (Geist), tight tracking on headings, tabular numerals for timecodes. Bundled, not fetched.
- **Motion**: spring-based, 180–300 ms. Poster → detail page → player is one continuous shared-element transition. Honours reduced-motion.
- **States**: skeletons instead of spinners; a first-run screen that is just "Add your first folder"; generated frame-grab thumbnails for anything TMDB cannot match.

Deliberately not copied: Netflix's branding, red, logo or layout pixel-for-pixel. This is its own look built on the same proven patterns.

## 5. How resume works

- While playing, position is written every 5 s and on pause, seek, close and crash-safe on window unload.
- Resuming starts 5 s before the saved point.
- An episode counts as **watched** at 92% or when the credits chapter begins; it then leaves Continue Watching and the next episode enters Up Next.
- Under 2% played is ignored (accidental clicks).
- Progress is keyed to a file fingerprint (size + hash of first and last 64 KB), not the path, so renaming or moving files keeps your history.
- Manual controls: mark watched/unwatched for an episode, season or show; remove from Continue Watching.
- Per-show memory of audio track and subtitle choice.

## 6. Data model (SQLite)

- `libraries` — folder path, type (tv / movies / mixed)
- `titles` — show or movie: name, year, tmdb_id, overview, poster/backdrop/logo paths, accent colour
- `seasons`, `episodes` — numbers, names, overview, still, runtime, air date
- `files` — path, fingerprint, size, duration, video/audio/subtitle tracks, chapters; linked to an episode or movie
- `playback` — file fingerprint, position, duration, watched flag, last played, audio/sub choice
- `settings` — TMDB key, player defaults

## 7. Scanning and matching

Naming differs across the collection, so matching is **folder-first** and never depends on one file-name pattern.

1. **One folder = one title.** Each direct child of a library root (e.g. `D:\Media\Star Trek - The Next Generation`) is treated as one show or movie. The folder is matched to TMDB once and every file inside inherits it.
2. **Title comes from the best available name**, tried in order: top folder name, season folder name, file name. Release junk (`1080p`, `x264`, group tags, dots, underscores) is stripped first.
3. **Season and episode numbers** are read from any of: `s01e01`, `S01E01`, `1x01`, `Season 1/Episode 01`, `101`, double episodes `S01E01-E02`; specials go to season 0. Season can also come from the folder (`Season 3`) when the file only has an episode number.
4. **Cross-check by episode title.** When the file name carries a title, it is compared with TMDB's episode name. A mismatch (releases that number double-length episodes differently) is flagged and resolved by title rather than number.
5. **Sidecar subtitles** are paired by season/episode number within the folder, not by exact file name.
6. `ffprobe` each file for duration, tracks and chapters.
7. **Review screen after the first scan**: every folder with its proposed TMDB match and poster, one click to accept, search to fix. Unmatched items still appear with a frame-grab thumbnail.
8. Folder watcher picks up new files; rescan is incremental.

### What the TNG folder showed

Checked `D:\Media\Star Trek - The Next Generation` (176 episodes + 176 `.srt`, 81 GB, seven `Star Trek TNG - Season N` folders):

| Finding | Consequence |
|---|---|
| Files are `StarTrek.TNG-s01e01.Encounter.at.Farpoint.mkv` | File name alone ("StarTrek TNG") will not match TMDB; the top folder name "Star Trek - The Next Generation" will. Confirms folder-first matching |
| Lower-case `s01e01`, title after it | Parser is case-insensitive; episode title available for the cross-check |
| Pilot and finale are single double-length files (91 min), giving 25 episodes in seasons 1 and 7 | Numbering must be verified against TMDB by title, per rule 4 |
| Subtitle names differ slightly from the video (`At` vs `at`, `'` vs `’`) | Exact-name pairing would miss some; pair by episode number |
| Video is H.264 720×496 (DVD source), audio is AC3 5.1 | AC3 is silent in a browser player, so the mpv choice is required, not optional |
| 18 chapter markers in the pilot | Chapter ticks on the scrubber will work |
| 4:3 picture | Player pillarboxes; cards crop stills to 16:9 |

## 8. Build phases

| Phase | Deliverable | Proves |
|---|---|---|
| **0. Playback spike** | Tauri window plays the TNG pilot (H.264 + AC3 5.1 + external `.srt` + chapters) through libmpv with an HTML button on top | The engine choice. Go / no-go before any UI work |
| **1. Library** | Add folders, scan, parse, probe, store. Plain list UI | Your files are understood correctly |
| **2. Metadata** | TMDB matching, artwork cache, Fix match, offline fallback thumbnails | Library looks like a catalogue |
| **3. Browse UI** | Design tokens, home with hero and rows, show page, movie page, search | The look |
| **4. Player** | Custom controls, track pickers, keyboard shortcuts, fullscreen | The watching experience |
| **5. Watch state** | Resume, Continue Watching, Up Next, auto-next, mark watched | The core promise |
| **6. Polish** | Scrub thumbnails, ambient colour, transitions, settings, installer | "Beautiful" |

Each phase ends with something runnable. Phases 1 and 3 can overlap once phase 0 passes.

### Phase 0 result — passed (2026-11-17)

Tested on the TNG pilot in the Tauri window with libmpv 2026-11-16 build and `tauri-plugin-libmpv` 0.3.2:

| Check | Result |
|---|---|
| Video | H.264 720×496, hardware decoded (`d3d11va`) on the GPU |
| Audio | AC3 decoded at 6 ch, output to WASAPI at 6 ch (5.1 kept) |
| Subtitles | External `.srt` attached explicitly, switches on/off from the HTML menu |
| Open time | ~210 ms to first frame |
| Seeking | 13–46 ms (keyboard ±10 s and scrubber click) |
| Overlay | HTML controls render over the video and receive clicks; auto-hide works |
| Chapters | 18 read and drawn as scrubber ticks |
| Shutdown | Closing the window destroys mpv cleanly |

Lessons carried forward:
- Register mpv property observers **before** `init()`; initial values are emitted immediately and are lost otherwise.
- Set `sub-auto=no`; the app pairs subtitles itself, and mpv's case-insensitive matching otherwise loads the `.srt` a second time.
- Move subtitles above the controls with `sub-pos` (works for SRT); `sub-margin-y` had no visible effect.
- Menus must hold the controls open; the auto-hide timer otherwise closes them mid-click.
- Hot reload re-attaches mpv listeners; restart the app after player changes.

### Phase 1 result — passed (2026-11-17)

`D:\Media` scanned as one library: 520 videos probed into 3 titles, 0 probe errors, 0 items needing attention. A rescan with no changes takes ~2 s.

| Title | Result |
|---|---|
| Star Trek: TNG | 176 episodes, seasons 25/22/26/26/26/26/25, every episode titled from its file name, all 176 `.srt` paired |
| Friends (1994) | 234 episodes + 50 featurettes kept apart as extras; double episodes (S09E23–24, S10E17–18) recognised; 1080p HEVC 10-bit, hardware decoded |
| Snowfall | Six `Snowfall.S0N.COMPLETE…` folders merged into one show, 60 episodes |

How it works:
- Rust (`src-tauri/src/media.rs`) walks folders, fingerprints files (size + xxh3 of first/last 64 KB) and runs `ffprobe` in parallel without console windows.
- TypeScript (`src/library/parse.ts`) decides titles, seasons, episodes and extras. It is pure and covered by 15 tests in `parse.test.ts`, run against a sample library's file list in `__fixtures__/sample-library.json`.
- Titles merge across folders by normalised name; a folder of season folders, a bare show folder and loose files at the root are all handled.
- Rescans only re-probe files whose size or modified time changed; removed files and empty titles are pruned.
- Library UI lists titles with tech badges, season tabs, extras and a "Needs attention" list; any episode or extra plays in the player, and Escape returns to the library.

Open choice for Phase 5: sidecar `.srt` files are switched on automatically, embedded subtitle tracks (Friends has 12) are not. Per-show memory of the subtitle choice will settle this.

### Phase 2 result — passed (2026-11-17)

With the user's TMDB key:
- All three shows matched correctly at 0.95 confidence: Friends (1994, TMDB 1668), Snowfall (2017, 71694), Star Trek: The Next Generation (1987, 655). Poster, backdrop and logo cached for each.
- Every one of the 470 episode files maps to a TMDB episode with a still, name and synopsis. TNG and Snowfall numbering matches TMDB exactly.
- Friends: TMDB merges five two-parters into single entries (S4/5/6/7/8 finales and S6E15), which shifts the rest of Season 6 by one. Files are mapped by title (14 files), both halves of a merged two-parter show their own "(1)/(2)" titles, and two real-data regression tests pin the exact mapping.
- First matching attempt mis-mapped Friends S1E1 ("…Monica Gets A Roommate" → "…Underdog Gets Away") because every Friends title shares "The One With/Where". Fixed by weighting words by how rare they are within the season.
- Mapping changes re-apply on start-up from stored TMDB data (no network), and only titles that then need new stills are refetched.
- Fix match dialog searches TMDB and marks the current match.

Also verified before the key:
- Offline fallback: 520 frame grabs (480 px, anamorphic-corrected, 8.9 MB) made in about a minute on first launch; titles use the first episode's grab as cover and banner; episode rows show stills.
- TMDB connectivity over HTTPS (Windows native TLS); an invalid key is rejected with TMDB's message and not saved.
- 27 unit tests, including matcher cases: punctuation- and accent-insensitive names, year disambiguation (Friends 1994 vs 2009), popularity tie-break (Snowfall), title-based remapping, and the real Friends/TNG/Snowfall episode lists in `__fixtures__/tmdb-episodes.json` (regenerate with `scripts/dump_mapping_fixture.py`).

How it works:
- Rust `artwork.rs`: `tmdb_get` (pinned to api.themoviedb.org), `cache_tmdb_image` (pinned to image.tmdb.org, saved under `%LOCALAPPDATA%\com.offplayer.app\artwork`), `grab_frame` (ffmpeg, saved under `…\thumbs`). Images reach the page through Tauri's asset protocol, scoped to those two folders.
- `src/library/match.ts` (pure, tested): result scoring and episode mapping. `metadata.ts`: runs after every scan and on start-up; only new titles, titles that gained episodes, or titles the user asks to refresh hit the network.
- Hand-picked matches live in `match_overrides`, keyed by title key, so they survive a library being removed and re-added.
- Settings dialog stores the key in SQLite; TMDB attribution shown there.

### Phase 3 result — browse UI built (2026-11-17)

Pages: Home, Series, Movies, Search, a page per show/movie, and Manage (folders, rescan, settings, match status). Top bar is clear over artwork and frosts on scroll; Back via the arrow, Esc, Backspace or the mouse back button; "/" opens search. Page changes cross-fade with view transitions; each page keeps its scroll position when you come back.

- Home: hero for one featured title per session (backdrop, logo, rating, year, seasons, genres, overview, Play S1 E1 / More info); rows for Your series, Top-rated episodes (TMDB episode ratings, interleaved across shows), Seasons (season posters). Recently added, Movies and genre rows appear once the library is big enough not to repeat itself.
- Landscape cards grow in place on hover after a short dwell, reveal play / more / facts / genres, and push neighbours aside (CSS only).
- Show page: hero with "…" menu (Fix match, Refresh), season pills with TMDB season summaries, large episode rows (still, title, runtime, synopsis, air date), extras grid, About (tagline, genres, quality, size, folders, match state), Needs attention.
- Search: instant, accent-insensitive, across show names, episode titles and plot synopses (e.g. "borg" → 7 TNG episodes).
- Ambient glow: the featured artwork, heavily blurred, tints the page behind the rows; the hero image and its vignette fade into it with no seam.
- Geist variable font bundled locally.
- Background jobs (scan, TMDB, thumbnails) run through one queue, start on launch regardless of page, and show a progress pill in the top bar.

Verified in the running app (background captures): every page renders with real artwork; navigation, back, search, season switching, keyboard scrolling. Not fully verified: the settled hover-expanded card state (window-message hovers are cancelled by Windows because the real cursor is elsewhere; a mid-animation capture showed the expansion working) and playing from the new pages (same player path as before; not run, to avoid sound while the user was busy).

Noted for Phase 6: a few frame-grab thumbnails land on black frames (use ffmpeg's `thumbnail` filter); remember window size and position.

### Phase 4 result — passed (2026-11-17)

Player additions: next/previous episode (buttons, N/P) with a hover preview of the next episode; Episodes drawer (E) with season switcher and the current episode marked; playback settings menu (speed 0.5–2×, subtitle size, "Sharper upscaling" = EWA Lanczos + deband vs Standard, stats, shortcuts); centre feedback flashes for play/pause/seek/volume/speed; buffering spinner; time-remaining toggle; mouse-wheel volume; full shortcut map with a `?` overlay (Shift+arrows ±1 min, 0–9 jump, [ ] = speed, , . frame step, A/C cycle tracks); window title follows the episode; volume, subtitle size and picture quality persist.

Keep-awake: a dedicated thread holds `SetThreadExecutionState(ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED)` while playing. Verified with `CallNtPowerInformation(SystemExecutionState)`: display-required on while playing, off when paused, released on close.

Verified end to end through the WebView2 DevTools protocol (`scripts/cdp.mjs`, muted): episode switching via drawer, N and P; settings chips; wheel volume (100 → 90 % in two notches); seek flash; shortcuts overlay; close restores page, title and power state; preferences saved. Also confirmed Phase 3's hover-expanded cards settle correctly (scale 1.22, panel opaque, above the next row).

Bugs found and fixed:
- Closing the Episodes drawer crashed the whole UI to a blank window: in this WebView `scrollIntoView()` returns a Promise, which an expression-bodied `useEffect` handed to React as its cleanup. Fixed, and an error boundary now shows a Reload screen instead of a blank window on any future crash.
- After a page reload, mpv (native, still alive) sent no initial values, so the mute icon showed "unmuted" while muted. The player now reads mute/volume/speed/pause on connect; the app also stops any leftover playback on load.
- The seek flash showed "10" twice.

### Phase 5 result — passed (2026-11-17)

Watch state, all keyed by file fingerprint (`src/library/progress.ts`, migration 003):
- Position saved every 5 s while playing, on pause, after every seek and on close. Under 2 % is ignored; at 92 % the episode is watched and restarts from the top if replayed. Resume starts 5 s before the saved point via mpv's `start` option (no flash of the opening).
- Next up (`nextUp`, unit-tested): resume the most recently played if unfinished, else the next unwatched episode after it, across seasons, skipping ones marked watched.
- Home: **Continue watching** row (resume with progress and time left, or "Next episode"; × removes a show until it's played again); the hero features the most recent show with **Resume S1 E2 · 35 min left** and a progress line.
- Credits: card with a 10 s countdown filling the button, "Watch credits" to dismiss; end screen with Up next (or "last episode you have"); autoplay toggle in player settings; **Are you still watching?** after 3 autoplays with no key press or click.
- Mark watched/unwatched per episode (hover tick), per season, and for the whole show; progress lines and ticks on show pages, the Episodes drawer, Top-rated tiles and Continue Watching.
- Each show remembers its subtitle and audio choice (language, embedded/external, track title — not ids) and re-applies it on every episode.

Verified end to end (muted, CDP), then all test watch history deleted:
- Saved 602 s → closed at 607 s → Resume started at 10:02; force-killed the app at ~25:08 → database held 25:07 → relaunch offered "Resume S1 E2 · 20 min left".
- Credits card appeared, counted down, autoplayed S1E2→E3 and marked E2 watched; three autoplays later the still-watching prompt paused playback.
- Watch credits → Up next end screen; mark episode/season watched and unwatched (hero moved to S2 E1 and back); removing Friends from Continue Watching.
- Friends: English chosen in E1 carried to E2; Off chosen in E2 carried to E3.

Bugs found and fixed (both in how the libmpv plugin is called):
- `getProperty("track-list", "node")` crashes the whole app natively (access violation). Never read node-format properties with `getProperty`; use the observed values instead.
- Setting `sid`/`aid` with a JS number fails ("error accessing property"), so choosing a subtitle or audio track from the menu had never worked; only "Off" did. Track ids are now passed as strings.
- Language codes: mpv reports ISO 639-2 ("jpn", "spa", "ger"); preferences now normalise both sides to 639-1.
- After an episode switch, cached position from the previous file could have been saved against the new one; cached file-specific values are now ignored until the new file loads.

### Phase 6 result — polish done (2026-11-17)

- **Scrub previews**: on first play of a file, a storyboard (one 240 px frame every 5–10 s, 10×10 sprite sheets) is built from keyframes only — ~5 s for a 45-min DVD episode, ~8 s for 22-min 1080p HEVC — and cached under `thumbs/sb/<fingerprint>`. Hovering the scrubber shows the frame, time and chapter. Verified: 19:05 / Chapter 4 preview on TNG S1E3.
- **Better thumbnails**: frame grabs use ffmpeg's `thumbnail` filter (most representative of the next 48 frames). A one-time pass re-grabbed the 64 grabs under 9 KB (near-black) from 35 % in, under a new filename so no cached black image survives. Verified on the Friends extra that was black.
- **Card → page morph**: the clicked card's artwork carries a view-transition name and grows into the title page's hero (and back). Verified via hooked transitions (animations ran, finished both ways).
- **Settings**: TMDB key; playback defaults (autoplay, subtitle size, picture); check folders for new files on launch (default on — replaces a file watcher; ~2 s when nothing changed, silent unless something is new); clear watch history (two-step); version and TMDB attribution.
- **Keyboard focus rings** (`:focus-visible`, gold) throughout.
- **Window state**: size, position and maximised state restored between launches (`tauri-plugin-window-state`).
- **App icon** generated from `app-icon.svg`; version 1.0.0.
- **Installer**: `npm run tauri build` → NSIS, per-user install (no admin). Bundles the libmpv DLLs. Requires `ffmpeg`/`ffprobe` on PATH (installed here via winget) for scanning, thumbnails and scrub previews; playback itself doesn't need them.

Ambient colour (from the plan) was delivered in Phase 3 as the blurred-artwork glow.

### Discover — browsing beyond the library (2026-11-17, v1.1.0)

A **Discover** tab uses the existing TMDB key to browse titles that are not in the library (online only; nothing is cached to disk).

- Rows: Trending this week, Upcoming series, Upcoming movies (premiere-date badges), New episodes this week, "More like <each library show>", Popular / Top-rated series, In cinemas now, Popular / Top-rated movies. News, reality, soap and talk shows are filtered out of series rows.
- All / Series / Movies filter; search across all of TMDB (uses the series- or movie-only search when a filter is on).
- Titles already in the library carry an "In your library" badge and open the library page (with Play); everything else opens a browse-only detail page: backdrop and logo, status, next episode, cast, seasons, "More like this", Watch trailer (opens YouTube in the browser), View on TMDB.
- Where to watch (JustWatch data via TMDB) with a country picker; defaults to the system locale's country, remembers the choice (`watch_region`). The country is chosen client-side from the full response, so it is never sent to TMDB.
- Code: `src/discover/api.ts` (session cache, 30 min), `src/pages/Discover.tsx`, `src/pages/TmdbPage.tsx`, `DiscoverCard.tsx`. No Rust changes; requests go through the existing host-pinned `tmdb_get`.
- Verified live (muted, CDP): 12 rows populated, filter, search ("friends" → Friends marked in library and opening the library page), series and movie detail pages, country picker (128 countries). Not clicked: Watch trailer / View on TMDB (they open the user's browser).

Ratings note: Friends 8.40, Snowfall 8.39 and TNG 8.38 all round to 8.4 — a coincidence, not a bug.

### Watchlist and Categories (2026-11-17, v1.2.0)

- **Watchlist**: save any Discover title with the + on its card (hover) or "+ Watchlist" on its page. Saved titles appear as "Your watchlist" on Home and at the top of Discover; the tick removes them. Stored in a new `watchlist` table (migration 004) with the poster cached to disk, so the row shows offline. Shared in-memory store (`src/library/watchlist.ts`) so cards don't query per render.
- **Categories** (`CategoryMenu`): a Netflix-style dropdown on Discover with 16 categories. TMDB uses different genre ids for series and movies, so each category maps to both (`CATEGORIES` in `src/discover/api.ts`). Picking one turns Discover into that category's page: its own hero plus Popular / New / Top-rated / Coming soon rows for series and movies; combines with the All / Series / Movies switch.
- The library's Series and Movies pages get the same dropdown, built from the genres of the titles you own.
- Verified live (muted, CDP): Comedy → 8 populated rows and hero; add from card and from detail page, remove, rows on Home and Discover, posters served from disk; library filter (Comedy → Friends, "1 of 3 series"). Test entries deleted afterwards.

### Card hover rework (2026-11-17, v1.2.1)

Reported: the "Your series" hover felt unsteady and clipped when moving to the next card. Measured with `scripts/hover-probe.mjs` (records every frame while a virtual pointer moves across the cards): frame times were fine (300 Hz, no long frames), but neighbouring cards slid sideways by up to 59 px to make room, so the card under the pointer kept moving, and the card being left stayed on the top layer for 0.32 s, covering the one being entered.

Now: nothing in the row moves; the hovered card grows in place (scale 1.2) over its neighbours after a 0.14 s dwell; the card being left drops down the layers as it shrinks; the shadow fades on its own layer instead of animating `box-shadow`; the row has more room below (230 px) so a panel with two lines of genres is never cut off. Probe after: 0 px sideways drift, tallest panel 66 px clear of the row's clipping edge.

### My List, Already watched, For You (2026-11-17, v1.3.0)

Built from [docs/PRD-my-list-watched-recommendations.md](docs/PRD-my-list-watched-recommendations.md).

- **My List** (top bar, `src/pages/MyList.tsx`): Watchlist and Watched tabs. Watchlist has All / Series / Movies, All / Released / Coming soon and a sort menu (Date added, Release date, Name, TMDB rating; remembered as `mylist_sort`). Entries older than a week are refreshed from TMDB when the page opens (4 at a time, silent offline). Home and Discover watchlist rows are capped at 12 with **See all**.
- **Already watched** (`src/library/seen.ts`, table `seen`): an eye button on every Discover card and **Watched** on the detail page, with Loved it / Liked it / Not for me there. Marking removes the title from the watchlist; every change shows a 5-second Undo toast (`src/components/Toast.tsx`) that reverses both. Library titles count automatically, derived at read time from playback (finished = every owned episode or the movie watched; in progress = ≥ 3 or ≥ 20 % of episodes), listed under "From your library". A quick picker (`SeenPicker`) ticks many at once. Settings → Library: hide watched titles in Discover rows (search unaffected), clear the watched list.
- **For You** (`src/discover/recommend.ts` pure scoring, `src/discover/recs.ts` cache and store): seeds are the watched set (max 40, loved first); TMDB recommendations per seed are cached in `rec_cache` for 7 days. Score = Σ seed weight / (1 + rank/8) + genre affinity (0–0.5, categories shared across series and movie genre ids) + rating (0–0.3, ≥ 200 votes). A candidate whose seed sum isn't positive is dropped, so a "Not for me" seed can't push its titles in through genre or rating. Top picks are diversified (≤ 3 in a row of one type, ≤ 5 per strongest seed) and carry their reason; up to three "Because you watched X" rows follow. **Not interested** is stored in `rec_dismissed`. Fewer than 3 seeds shows a prompt that opens the picker.
- Migration 005 (`seen`, `rec_dismissed`, `rec_cache`, `watchlist.refreshed_at`). Genre tables moved to `src/discover/genres.ts` (no network imports, so scoring is testable).
- Tests: 21 new (scoring order, multi-seed boost, exclusions, diversity caps, Not-for-me removal, < 3 seeds, library derivation thresholds, My List filter and sort); 57 total.
- Verified live (muted, CDP): every acceptance check A1–A6, B1–B5, C1–C6. 6 seeds → 6 recommendation requests, 0 after reload; with TMDB images blocked the rows still render from cache with title placeholders. Fixed during testing: the suggestions prompt sat under the previous row's hover area and didn't take clicks; hero buttons wrapped their labels with four buttons. Test entries and the playback rows the library check created were deleted afterwards.
- Follow-up from use: poster grids (My List, Series, Movies) let a long title widen its card over the next one (a `<button>` sizes to its content), now cards fill their column and cut the title with "…". The "Tell us what you've watched" prompt shows progress (three dots, "2 of 3 marked") that updates the moment a title is marked anywhere, and has a × (remembered as `foryou_prompt_hidden`, Undo in the toast; the picker stays reachable from My List → Watched). Discover no longer has a "Your watchlist" row (My List is its home; Home keeps its row), and the filter bar sits above the suggestions box so the Categories dropdown opens over it.

### Off Player 2.0 — find it, then watch it (2026-11-17, v2.0.0)

Built from [docs/PRD-2.0-discover-lists-collections-imdb.md](docs/PRD-2.0-discover-lists-collections-imdb.md); install notes for recipients in [docs/INSTALL.md](docs/INSTALL.md); screenshots in `docs/screens/2.0/`.

**What changed**
- **Menu:** Home · Library · Discover · My List, a search field in the top bar (`/`), and a settings gear. Discover has its own sub-menu (For You · Browse · Top Lists · Collections · Coming Soon) with a sliding underline. Each tab stays mounted, so switching keeps its place. Library merges Series and Movies into tabs (All, Series, Movies, plus Anime and Collections when you own any). Settings is a page with six sections. `g` then `h`/`l`/`d`/`m`/`s` jumps; `?` shows every shortcut.
- **Browse:** every TMDB `/discover` filter (genres any/all, years with decade and "last N years" shortcuts, minimum rating, well-known only, length, language, series status, streaming service in your country, themes from TMDB keywords, hide watched/owned/saved, seven sorts). Active filters show as removable chips; filter sets can be saved to My List → Saved filters. The grid loads more as you scroll. Logic in `src/discover/filters.ts` (pure, tested).
- **Anime** is a type everywhere: Japanese-language animation (`with_genres=16`, `with_original_language=ja`), with its own For You rows.
- **Top Lists:** 111 lists in seven groups: Top 250 movies and series, anime, popular, by genre, by era, 18 themes, ten countries, short watches, hidden gems. Each list shows "N of 250 seen", has All/Unseen/Seen, Hide what I own, a poster grid with rank numerals or a ranked-rows view, and "Pick one for me". Theme keyword ids come from TMDB via `scripts/resolve-keywords.mjs`. List pages are cached in `api_cache` for a week, keyed by the list's definition. The two Top 250s only count titles released at least 120 days ago (early votes run high).
- **IMDb ratings (opt-in):** `src-tauri/src/imdb.rs` streams IMDb's `title.ratings` and `title.basics` files, decompressing them on the fly, and keeps movies and series with 250+ votes. It computes a weighted rating (m = 25,000) and sends batches to the front end, which writes them to a new table and swaps it in with one statement, so a failed or cancelled update leaves the old data intact. Result on this PC: **137,004 titles in 30 s; the database grew to 17 MB.** IMDb ratings show beside TMDB's on title pages (with a link to imdb.com), on posters if chosen in Settings, and as an IMDb ranking on Top Lists ("Top 250 movies by IMDb rating", with the required credit). TMDB↔IMDb ids are linked in `ext_ids` through `external_ids` and `/find`. The data refreshes weekly in the background.
- **Collections:** 32 hand-curated franchises (260 entries; 26 film/TV, 6 anime) and 37 popular TMDB movie collections, plus any TMDB collection through search. Story orders exist only where a public source backs them, recorded on the page: Star Wars (starwars.com's official timeline), Star Trek (StarTrek.com's viewing guide), the MCU films (Space.com), and Wikipedia for the Conjuring Universe, Alien, Dune, Middle-earth, Wizarding World, Indiana Jones, Mad Max, John Wick, Hunger Games, Game of Thrones, Breaking Bad, The Witcher, MonsterVerse, Fast & Furious, Blade Runner, Jujutsu Kaisen, Dragon Ball and Fate. Franchises without a disputed order (Bond, Mission: Impossible, Jurassic, Toy Story…) offer release order only. `scripts/build-franchises.mjs` resolves every entry to a TMDB id, failing on anything ambiguous (five ids are pinned by hand, each checked). A collection page has a release/story order switch with entries animating to their new places, a Next up marker, owned entries with Play/Resume, Follow (adds Next up to Home), and a "Part of …" strip on every title page.
- **People** (click any cast member), **Coming Soon** (your watchlist's dates and next episodes, then everything by month, with "Out now" for 14 days), and **global search** (library, then episodes, collections, TMDB, people; a title you own appears once).
- **Ready to share:** first-run set-up in five skippable steps; FFmpeg 9.0 LGPL shared build bundled in `src-tauri/lib/ffmpeg` (SHA-256 checked, source noted in `SOURCE.txt`), used before PATH. The installer grew from 33 MB to **80 MB**. About page with the TMDB logo and notice, the IMDb and JustWatch credits, 377 licences generated at build time (`scripts/gen-licenses.mjs`), and a privacy statement. The database is backed up automatically before any version change (newest 3 kept). Export/import of all user data; import of IMDb "Your ratings" and watchlist CSVs. A friendly screen appears for a database from a newer version. WebView2 downloads during install if missing.
- **Robustness:** every TMDB request goes through one queue (8 at a time, shared duplicates, 429 back-off, one retry on network errors). An offline pill and strip replace per-row errors. Cached TMDB data older than 180 days is purged at start-up (TMDB's terms), and watched entries refresh weekly like the watchlist.
- **Design system:** motion and layer tokens in `base.css` (no literal `z-index` remains); items rise in with a 30 ms stagger; images fade in once decoded; a slow zoom on still hero art (paused when unfocused); sliding tab underlines; reduced-motion users get cross-fades only. Settings that change what a page shows are loaded before the first render, so pages don't repaint with defaults.

**Measured (dev build on this PC, muted, over the debug port)**

| Check | Result |
|---|---|
| D1 frames | Row paging max 6.6 ms; menus 3.8 ms; MCU order switch (38 entries) 20 ms; 600-card grid at about 15,000 px/s: repeat passes max 17 ms, but the first pass over never-rendered cards had 2 frames over 25 ms (73 ms worst) |
| D2 layout shift | 0 px on Discover (all tabs), Top Lists, Collections, Coming Soon, My List, Home. Fixed during testing: rows appearing above others, the type switch loading late, and `content-visibility` placeholders in the galleries |
| D7 sizes | 1024×640 and 3840×2160: no horizontal scroll, overflow or overlap on 8 main pages (`scripts/viewport-check.mjs`) |
| F1 scenario 1 | Ended crime series 2021–2026 rated 8.0+, by rating: correct results, but 13 interactions, not 6 (a "Last 5 years" shortcut was added afterwards) |
| T1 | Top 250 movies: rank 1 in 273 ms; all 250 load with ranks 1–250 in order |
| I1–I3, I5 | Import 30 s with no frame over 4 ms; ratings match IMDb's file (Shawshank 9.3, Godfather 9.2, Breaking Bad 9.5); IMDb Top 250 resolves all 250 to TMDB; Remove clears every rating |
| I4 | 11 of 14 visible cards rated within 1.5 s (79%). The three missing were an unreleased film and two new releases under the then 1,000-vote cut-off, which is now 250 |
| C3, C4 | Order switch persists (`collection_state`); Star Trek marks TNG as in the library with Play |
| G1 | "star trek": library, episodes, collections, TMDB sections in that order |
| S1, S2 | Simulated (no second Windows account): database moved aside, ffmpeg removed from PATH. Set-up appears; skipping everything leaves an empty Library and a key prompt in Discover; Settings reports the bundled ffmpeg as working |
| S4 | First 2.0 launch on the real 1.3 database: backup written, migration 006 applied, every title, file, watch position and setting kept |
| S5 | Web view requests went only to `image.tmdb.org`; Rust is pinned to `api.themoviedb.org`, `image.tmdb.org`, `datasets.imdbws.com` |

**Not verified:** a real clean Windows profile or VM (S1 was simulated); unplugging the network (only the web view was taken offline, and TMDB calls run in Rust); export → import round trip (it needs the native file dialog; the CSV parsing is unit-tested); actually playing from a collection page; every theme list checked by eye (T2); Enter-to-open in the keyboard check (CDP's synthetic Enter didn't activate the button; arrows, W and L were verified).

**Tests:** 91 Vitest tests (filters, list definitions and keyword resolution, franchise validation and ordering, request queue, IMDb CSV import, plus the earlier suites) and 2 Rust tests (IMDb parsing, filtering, weighting).

**Page × state checklist** (screenshots in `docs/screens/2.0/`): normal state for every page (01–16); first-run (20–22); fresh-install Home (23); no TMDB key on Discover (24); empty states for Library (fresh install), My List → Saved filters (12) and Browse with no matches (17); offline Top List and Browse (18–19). Error states (TMDB failing) use the same component as offline and weren't captured separately.

**Follow-up from use (same day, still 2.0.0): hover and design pass**

Reported: hovering a card from above often did nothing until the pointer reached its lower half; the white hover outline was cut off in Library, Browse, Top List pages and Coming Soon; the "Your series" hover covered the neighbouring card and felt janky.

- **Dead zone under rows.** A row's track is taller than its cards (room for outlines and shadows), and because of margin collapsing the row and its viewport boxes were that tall too, so they lay over the top of the next row and took the pointer. Rows and their viewports now ignore the pointer; only cards, arrows, the title and a band behind the cards respond. `scripts/hover-audit.mjs deadzone` moves a pointer down from each row into the next: 3 of 3 rows failed on Home before, 0 of 3 after, and 0 of 11 on Discover.
- **Series cards** no longer grow over their neighbours or drop a panel onto the row below. They lift with the same white outline as every other card and show rating, year, seasons, genres and a play button inside the artwork. `scripts/hover-probe.mjs`: max frame 8.5 ms, cards shift 0 px, 0 px overlap into the neighbour. The row's extra space below went from 230 px to 60 px.
- **Cut-off outline in grids.** `content-visibility: auto` on grid items (added in 2.0 for long lists) also clips anything painted outside the item, which is where the outline and shadow are. Removed; a hovered card now also sits above its neighbours so its shadow isn't covered. `hover-audit.mjs ring` finds no clipped outline on any page, and the 600-card scroll measures the same as before.
- **Regression caught by the user within minutes:** the first version of the dead-zone fix set `pointer-events: none` on `.row`, and the player's control bar is also a `.row`, so every player button stopped responding (keyboard still worked). The rule is now scoped to `.row-landscape` / `.row-poster`. A check of the player's class names against the new stylesheet found one more clash (`.shortcuts`, renamed to `.keys-help`) and a bare `kbd` rule (now `.app kbd`). Lesson: browse styles are global and stay loaded under the player; new rules there must not use bare generic names. Verified by clicking Pause and +10 s in the player.
- **IMDb ratings missing in many places (reported after turning them on in the release build).** Three causes. (1) The import finished early: `invoke("imdb_sync")` can return before the last channel batches reach the front end, so the table was swapped in with 86,000 of 137,004 rows while the app reported the full count. The import now waits for the Done message, checks the saved row count against the importer's count before swapping, and at start-up re-imports if the saved count doesn't match. (2) Library posters, the Home series cards, Discover's banner and the title page's facts only knew TMDB ratings; they now use one shared rating component (`components/browse/ratings.tsx`). (3) Every poster needed a TMDB request for its IMDb id before showing anything. Now the rating of the only IMDb title with the same name, year and kind shows at once (index `imdb_title`), and the link is still confirmed with TMDB and corrected if it differs. Measured on a fresh Browse page: 18 of 20 posters showed IMDb within 0.7 s; the rest were unreleased or too new to be rated.
- **Season buttons past S8 unreachable in the player's episode list (reported while watching Friends, 10 seasons).** The season buttons sat on one line that scrolled sideways with its scrollbar hidden, so with a mouse there was no way to reach the ones that didn't fit. This was there before 2.0. They now wrap onto further lines (with a thin scrollbar if a show has enough seasons to pass 120 px); the season buttons on a title page had the same pattern and wrap too. Verified in the player: all ten buttons fully visible on two lines, clicking S10 lists its episodes. Lesson: a scroller with a hidden scrollbar is only acceptable where something else (arrows, wheel handling) moves it.
- **Search stopped taking input after the first letter (reported in the release build).** The first letter opens the Search page, and every page takes keyboard focus when it becomes active so that arrows and Page Down scroll it. That rule skipped the case "focus is already inside the page", written when the search box was part of the page; in 2.0 the box moved to the top bar, so the page pulled focus out of it. The remaining letters then went to the page, where Backspace means "go back" and `g` starts a jump shortcut. A page no longer takes focus while the user is typing in a field. Verified with real key events through the debug port: with the fix "breaking" and "friends" (25 ms between keys) arrive whole, Backspace edits the text, the first Esc clears it and the second leaves the page, and "dune" lists results; with the fix switched off the same script leaves "b" in the field and Backspace goes back to Home. There is no automated test for this (the test suite covers pure functions, not components).
- **Also fixed in the pass:** the "Part of …" strip was a full-width box around five small posters (now as wide as its posters); episode descriptions ran the full window width (capped at about 110 characters); search showed unrelated collections (TMDB also matches descriptions; now the name must contain the words) and photo-less people; a hint on Coming Soon sat 4 px off the page edge; arrows faded while the pointer crossed the gaps between cards.

### Skip intro (2026-11-17, v2.1.0)

Built from [docs/PRD-skip-intro.md](docs/PRD-skip-intro.md).

**What changed**
- **Detection, on this PC only.** Three sources in priority order: the user's own marker, a chapter named like an intro or credits, and audio matching. Audio matching (`src-tauri/src/segments.rs`): the bundled ffmpeg decodes the opening `min(10 min, 30%)` and closing `min(5 min, 20%)` of each episode to 11,025 Hz mono, `rusty-chromaprint` 0.3.0 (MIT) turns that into a fingerprint (about 8 items a second), cached in `%LOCALAPPDATA%\com.offplayer.app\fingerprints`. Each episode is compared with its four nearest neighbours in the season; the longest shared stretch counts if it lasts 15–150 s (credits 15–300 s), and two agreeing neighbours (within 3 s at both ends) are needed. Item timing was calibrated on synthetic audio: item k describes audio about 1.07 s after k × 0.124 s.
- **Differs from the PRD:** (1) The comparison is our own, not the crate's `match_fingerprints`: that function looks at a single alignment and splits runs at score changes, while ours tries the six strongest alignments and keeps the longest run with gaps up to 2 s. (2) A **fade step** the PRD didn't have: the music can stop several seconds before the title sequence does (Friends seasons 5–10 end on "Created by" over different audio), but every intro measured ends with black picture over a moment of silence. After matching, ffmpeg's `blackdetect` and `silencedetect` look from 1 s before to 8 s after the detected end, and the intro ends where the picture comes back (`segment_intro_tail`). (3) The fingerprint cache lives with the other caches in `%LOCALAPPDATA%`, not `%APPDATA%`. (4) When detected credits run to the end of the file, the Next-episode card never comes later than the old fixed guess, because matching sometimes finds only the tail of the credits.
- **Background work** (`src/library/segmentScan.ts`): one season at a time, one ffmpeg process at below-normal priority, a quiet "Finding intros" pill in the top bar. Pauses while a library job runs and while the player is open, except that the season being watched jumps the queue and is analysed during playback. Every analysed episode is recorded in `segment_scans` (migration 007), including "nothing found"; `ANALYSIS_VERSION` (now 2) re-runs everything except manual markers. Unreachable files skip the season for the session without recording a failure.
- **Player:** Skip intro button (S or Enter) in the Next-episode card's corner, staying visible when the controls hide and dimming after about 6 s idle; auto-skip once per file when playback runs into the intro (not after a seek, not on resume mid-intro), flash "Intro skipped · ← to go back"; intro and credits tinted on the progress bar and named in its tooltip; an Intro section in the gear menu (Starts here, Ends here, None, Use these times for the rest of season N, Back to automatic); dropped frames added to the stats panel (I).
- **Settings → Playback → Skip intro:** button on/off, auto-skip (off by default), finding on/off, status line, Analyze now, Clear all markers (optionally including your own). Title page menu: Find intro again. What's New card for people updating from 2.0.

**Measured (dev build on this PC, muted, over the debug port; whole library: 470 episodes in 23 seasons)**

| Check | Result |
|---|---|
| S1 coverage | Friends **232 of 234** intros; the two without (S1E17, S7E24) have no title sequence, credits run over a scene (checked by frames). TNG **176 of 176** intros, **153 of 176** credits. Snowfall has no title sequence: no intros, except a 20 s TV-rating card and FX logo at the start of four S4 files, which repeat and are found as an "intro"; 41 credits by audio, 8 from chapters named "Credits" (S6) |
| S2 edge accuracy, ±3 s | Frames 3 s inside and outside each edge, checked by eye: Friends intros 40 of 40 edges, TNG intros 40 of 40, TNG credits: 8 of 8 ends but only 4 of 8 starts (the others found only the last 16–20 s of the closing music) |
| S2 edge accuracy, ±1.5 s | TNG intros 16 of 16. Friends, two samples of 8: before the fade step 13 of 16 in the first; after it 15 of 16 and 13 of 16. All five misses are the same case: seasons 5, 9 and 10 mix a ~30 s and a ~46 s cut of the title sequence, and an episode with the longer cut gets its neighbours' length (end up to 17 s early; S9E21 also starts ~2 s early). Overall 44 of 48 edges after the fade step (92%) |
| Speed | First pass over the library: 1.0–1.3 s per Friends fingerprint (1080p HEVC), 0.4–0.6 s per TNG one, slowest 5.8 s. Comparing a 26-episode season: about 0.25 s. Fade step: 0.27 s per intro on average. Re-checking all 23 seasons from cache (after the version bump): 6.2 s of matching plus 110 s of fade checks. Cache: 940 files, 11.9 MB |
| S3 button | Shows from the start of the intro; S and click land on its end ("Intro skipped"); seeking back shows it again; seek time average 35 ms over 10 seeks including 5 skips |
| S5 manual | Starts here / Ends here (also start-then-end), None hides button and tint, Back to automatic restores the detected one, Use these times applied to 23 other episodes; "Clear all markers" with the box ticked removed them |
| S6 no intro | Snowfall seasons record "nothing found" and aren't analysed again (re-checks after the version bump read only the cache) |
| S7 background | One process; paused during a rescan (one fingerprint already running finished, nothing new started until the job ended); paused while playing an analysed season (count unchanged over 10 s); while playing TNG S7E1 from an unanalysed season, that season was analysed first (25 episodes in about 30 s) with **0 dropped frames**, then work paused again; after a reload mid-season, 40 cached fingerprints were reused |
| S8 auto-skip | Ran into the intro at 1:11 and landed at 1:57; no skip on resume inside the intro; no second skip in the same file; seeking into the intro shows the button instead |
| S9 credits | TNG S7E1: card at 44:19 (detected credits), 7 s before the old guess, countdown running, Watch credits dismisses it |
| S10 settings | Button off: no button or tint in the player, without a restart; auto-skip row greys out; status line counts; Clear all markers; Find intro again cleared Friends' 234 records and season 1 was redone from cache within 20 s |
| S11 network | The feature runs only ffmpeg and ffprobe on local files; no network code was added |

**Not verified:** a file with chapters actually named "Intro" or "Opening" (none in this library; the chapter rules are unit-tested, and the "Credits" chapters in Snowfall S6 were used); the "something plays after the credits" rule in the player (no such episode here; unit-tested); a show whose intro ends on a hard cut without a fade (the fade step then changes nothing, by design, but wasn't seen); an unplugged drive (code path only); anime; performance on a slower PC, a spinning hard disk or a network drive (the library is on a USB-attached SSD); a real install from the new installer on a clean PC; the accuracy of the first analysis in the installed 2.1.0 app (on its first launch the upgrade was checked: backup written, migration 007 applied, watch position kept; it went on to analyse 655 episodes by itself, not inspected further).

**Follow-up from use:** the Skip intro button sat 128 px from the bottom, which measured 8 px *inside* the progress bar's area (the bar's top is 136 px up, not the ~98 px estimated from the CSS). It and the Next-episode card now sit at 192 px, leaving 56 px (measured in the release build at 2560×1369), and the scrub preview draws above both.

**Follow-up from use: MacGyver's pilot had no Skip intro.** MacGyver season 1 switches between two versions of its title sequence, and the pilot's (8:34–9:45, after a long teaser) matches five later episodes but none of its four nearest neighbours, which were all the analysis compared. Now each episode is compared with every other episode of its season (up to 30, nearest first; a 26-episode season still matches in well under a second). The start is taken from the group with the most agreeing seconds (episodes × length), so a 72 s title sequence five episodes share beats an 18 s tail more of them share; the end is the latest one at least two others share, which also gives Friends' long-cut episodes their own ~47 s length instead of their neighbours' 30 s. `ANALYSIS_VERSION` 3. Measured with the harness against the previous rule: MacGyver S1 found 3 more intros (pilot, E14, E18) and corrected 4 that had only a partial match; Friends S5/S9/S10: 16 long-cut episodes extended to their full length (S10E5, S9E21 included); TNG S4: one short intro extended; Snowfall S1 unchanged (still none). Frames 2 s inside and outside the edges of five changed episodes (Friends S5E22, S9E1, S10E8, MacGyver S1E1, S1E14): all 20 right. Two new Rust tests (a theme switch mid-season, a longer cut shared by some episodes).

**Public release as 1.0.0 (2026-11-18).** Published on GitHub (`kr40/off-player`) under GPL-3.0-or-later; the version was renumbered from 2.1.0 to 1.0.0 for the first public release (the version numbers in this file are the internal history). The bundled libmpv build is GPL, which is why the app is GPL rather than MIT; Settings → About said mpv was LGPL and now says GPL, with a link to the source and `THIRD_PARTY.md` listing each bundled binary, its version and where its source is. Before the first commit, personal details were removed: the library path and release-group tags in the docs and tests, and the parser fixture renamed `sample-library.json` with generic tags (show and episode names kept; the tests depend on them).

**Follow-up from use: analyse each episode once.** Raising `ANALYSIS_VERSION` re-analysed the whole library on the next launch, which the user didn't want. Now an episode with any `segment_scans` row counts as done, whatever version wrote it; the version is only recorded. A season that gains episodes analyses only the new ones: they are fingerprinted, the episodes analysed before are compared only from their cached fingerprints (`segment_fingerprint` with `cachedOnly`; their files are read again only if fewer than three fingerprints would be available), and only the new episodes' markers and records are written. Analyze now checks never-analysed episodes and retries failed or unreachable ones; only Clear all markers (or Find intro again for one show) re-analyses everything. Checked in the test build: a Friends S2 episode made "new" (record, markers and cached fingerprint removed) was the only one read (2 file reads, 46 cached reads of the other 23), 0 of 48 existing markers in S2–S3 changed, a season recorded at version 1 was left alone; Analyze now with nothing new did nothing; Clear all markers re-analysed all 794 episodes in about 4 minutes from cache and ended with the same 1,250 markers.

**Follow-up from use: Watched on library cards.** Library posters (Library, Search, My List) and the landscape cards on Home now have the same round Watched button as Discover cards, at the top-right on hover (W on a focused card). It marks every episode or the movie watched, or all unwatched again, like the title page's menu, with Undo that restores each file's previous position (checked: Rush Hour's 6:41 resume point came back). Fully watched posters show a "Watched" badge; partly watched series "N of M watched". `listTitles` now counts main files and watched ones. Arrow keys and W now also work on the Home landscape cards (`.tcard-art` is their focusable element).

**Follow-up from use: year-first movie names.** `Rush Hour Trilogy (1998-2007)/1998.Rush.Hour.1920x784.BDRip…` was read as "1998 Rush Hour 1920x784" with no year, so TMDB found nothing. Pixel sizes (`1920x784`) are now release tags, and a year in front counts as the release year in dotted scene names or `1998 - Title` names, when no other year follows; "1917", "2012" and `2001.A.Space.Odyssey.1968…` keep their titles (unit-tested). After the rebuild, the launch rescan regrouped the three files and TMDB matched all three at 95% (Rush Hour 1998, 2 2001, 3 2007, all in TMDB's collection); the 6:40 watched in the first film carried over.

**Installer:** `Off Player_2.1.0_x64-setup.exe`, 80.3 MB (2.0.0 was 80.1 MB). 385 licences listed, `rusty-chromaprint` (MIT) among them.

**Tests:** 116 Vitest tests (25 new: marker priority, chapter names, regions, snapping, the fade rule, button and auto-skip timing, the credits card) and 11 Rust tests (9 new for the detector: synthetic music with a shared theme at four offsets, unrelated audio, a 10 s sting, the same file twice, a two-episode season, the length limit, odd-sized reads, the cache format, the fade parser), plus the ignored real-season harness. `cargo test --lib real_season -- --ignored` measures a real season (see README).

## 9. Project layout

```
off-player/
  src-tauri/            Rust shell, tauri.conf.json, lib/ (libmpv DLLs)
  src/
    app/                routes: home, show, movie, search, player, settings
    components/         Hero, Row, Card, EpisodeList, PlayerControls, Scrubber…
    player/             mpv bridge: commands, observed properties, hooks
    library/            scanner, filename parser, ffprobe, TMDB client
    db/                 schema, migrations, queries
    styles/             tokens.css
  PLAN.md
```

## 10. Verification

- Phase 0: the TNG pilot plays with 5.1 sound, its `.srt` shows and toggles, seeking is instant, the HTML overlay is clickable.
- Parser: unit tests over real names, starting with all 176 TNG files (every one must land on the right TMDB episode), then other folders as they are added.
- Resume: play, kill the app from Task Manager, reopen, confirm position within 5 s.
- Auto-next: watch the last minute of an episode, confirm the next one queues and the first leaves Continue Watching.
- Offline: disconnect the network, confirm browsing, artwork and playback all work.

## 11. Decided

- **TMDB** for artwork and episode info. You create a free TMDB account and API key and paste it into the app's settings on first run; it is stored locally and used only during scans.
- **Desktop only.** No server, no remote clients.
- **Out of scope for now:** HDR output. (Skip Intro shipped in 2.1.0.)
- **First library:** `D:\Media\Star Trek - The Next Generation`, used as the test set throughout.

## 12. Not verified yet

- That `tauri-plugin-libmpv` embeds cleanly under the web UI on this machine. Phase 0 settles it.
- That TMDB numbers the TNG pilot and finale as single episodes, matching these files. The title cross-check handles it either way.
- How the rest of the collection is named. Only the TNG folder has been looked at; the folder-first approach and review screen are designed to absorb the variety.

## 13. Later ideas

- Sharper upscaling for DVD-resolution shows using mpv's high-quality scalers on the GPU.
- Collections (e.g. all Star Trek series under one tile).
- HDR output.
- Skip intro: handle episodes with a longer cut of the title sequence than their neighbours (compare across seasons too); credits starts for shows whose closing music only partly repeats.

## Sources

- tauri-plugin-libmpv: https://docs.rs/crate/tauri-plugin-libmpv/0.3.2/source/README.md
- tauri-plugin-mpv (fallback): https://lib.rs/crates/tauri-plugin-mpv
- Browser codec limits: https://jellyfin.org/docs/general/clients/codec-support/
- Netflix TV redesign: https://www.macrumors.com/2025/05/07/netflix-redesigned-tv-experience/ , https://www.androidauthority.com/netflix-new-tv-experience-redesign-3555283
- Client design comparisons: https://jellywatch.app/blog/best-jellyfin-desktop-client-windows-macos-linux-2026 , https://forums.plex.tv/t/apple-tv-use-tvos-player-ui/903103
