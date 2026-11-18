import { useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getSetting, setSetting } from "../library/db";
import { clearWatchHistory } from "../library/actions";
import { clearSeen, setHideWatched, useHideWatched } from "../library/seen";
import { getPrefs, loadPrefs, savePref, type Prefs } from "../player/mpv";
import { PageScroll, useNav, type SettingsSection } from "../app/nav";
import TmdbKeyField from "../components/TmdbKeyField";
import { cancelImdb, enableImdb, IMDB_CREDIT, removeImdb, setRatingSource, syncImdb, useImdb } from "../discover/imdb";
import { applyImdbExport, backupCounts, exportData, importData, readBackup, readImdbExport, type Backup, type ImdbExport } from "../library/transfer";
import { localRegion } from "../lib/region";
import { restartOnboarding } from "../components/Onboarding";
import { showToast } from "../components/Toast";
import { useJobs } from "../library/jobs";
import { analyseNow, clearAllMarkers, kickSegments, segmentStatus, type SegmentStatus } from "../library/segmentScan";
import { useSegmentsVersion } from "../library/segments";
import LICENSES from "../generated/licenses.json";

const REPO = "https://github.com/kr40/off-player";

const SUB_SIZES = [
  { label: "Small", value: 0.8 },
  { label: "Medium", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Extra large", value: 1.5 },
];

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "General" },
  { id: "library", label: "Library" },
  { id: "playback", label: "Playback" },
  { id: "discover", label: "Discover & ratings" },
  { id: "data", label: "Data & privacy" },
  { id: "about", label: "About" },
];

