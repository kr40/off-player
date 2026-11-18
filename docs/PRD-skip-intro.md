# PRD: Skip Intro (and better credits detection)

| | |
|---|---|
| Target version | 2.1.0 |
| Status | Implemented in 2.1.0 (see `PLAN.md` for what was measured and what differs from this spec) |
| Written | 2026-11-17 |
| Builds on | v2.0.0 (see `PLAN.md`, `docs/PRD-2.0-discover-lists-collections-imdb.md`) |

This document is written to be handed to someone who has not seen the earlier work. Section 12 lists the working rules for this project; read it before touching anything.

## 1. Summary

When an episode reaches its title sequence, the player shows a **Skip intro** button that jumps to the end of it. Off Player works out where each intro is **on the user's PC, from the files themselves**: it uses chapter markers when a file has them, and otherwise finds the stretch of audio that repeats across the episodes of a season (the theme music). The same analysis finds where the end credits start, which replaces the player's current guess for when to show the "Next episode" card. The user can correct or remove a marker by hand.

No online timestamp service is used. Nothing about the user's files leaves the PC.

## 2. Goals and non-goals

**Goals**

- G1. A Skip intro button that appears at the right moment for most episodes of a show with a recurring title sequence, without the user doing anything.
- G2. Each episode has its own start and end, so cold opens of different lengths work.
- G3. The "Next episode" card appears when the credits really start, where that can be detected.
- G4. Analysis runs in the background, never disturbs playback, survives restarts, and never repeats work it has done.
- G5. The user can fix a wrong marker in a few clicks, and a manual marker is never overwritten.
- G6. Optional automatic skipping.

**Non-goals (this version)**

- Skipping "Previously on…" recaps. They differ per episode, so audio matching cannot find them. (If a file has a chapter named Recap, it is ignored, not skipped.)
- Online timestamp databases (AniSkip and similar). They are keyed to a particular cut of an episode and often do not line up with the user's file. Could be a later extra source.
- Movies. One file has nothing to compare against; chapter markers in movies are ignored.
- Video-based detection (black frames, logo matching). Only a possible later refinement.
- Sharing markers between users, or exporting them (see open question Q4).

## 3. Scenarios

1. The user adds Friends (236 episodes). A while later, without doing anything, every episode shows Skip intro when the theme starts, including episodes where the cold open runs two minutes and ones where it runs four.
2. The user starts an episode of a show added a minute ago, before the background analysis has reached it. The app analyses that season first; the button is there for the next episode at the latest.
3. An anime file has chapters named "Opening" and "Ending". The button works immediately, with no analysis.
4. The button appears two seconds late on one episode. The user opens the player menu, moves the marker, and it stays that way.
5. The user turns on "Skip intros automatically" and binge-watches; intros are skipped with a brief note on screen, and one key press goes back.
6. A show has no title sequence, only a five-second title card. No button appears, and the app does not keep re-analysing it on every launch.

## 4. Current state (what exists in v2.0.0)