export default function SettingsPage({ section }: { section?: SettingsSection }) {
  const [cur, setCur] = useState<SettingsSection>(section ?? "general");
  useEffect(() => {
    if (section) setCur(section);
  }, [section]);
  return (
    <PageScroll className="settings-page">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <h1>Settings</h1>
          {SECTIONS.map((s) => (
            <button key={s.id} className={cur === s.id ? "on" : ""} onClick={() => setCur(s.id)} aria-current={cur === s.id ? "page" : undefined}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body" key={cur}>
          {cur === "general" && <General />}
          {cur === "library" && <LibrarySettings />}
          {cur === "playback" && <Playback />}
          {cur === "discover" && <DiscoverSettings />}
          {cur === "data" && <DataPrivacy />}
          {cur === "about" && <About />}
        </div>
      </div>
    </PageScroll>
  );
}

function Section({ title, children, hint }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function Row({ label, sub, children }: { label: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <span>
        {label}
        {sub && <small>{sub}</small>}
      </span>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Seg<T extends string | number | boolean>({ value, options, onPick }: { value: T; options: { v: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={value === o.v ? "on" : ""} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

/** A destructive button that needs a second click within 4 s. */
function TwoStep({ label, armedLabel = "Click again to confirm", doneLabel = "Done", onConfirm }: { label: string; armedLabel?: string; doneLabel?: string; onConfirm: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  if (done) return <span className="status-ok">{doneLabel}</span>;
  return (
    <button
      className={`btn ${armed ? "danger" : ""}`}
      onClick={async () => {
        if (!armed) return setArmed(true);
        await onConfirm();
        setDone(true);
      }}
    >
      {armed ? armedLabel : label}
    </button>
  );
}

function General() {
  const [region, setRegion] = useState(localRegion());
  useEffect(() => {
    getSetting("watch_region").then((r) => r && setRegion(r));
  }, []);
  const countries = (() => {
    const names = new Intl.DisplayNames(undefined, { type: "region" });
    const codes = "AR AT AU BE BR CA CH CL CO CZ DE DK ES FI FR GB HK HU ID IE IL IN IT JP KR MX MY NL NO NZ PH PL PT RO RU SE SG TH TR TW UA US ZA".split(" ");
    return codes.map((cc) => ({ cc, name: names.of(cc) ?? cc })).sort((a, b) => a.name.localeCompare(b.name));
  })();
  return (
    <>
      <Section title="General">
        <Row label="Country" sub="Used for “where to watch” and streaming filters in Browse.">
          <select
            className="region-select"
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setSetting("watch_region", e.target.value);
            }}
          >
            {countries.map((c) => <option key={c.cc} value={c.cc}>{c.name}</option>)}
          </select>
        </Row>
        <Row label="Set-up" sub="Walk through the first-run steps again: folders, TMDB key, IMDb ratings, what you've watched.">
          <button className="btn" onClick={restartOnboarding}>Run set-up again</button>
        </Row>
        <Row label="Keyboard shortcuts" sub="Press ? anywhere to see them.">
          <button className="btn" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}>Show shortcuts</button>
        </Row>
      </Section>
    </>
  );
}

function LibrarySettings() {
  const { push } = useNav();
  const [rescan, setRescan] = useState(true);
  const hideWatched = useHideWatched();
  const [tools, setTools] = useState<{ ffmpeg: boolean; ffprobe: boolean; bundled: boolean } | null>(null);
  useEffect(() => {
    getSetting("rescan_on_launch").then((v) => setRescan(v !== "false"));
    invoke<{ ffmpeg: boolean; ffprobe: boolean; bundled: boolean }>("tool_status").then(setTools).catch(() => {});
  }, []);
  return (
    <Section title="Library">
      <Row label="Folders and matches" sub="Add or remove folders, rescan, fix a wrong match.">
        <button className="btn" onClick={() => push({ page: "manage" })}>Manage folders</button>
      </Row>
      <Row label="Check folders for new files on launch" sub="Takes a couple of seconds; only new or changed files are read.">
        <Seg value={rescan} options={[{ v: true, label: "On" }, { v: false, label: "Off" }]} onPick={async (v) => { await setSetting("rescan_on_launch", v ? "true" : "false"); setRescan(v); }} />
      </Row>
      <Row
        label="Thumbnails and durations"
        sub={tools ? (tools.ffmpeg && tools.ffprobe ? (tools.bundled ? "Using the copy of ffmpeg included with Off Player." : "Using ffmpeg from your PC.") : "ffmpeg wasn't found, so episodes without TMDB stills have no thumbnails.") : "Checking…"}
      >
        <span className={tools?.ffmpeg && tools?.ffprobe ? "status-ok" : "status-err"}>{tools ? (tools.ffmpeg && tools.ffprobe ? "Working" : "Unavailable") : ""}</span>
      </Row>
      <Row label="Hide titles I've watched in Discover rows" sub="When off, they stay visible with a Watched badge. Search always shows everything.">
        <Seg value={hideWatched} options={[{ v: true, label: "On" }, { v: false, label: "Off" }]} onPick={setHideWatched} />
      </Row>
      <Row label="Watch history" sub="Forget every resume point and watched mark. Your library and artwork stay.">
        <TwoStep label="Clear watch history" doneLabel="Cleared" onConfirm={clearWatchHistory} />
      </Row>
      <Row label="Watched list" sub="Forget every title you marked as watched in Discover. Library watch history isn't touched.">
        <TwoStep label="Clear watched list" doneLabel="Cleared" onConfirm={clearSeen} />
      </Row>
    </Section>
  );
}

function Playback() {
  const [prefs, setPrefs] = useState<Prefs>(getPrefs());
  useEffect(() => {
    loadPrefs().then(() => setPrefs(getPrefs()));
  }, []);
  const pref = async <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    await savePref(k, v);
    setPrefs(getPrefs());
  };
  return (
    <>
    <Section title="Playback">
      <Row label="Play the next episode automatically">
        <Seg value={prefs.autoplay} options={[{ v: true, label: "On" }, { v: false, label: "Off" }]} onPick={(v) => pref("autoplay", v)} />
      </Row>
      <Row label="Subtitle size">
        <Seg value={prefs.subScale} options={SUB_SIZES.map((z) => ({ v: z.value, label: z.label }))} onPick={(v) => pref("subScale", v)} />
      </Row>
      <Row label="Picture" sub="Sharper upscaling helps DVD-quality shows on a large screen.">
        <Seg value={prefs.quality} options={[{ v: "high", label: "Sharper" }, { v: "standard", label: "Standard" }]} onPick={(v) => pref("quality", v as Prefs["quality"])} />
      </Row>
    </Section>
    <SkipIntroSettings prefs={prefs} pref={pref} />
    </>
  );
}

function SkipIntroSettings({ prefs, pref }: { prefs: Prefs; pref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => Promise<void> }) {
  const [status, setStatus] = useState<SegmentStatus | null>(null);
  const [withManual, setWithManual] = useState(false);
  const { background } = useJobs();
  const segVersion = useSegmentsVersion();
  useEffect(() => {
    segmentStatus().then(setStatus).catch(() => {});
  }, [segVersion, background?.done]);
  const onOff = [{ v: true, label: "On" }, { v: false, label: "Off" }];
  return (
    <Section title="Skip intro" hint="Worked out on this PC from your files. Nothing is sent anywhere.">
      <Row label="Skip intro button" sub="Shown while an episode's title sequence plays. Press S to skip.">
        <Seg value={prefs.skipIntro} options={onOff} onPick={(v) => pref("skipIntro", v)} />
      </Row>
      <Row label="Skip intros automatically" sub="Jumps past the intro when playback reaches it. Press ← to go back.">
        <div className={prefs.skipIntro ? "" : "set-disabled"} aria-disabled={!prefs.skipIntro}>
          <Seg value={prefs.skipIntro && prefs.skipIntroAuto} options={onOff} onPick={(v) => prefs.skipIntro && pref("skipIntroAuto", v)} />
        </div>
      </Row>
      <Row
        label="Find intros and credits automatically"
        sub="New episodes are analysed once when they appear: the theme music is compared across the season, one file at a time, paused while you watch. Turning this off keeps what was found."
      >
        <Seg
          value={prefs.detectSegments}
          options={onOff}
          onPick={async (v) => {
            await pref("detectSegments", v);
            if (v) kickSegments();
          }}
        />
      </Row>
      <Row
        label="Status"
        sub={
          status
            ? status.episodes
              ? `Intros found in ${status.intros} of ${status.episodes} episodes, credits in ${status.credits}.` +
                (status.analysed < status.episodes ? ` ${status.episodes - status.analysed} not checked yet.` : "") +
                (status.failed ? ` ${status.failed} could not be read.` : "")
              : "No TV episodes in your library yet."
            : "Checking…"
        }
      >
        <button
          className="btn"
          onClick={() => analyseNow()}
          disabled={!prefs.detectSegments || !!background}
          title="Checks episodes that haven't been analysed yet and retries any that failed. Episodes already analysed are left as they are."
        >
          {background ? "Working…" : "Analyze now"}
        </button>
      </Row>
      <Row label="Clear all markers" sub="Forgets every intro and credits found and analyses every episode again from scratch. Only this does a full re-analysis; Analyze now checks new episodes only.">
        <label className="toggle small">
          <input type="checkbox" checked={withManual} onChange={(e) => setWithManual(e.target.checked)} /> Also the ones I set by hand
        </label>
        <TwoStep
          label="Clear"
          doneLabel="Cleared"
          onConfirm={async () => {
            await clearAllMarkers(withManual);
            if (prefs.detectSegments) kickSegments();
          }}
        />
      </Row>
    </Section>
  );
}

function DiscoverSettings() {
  const imdb = useImdb();
  const { progress } = useJobs();
  const ago = imdb.at ? Math.round((Date.now() - imdb.at) / 86_400_000) : null;
  return (
    <>
      <Section
        title="TMDB"
        hint={<>Posters, episode details, Discover, lists and collections come from TMDB. A free key is needed; it's stored only on this PC.</>}
      >
        <TmdbKeyField steps />
      </Section>
      <Section
        title="IMDb ratings"
        hint={<>Adds IMDb ratings next to TMDB's and lets Top Lists rank by IMDb. Off Player downloads IMDb's public rating files (about 240 MB, once a week) to this PC; nothing is sent to IMDb. IMDb allows this for personal, non-commercial use.</>}
      >
        {imdb.enabled && imdb.count > 0 ? (
          <>
            <Row label="IMDb data" sub={`${imdb.count.toLocaleString()} titles${ago !== null ? `, updated ${ago === 0 ? "today" : `${ago} day${ago === 1 ? "" : "s"} ago`}` : ""}. Refreshed automatically each week.`}>
              {imdb.running ? (
                <button className="btn" onClick={() => cancelImdb()}>Cancel update</button>
              ) : (
                <button className="btn" onClick={() => syncImdb()} disabled={!!progress}>Update now</button>
              )}
            </Row>
            <Row label="Rating shown on posters" sub="Title pages always show both.">
              <Seg value={imdb.source} options={[{ v: "tmdb", label: "TMDB" }, { v: "imdb", label: "IMDb" }]} onPick={setRatingSource} />
            </Row>
            <Row label="Remove IMDb data" sub="Deletes the downloaded ratings. TMDB ratings stay.">
              <TwoStep label="Remove" doneLabel="Removed" onConfirm={removeImdb} />
            </Row>
          </>
        ) : imdb.running ? (
          <Row label="Downloading IMDb ratings" sub="You can keep using the app. Progress is shown in the top bar.">
            <button className="btn" onClick={() => cancelImdb()}>Cancel</button>
          </Row>
        ) : (
          <Row label="IMDb ratings are off">
            <button className="btn primary" onClick={() => enableImdb()}>Turn on IMDb ratings</button>
          </Row>
        )}
        <p className="fine">{IMDB_CREDIT}</p>
      </Section>
    </>
  );
}

function DataPrivacy() {
  const [includeKey, setIncludeKey] = useState(false);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [imdbFile, setImdbFile] = useState<ImdbExport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Section title="Your data" hint="Watch history, lists, reactions and settings live in one database on this PC. Off Player keeps a copy of it before every update.">
        <Row label="Automatic backups" sub="The three most recent copies are kept.">
          <button className="btn" onClick={() => invoke("open_backups")}>Open backups folder</button>
        </Row>
        <Row label="Export my data" sub="One file with watch history, watchlist, watched titles, reactions, collections, saved filters and settings.">
          <label className="toggle small"><input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} /> Include my TMDB key</label>
          <button
            className="btn"
            onClick={async () => {
              const path = await save({ title: "Export Off Player data", defaultPath: `off-player-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "Off Player export", extensions: ["json"] }] });
              if (!path) return;
              try {
                const c = await exportData(path, includeKey);
                showToast(`Exported ${c.playback} watch positions, ${c.watchlist} watchlist and ${c.seen} watched titles`);
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            Export…
          </button>
        </Row>
        <Row label="Import data" sub="Merges an export into this PC's data. Entries with the same title are replaced.">
          <button
            className="btn"
            onClick={async () => {
              setErr(null);
              const path = await open({ title: "Import Off Player data", filters: [{ name: "Off Player export", extensions: ["json"] }] });
              if (typeof path !== "string") return;
              try {
                setBackup(await readBackup(path));
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            Import…
          </button>
        </Row>
        {backup && (
          <div className="preview-box">
            <p>
              From Off Player {backup.version}, exported {new Date(backup.exported_at).toLocaleString()}:{" "}
              {Object.entries(backupCounts(backup)).filter(([, n]) => n).map(([t, n]) => `${n} ${t.replace("_", " ")}`).join(", ")}.
            </p>
            <div className="row-gap">
              <button className="btn primary" onClick={() => importData(backup)}>Import these</button>
              <button className="btn" onClick={() => setBackup(null)}>Cancel</button>
            </div>
          </div>
        )}
        <Row label="Import from IMDb" sub="Your IMDb “Your ratings” or watchlist export (CSV, from imdb.com → Your ratings → ⋯ → Export). Ratings 8–10 become Loved it, 6–7 Liked it, 5 or less Not for me.">
          <button
            className="btn"
            onClick={async () => {
              setErr(null);
              const path = await open({ title: "Choose an IMDb export", filters: [{ name: "IMDb export", extensions: ["csv"] }] });
              if (typeof path !== "string") return;
              try {
                setImdbFile(readImdbExport(await invoke<string>("read_user_file", { path })));
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            Choose file…
          </button>
        </Row>
        {imdbFile && (
          <div className="preview-box">
            <p>
              {imdbFile.kind === "ratings" ? (
                <>
                  {imdbFile.entries.length} rated titles: {imdbFile.entries.filter((e) => (e.rating ?? 0) >= 8).length} Loved it,{" "}
                  {imdbFile.entries.filter((e) => (e.rating ?? 0) >= 6 && (e.rating ?? 0) < 8).length} Liked it,{" "}
                  {imdbFile.entries.filter((e) => e.rating !== null && e.rating < 6).length} Not for me. They'll be marked as watched.
                </>
              ) : (
                <>{imdbFile.entries.length} titles will be added to your watchlist.</>
              )}
            </p>
            <div className="row-gap">
              <button className="btn primary" onClick={() => { applyImdbExport(imdbFile); setImdbFile(null); }}>Import</button>
              <button className="btn" onClick={() => setImdbFile(null)}>Cancel</button>
            </div>
          </div>
        )}
        {err && <p className="status-err">{err}</p>}
      </Section>
      <Section title="Privacy">
        <ul className="plain-list">
          <li>No account. Nothing about what you own or watch leaves this PC.</li>
          <li>Off Player only contacts <code>api.themoviedb.org</code> and <code>image.tmdb.org</code> (titles, artwork) and, if IMDb ratings are on, <code>datasets.imdbws.com</code>.</li>
          <li>Trailers, “where to watch” and links to TMDB or IMDb open in your web browser.</li>
          <li>Your TMDB key is stored only in the database on this PC.</li>
        </ul>
      </Section>
    </>
  );
}

function About() {
  const [version, setVersion] = useState("");
  const [showLic, setShowLic] = useState(false);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <>
      <Section title="About">
        <div className="about-app">
          <span className="mark big" aria-hidden />
          <div>
            <h3>Off Player {version}</h3>
            <p className="hint">Watch what you own, find what to watch next. Free, for personal use.</p>
          </div>
        </div>
      </Section>
      <Section title="Credits">
        <div className="credit">
          <img src="/tmdb-logo.svg" alt="TMDB" className="tmdb-logo" />
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB. Titles, artwork, cast and ratings come from TMDB.</p>
        </div>
        <div className="credit"><p>{IMDB_CREDIT}</p></div>
        <div className="credit"><p>Availability data by JustWatch.</p></div>
        <p className="fine">
          TMDB's and IMDb's terms allow personal, non-commercial use only. Off Player is free and must stay free.{" "}
          <button className="link" onClick={() => openUrl("https://www.themoviedb.org/api-terms-of-use")}>TMDB terms</button>
        </p>
      </Section>
      <Section
        title="Open-source software"
        hint="Off Player is free software under the GNU General Public License v3. It includes mpv (GPL) and FFmpeg (LGPL); their source code is available from mpv.io and ffmpeg.org, and the versions used are listed in THIRD_PARTY.md in Off Player's source."
      >
        <div className="row-gap">
          <button className="btn" onClick={() => openUrl(REPO)}>Source code on GitHub</button>
          <button className="btn" onClick={() => setShowLic((s) => !s)}>{showLic ? "Hide licences" : `Show ${LICENSES.length} licences`}</button>
        </div>
        {showLic && (
          <ul className="lic-list">
            {LICENSES.map((l) => (
              <li key={`${l.name}@${l.version}`}>
                <span>{l.name}</span>
                <span className="dim-num">{l.version}</span>
                <span>{l.license}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