- **Player**: `src/components/Player.tsx` (+ `Player.css`), driving libmpv through `tauri-plugin-libmpv-api` (`command`, `getProperty`, `setProperty`). Player state `s` includes `time`, `duration`, and `chapters` (from mpv's `chapter-list`: `{ title, time }`).
- **Credits guess** (`Player.tsx`, "up next" block): `creditsAt` is a chapter whose title matches `/credit|ending|outro/i` in the last 30% of the file, otherwise `duration − clamp(2.5% of duration, 20 s, 45 s)`. `inCredits` drives the Next-episode card, its countdown and autoplay (`advance`, `COUNTDOWN`, `STILL_WATCHING_AFTER`).
- **Keys in use in the player**: Space K J L arrows F M C A N P E `[` `]` `=` `,` `.` I `?` `/` digits, Esc, Backspace. **S and Enter are free.**
- **Player preferences**: `src/player/mpv.ts` (`Prefs`, `getPrefs`, `savePref`, stored in the `settings` table). Autoplay is toggled both in the player menu and in `src/pages/SettingsPage.tsx`.
- **Database**: SQLite through `tauri-plugin-sql`; migrations `src-tauri/migrations/001…006`, registered in `src-tauri/src/lib.rs`. Relevant tables: `files` (one row per video: `fingerprint`, `title_id`, `season`, `episode`, `role`, `duration`, `chapters` (a count only), `path`), `titles` (`kind` is `show` or `movie`), `playback` (keyed by `files.fingerprint`, so renames keep history), `settings` (key/value).
- **FFmpeg**: a bundled LGPL shared build (`src-tauri/lib/ffmpeg`, FFmpeg 9.0). Always start it with `crate::tools::command("ffmpeg" | "ffprobe")` (`src-tauri/src/tools.rs`), which prefers the bundled copy. `src-tauri/src/artwork.rs` has examples of running it without a console window (`no_window`), and `media.rs::inspect_media` runs ffprobe during scans.
- **Background work**: `src/library/jobs.ts` (`runJob`, shows a progress pill in the top bar), start-up sequence in `src/library/actions.ts::startup` then `src/library/startup2.ts::afterStartup`.
- **Rust → JS streaming pattern**: `src-tauri/src/imdb.rs` + `src/discover/imdb.ts` (Rust computes, sends progress over a Tauri `Channel`, JS writes to the database).

## 5. How detection works

Three sources, in priority order. A higher one always wins; `manual` is never overwritten.

| Source | When | Cost |
|---|---|---|
| `manual` | The user set or removed a marker | none |
| `chapter` | The file has a suitably named chapter | none |
| `audio` | A segment of audio repeats across the season | a few seconds of CPU per episode, once |

### 5.1 Chapter markers

A chapter is the **intro** when its title matches `/^(intro|opening( credits| theme)?|op|main titles?|title sequence|theme)\b/i`, it starts in the first 40% of the file, and it lasts 15–150 s (its end is the next chapter's start). A chapter is the **credits** when its title matches `/credit|ending|outro|\bed\b/i` (the player's existing test, plus "ED") and starts after 50% of the file; credits run to the next chapter or the end of the file.

Read chapters in two places:

- **At play time**, from the player's existing `s.chapters`. This makes the button work at once for a file that has never been analysed. Save what is found as a `chapter` row.
- **During analysis**, with ffprobe (`-show_chapters`), so files with usable chapters skip audio work. `inspect_media` already counts chapters; either extend it or add a small command.

### 5.2 Audio matching

Unit of work: **one season of one show** (`files` rows with `role = 'episode'`, same `title_id` and `season`, `titles.kind = 'show'`), in episode order. A season needs at least two episodes. Specials (season 0) are skipped.

**Step 1: fingerprint.** For each episode and each region, decode audio with the bundled FFmpeg and fingerprint it in Rust.

- Regions: **intro** = the first `min(600 s, 30% of duration)`; **credits** = the last `min(300 s, 20% of duration)`.
- FFmpeg writes raw audio to stdout: mono, 11,025 Hz, signed 16-bit (`-map 0:a:0 -vn -sn -dn -ac 1 -ar 11025 -f s16le -`), with `-ss`/`-t` placed before `-i` for the region. First audio stream.
- Fingerprinting: the `rusty-chromaprint` crate (pure Rust port of Chromaprint; version 0.3.0, MIT, checked on crates.io on 2026-11-17). Use one fixed `Configuration` preset everywhere; fingerprints made with different presets cannot be compared. The crate's `Fingerprinter` takes interleaved samples via `start(sample_rate, channels)`, `consume`, `finish`, `fingerprint()`, giving a `Vec<u32>` with roughly eight items per second. **Confirm the exact signatures on docs.rs before relying on this description.**
- Cache each fingerprint as a small file under `%APPDATA%\com.offplayer.app\fingerprints\` named by `files.fingerprint` and region (about 20 KB per region). They are needed again when new episodes of the season arrive. Delete cache files for videos no longer in the library.

**Step 2: compare.** For an episode E, compare its intro fingerprint with those of its neighbours (E+1, E−1, E+2, E−2, …, up to four) using the crate's `match_fingerprints`, which returns the segments two fingerprints have in common, with offsets in each. Convert offsets to seconds with the configuration's item duration. Keep, from each pair, the longest common segment lasting **15–150 s**. Check which direction the crate's segment score runs (lower may mean more alike) and set a threshold from real data.

**Step 3: agree.** A candidate is E's (start, end) from one pair. Candidates agree when both ends are within 3 s. Accept the largest agreeing group, taking the median start and end:

- two or more agreeing candidates → accept, confidence = agreeing ÷ compared;
- exactly one candidate and the season has only two episodes → accept with low confidence;
- otherwise → no intro for this episode.

**Step 4: tidy the edges.** If a chapter boundary lies within 3 s of an edge, snap to it. Then pull the end in by 0.5 s so a skip never lands past the first line of dialogue. (Snapping to silence with FFmpeg's `silencedetect` is an optional refinement; only add it if measured accuracy in section 10 falls short.)

**Credits** use the same steps on the credits region, with these differences: accepted length 15–300 s; the result must start after 50% of the file; times are converted back from region-relative to file-relative.

**Things that must not be mistaken for an intro**

- A studio logo or sting shared by all episodes: under 15 s, so excluded by the minimum length.
- Two episodes that are the same file twice (duplicates, or a two-part file listed twice): if two fingerprints match over more than 80% of the region, skip that pair.
- A match that covers the first seconds of the file in one episode and minutes later in the other is fine and expected (cold opens).

### 5.3 Record what was tried

Every analysed episode gets a row saying so, including "nothing found", so launches do not redo work. An `ANALYSIS_VERSION` constant is stored with it; raising the constant re-analyses everything that is not `manual`.

## 6. Background analysis

- **When it runs**: after the start-up scan and metadata jobs; after a library folder is added or rescanned; when the user presses "Analyze now" in Settings or "Find intro again" for a show; and with priority when an episode starts playing from a season that has not been analysed (that season jumps the queue).
- **Never in the way**: one FFmpeg process at a time, started at below-normal priority, no console window. **Analysis pauses while the player is open** (finish the current file, then wait) and resumes when it closes. The priority case above is the exception: it may analyse the current season while its first episode plays, at one process, because the files are short reads of audio only. If section 10's playback measurement shows any dropped frames from this, drop the exception.
- **Resumable**: work is recorded per episode. Closing the app mid-run loses at most the file in progress.
- **Visible but quiet**: use the existing job pill ("Finding intros · Friends S3 · 41%"). No dialogs, no toasts. Settings shows totals (section 7.4).
- **Failures**: a file FFmpeg cannot read is recorded as failed with the reason and retried only when the file changes or the analysis version rises. One bad file must not stop the season.
- **Missing drive**: if the library folder is not reachable, skip without recording anything.

## 7. What the user sees

### 7.1 Skip intro button

- Appears while `intro.start ≤ time < intro.end − 1`, bottom right, above the control bar, in the same position and visual family as the existing Next-episode card (they cannot be on screen together). Label: **Skip intro**.
- It is visible whether or not the player controls are showing. After 6 s without pointer movement it dims to a quieter state rather than disappearing, and returns to full strength on any movement.
- Activating it (click, **S**, or **Enter** while it is shown) seeks to `intro.end` and shows the player's existing flash text: "Intro skipped". Pressing S when no intro is active does nothing.
- If the user seeks back into the intro, the button comes back.
- Not shown when: the intro is turned off in Settings, the file has no marker, or fewer than 5 s of intro remain.
- Entrance and exit use the app's motion tokens (`--t-base`, `--ease-out-soft`); with reduced motion it simply appears.
- Accessible name "Skip intro"; reachable by Tab.

### 7.2 Automatic skipping

Setting "Skip intros automatically" (off by default). When on, the skip happens by itself when playback **runs into** the intro (crosses its start while playing, or the file starts inside its first 2 s), at most once per file load. Flash text: "Intro skipped · Left arrow to go back". It does not fire when the user seeks into the intro or resumes in the middle of it; then the button shows as normal.

### 7.3 Credits

Replace the `creditsAt` guess with, in order: a `manual` or `chapter` or `audio` credits marker; else the existing chapter test; else the existing end-of-file fallback. One safeguard: when a detected credits segment ends more than 20 s before the end of the file (something follows the credits), show the Next-episode card at the credits but **do not start the autoplay countdown** until the old fallback point, so a scene after the credits is not cut off.

### 7.4 Settings (`SettingsPage.tsx`, Playback section)

- **Skip intro button** (on by default).
- **Skip intros automatically** (off by default; disabled when the button is off).
- **Find intros and credits automatically** (on by default). Turning it off stops analysis; existing markers stay.
- Status line: "Intros found in 212 of 236 episodes · 3 could not be read", with **Analyze now** and **Clear all markers** (confirm first; keeps manual markers unless a second checkbox is ticked).
- A one-line note: "Worked out on this PC from your files. Nothing is sent anywhere."

### 7.5 Fixing a marker (player menu)

A new "Intro" entry in the player's settings menu, for the episode being played:

- **Intro starts here** / **Intro ends here** (set to the current time; the pair is saved once both make sense: end after start, 5–300 s apart).
- **No intro in this episode**.
- **Use these times for the rest of season N** (only offered after a manual change; applies the same start and end to episodes of the season that have no manual marker; meant for shows whose intro is always at the same time).
- **Back to automatic** (removes the manual marker and restores the detected one).

Also on the title page's menu for a show: **Find intro again** (re-analyses that show, keeping manual markers).

### 7.6 Scrubber (should-have)

Show the intro and credits as a faint tinted stretch on the progress bar, so a wrong marker is easy to see.

### 7.7 Help

Add S to the player's shortcut help and to `src/components/ShortcutHelp.tsx`. Add a line to the What's New panel (`Onboarding.tsx::WhatsNew`) for 2.1.0.

## 8. Data model

New migration `src-tauri/migrations/007_segments.sql`, registered in `lib.rs`.

```sql
-- Where the intro and credits are in a video. Keyed like `playback`, by the
-- file's fingerprint, so renames and moves keep markers.
CREATE TABLE segments (
  fingerprint  TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('intro', 'credits')),
  start_s      REAL,              -- NULL start and end with source 'manual' = "the user says there is none"
  end_s        REAL,
  source       TEXT NOT NULL CHECK (source IN ('manual', 'chapter', 'audio')),
  confidence   REAL,              -- audio only: share of compared neighbours that agreed
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, kind, source)
);

-- One row per analysed file, including "nothing found", so work is not repeated.
CREATE TABLE segment_scans (
  fingerprint  TEXT PRIMARY KEY,
  version      INTEGER NOT NULL,  -- ANALYSIS_VERSION at the time
  scanned_at   INTEGER NOT NULL,
  error        TEXT               -- why the file could not be analysed, if so
);
```

The primary key includes `source` so a manual marker and the detected one can both exist ("Back to automatic" just deletes the manual row). The marker in effect for a file and kind is the row with the highest-priority source.

New settings keys: `skip_intro` (`true`/`false`), `skip_intro_auto`, `detect_segments`. Add them to `Prefs` in `src/player/mpv.ts` alongside `autoplay`, and to `src/app/preload.ts` if they affect first render.

## 9. Implementation notes and known pitfalls

**Suggested shape**

- Rust: new module `src-tauri/src/segments.rs` with commands such as `fingerprint_region` (run FFmpeg, fingerprint, cache to disk) and `match_season` (load cached fingerprints, compare, agree, return markers), plus a cancel flag like `imdb_cancel`. Keep the comparing and agreeing logic in pure functions so they can be unit-tested without media.
- TypeScript: `src/library/segments.ts` (queue, database reads and writes, a small store with a hook for the player), pure helpers `activeSegment(time, markers)`, `effectiveMarker(rows)`, `classifyChapter(title, time, next, duration)`, `creditsStart(...)` with tests.
- Player: a `SkipIntro` component next to the up-next card; one new effect for auto-skip; `creditsAt` reads the marker first.

**Pitfalls already met in this codebase (each cost a bug)**

1. **Return data from `invoke`, not over the Channel.** `invoke()` can resolve before the last Channel messages are delivered; an import was once saved with 86,000 of 137,004 rows because of it. Use the Channel for progress only, and return markers as the command's result.
2. **`tauri-plugin-sql` pools connections.** `BEGIN … COMMIT` spread over several `execute` calls may land on different connections. Use single statements, or one `execute` holding the whole batch.
3. **Browse styles are global and stay loaded under the player.** `browse.css` and `v2.css` once broke every player button through a bare `.row` rule. New class names must be specific (`.skip-intro`, not `.skip` or `.button`), and player styles go in `Player.css` under `.player`.
4. **No literal `z-index`.** Use the layer tokens in `src/styles/base.css`.
5. **A hidden-scrollbar scroller is unreachable with a mouse.** Do not use one for anything the user must reach.
6. **The dev build and the installed app share one database** (`%APPDATA%\com.offplayer.app\offplayer.db`). A migration run by the dev build changes the user's real data; see section 12 for the backup routine. The app also makes its own backup when the version number changes, so bumping to 2.1.0 during testing creates a test-derived backup that must be cleaned up (section 12).
7. **React Fast Refresh re-runs start-up effects** on every save, so the analysis queue must tolerate being started twice (guard with a module-level flag, as `Shell.tsx` does with `startedOnce`).
8. **Do not call `getProperty(…, "node")`** on the mpv plugin; that path crashes natively (noted in `Player.tsx`).
9. **Licences**: `npm run build` regenerates `src/generated/licenses.json` via `scripts/gen-licenses.mjs`. Check whether Rust crates are covered there, and make sure `rusty-chromaprint` (MIT) is credited wherever the others are.
10. **FFmpeg `-ss` before `-i`** seeks by keyframe, which is fine for audio regions, but the region's real start can differ slightly from the requested one. Take the actual start from the first packet's timestamp if the measured edge accuracy is off by a constant.
11. **Files with several audio tracks** (dubs): theme music is normally the same in every track, so the first stream is used. If a season mixes files with different first tracks, matching may fail for those episodes; that is acceptable and falls back to no button.

## 10. Verification

State what was measured and what was not. Do not mark a criterion met without running it.

**Automated**

- Rust unit tests for comparing and agreeing, using synthetic audio: generate PCM in the test (for example noise of different seeds around a shared 40 s tone sequence placed at different offsets), fingerprint it, and assert the shared stretch is found within 1.5 s at each edge; assert no result for unrelated noise, for a 10 s shared stretch, and for identical inputs.
- TypeScript tests for the pure helpers (button window, source priority, chapter naming, credits fallback and the "something follows the credits" rule).
- `npx vitest run` and `npx tsc --noEmit` clean; existing 91 JS tests and 2 Rust tests still pass.

**Against real files** (the user's library has three shows: a sitcom with varying cold opens, an hour-long drama, and a 1980s–90s series with a long title sequence)

- Coverage: share of episodes per show with an intro marker. Report the numbers.
- Accuracy without listening: for at least 10 episodes per show, grab frames with FFmpeg at `start − 3 s`, `start + 3 s`, `end − 3 s`, `end + 3 s` and look at them. Title-sequence imagery should be present just inside the marker and absent just outside. Report how many of the sampled edges were right.
- Timing: seconds per episode and total for the largest show. Report them.
- Playback: play an episode while the priority analysis runs and record dropped frames from the player's diagnostics panel (key I).

**In the app** (dev build, driven through the debug port; see section 12)

- Button appears at the marker, S and click both seek to the end, flash text shows; seeking back brings it back.
- Auto-skip fires once when playback runs into the intro and not on a seek into it.
- Manual set / none / back to automatic / apply to season, each confirmed in the database and in the player.
- Next-episode card appears at detected credits; countdown held back when something follows the credits.
- Restart mid-analysis: it resumes and does not redo finished episodes.
- Settings toggles take effect without a restart.

**Performance targets** (targets, not yet measured)

- One region of one episode: under 3 s on the user's PC.
- Comparing one pair: under 50 ms.
- Skip seek feels instant: under 300 ms from key press to new picture on a local file.
- No dropped frames in playback attributable to analysis.

## 11. Acceptance criteria

| ID | Criterion |
|---|---|
| S1 | For a show with a recurring title sequence of 15 s or more, at least 85% of episodes get an intro marker with no user action. |
| S2 | In the hand-checked sample, at least 90% of marker edges are within 2 s of the real edge. |
| S3 | The Skip intro button appears within 1 s of the marker start and skipping lands within 1 s after the intro's end, never before it. |
| S4 | A file with a suitably named chapter shows the button on first play with no analysis. |
| S5 | Manual markers survive re-analysis, an analysis-version bump, a rename of the file, and an app restart. |
| S6 | A show with no recurring intro shows no button, and a second launch does no audio work for it. |
| S7 | Analysis never runs more than one FFmpeg process, pauses while the player is open (apart from the stated exception), and resumes after a restart without repeating finished episodes. |
| S8 | With auto-skip on, the intro is skipped once when playback runs into it, and not when the user seeks into it. |
| S9 | Where credits are detected, the Next-episode card appears within 2 s of their start; a scene after the credits is not cut off by autoplay. |
| S10 | All new settings work, and "Clear all markers" keeps manual ones unless told otherwise. |
| S11 | Nothing is sent over the network by this feature. |
| S12 | All tests pass, `tsc` is clean, the release build installs and runs, and the installer size grows by less than 2 MB. |

## 12. Working rules for this project

- **Private data.** The library, file names and watch history are the user's. Do not put them, or the TMDB key, into any outside service or into chat.
- **Not a git repository yet.** Do not create one, commit or push unless the user asks. When they do: keep the FFmpeg and libmpv binaries under `src-tauri/lib` (about 250 MB) out of it.
- **The user is usually at the PC and often watching something in the app.** Test without the real mouse, keyboard or sound:
  - Start the dev build with `OFFPLAYER_START_MUTED=1` and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9229`, and drive it with `node scripts/cdp.mjs` (eval / click / hover / key / shot) and `node scripts/at.mjs`. `scripts/peek.ps1` captures the window, including the video, without taking focus.
  - Before closing the installed app, check whether an episode is playing (the `playback` table's `last_played`), and **ask before closing if it is**.
  - Before any dev-build session: close the app, copy `%APPDATA%\com.offplayer.app\offplayer.db*` and `.window-state.json` aside. Afterwards: close the dev build, put the copies back, start the release build normally (no mute, no debug port), and tell the user their data was restored.
  - If the version number changed during the session, delete test-derived files in `%APPDATA%\com.offplayer.app\backups` and reset `backups\last-version.txt`, or the real upgrade skips its own backup.
  - Because this feature adds a migration, restoring the pre-test database means the real upgrade happens on the first launch of the new release build. That is the intended path; check it once.
- **Build**: `cargo` is not on PATH in the agent shell; prepend `%USERPROFILE%\.cargo\bin`. Release: `npm run tauri build` → `src-tauri/target/release/off-player.exe` and the installer under `src-tauri/target/release/bundle/nsis/`.
- **Do not change** the app identifier `com.offplayer.app`.
- **The app stays free and non-commercial** (TMDB and IMDb terms). This feature adds no new service.
- **Record the work** in `PLAN.md` in the same style as the 2.0 section: what was built, what was measured with numbers, and a plain "Not verified" list. Update `README.md` and `docs/INSTALL.md` where they describe features or shortcuts. Set the version to 2.1.0 in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.

## 13. Open questions (defaults chosen so work can start)

| # | Question | Default |
|---|---|---|
| Q1 | Should auto-skip be on by default? | Off. A wrong marker that skips by itself is worse than a button. |
| Q2 | How long may an intro be? | 15–150 s. Raise the upper limit only if a real show needs it. |
| Q3 | Analyse while an episode is playing? | Only the season being watched, one process. Drop this if any dropped frames are measured. |
| Q4 | Include manual markers in the export file (`src/library/transfer.ts`)? | Not in this version. |
| Q5 | Keep fingerprint cache files forever? | Yes while the video is in the library (about 40 KB per episode); delete when it leaves. |
| Q6 | Offer "Skip recap" when a chapter is named Recap? | No. |

## 14. Delivery plan

| Milestone | Contents | Done when |
|---|---|---|
| M1 | Migration, marker store, chapter-based markers, Skip intro button, S / Enter, settings toggle | S3, S4 pass on a file with chapters (make one with FFmpeg metadata if the library has none) |
| M2 | Rust fingerprinting and matching with unit tests; season analysis command | Synthetic tests pass; coverage and accuracy numbers reported for the three shows (S1, S2) |
| M3 | Background queue: scheduling, pause during playback, resume, priority for the season being watched, job pill, Settings status | S6, S7 pass |
| M4 | Credits marker feeding the Next-episode card; auto-skip; manual correction menu; scrubber tint; help and What's New | S5, S8, S9, S10 pass |
| M5 | Measurements, `PLAN.md` / README / INSTALL updates, version 2.1.0, release build, upgrade checked on the real database | S11, S12 pass; "Not verified" list written |
