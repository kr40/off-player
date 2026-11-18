import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { addLibrary, getSetting, listLibraries, listTitles, removeLibrary, type Library, type TitleRow } from "../library/db";
import { displayName, displayYear } from "../library/present";
import { useLibraryVersion, libraryChanged } from "../library/store";
import { runJob, useJobs } from "../library/jobs";
import { fixMatch, scanAll } from "../library/actions";
import { PageScroll, useNav } from "../app/nav";
import FixMatch from "../components/FixMatch";
import { img } from "../lib/img";
import { fmtBytes } from "../lib/format";

export default function Manage() {
  const v = useLibraryVersion();
  const { push } = useNav();
  const { progress, message, error } = useJobs();
  const [libs, setLibs] = useState<Library[]>([]);
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [tools, setTools] = useState<{ ffmpeg: boolean; ffprobe: boolean } | null>(null);
  useEffect(() => {
    invoke<{ ffmpeg: boolean; ffprobe: boolean }>("tool_status").then(setTools).catch(() => {});
  }, []);
  const [fixing, setFixing] = useState<TitleRow | null>(null);

  useEffect(() => {
    Promise.all([listLibraries(), listTitles(), getSetting("tmdb_key")]).then(([l, t, k]) => {
      setLibs(l);
      setTitles(t);
      setHasKey(!!k);
    });
  }, [v]);

  const working = progress !== null;
  const addFolder = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Add a folder to your library" });
    if (typeof picked !== "string") return;
    const lib = await addLibrary(picked);
    libraryChanged();
    runJob((r) => scanAll([lib], r));
  };

  const shows = titles.filter((t) => t.kind === "show");
  const movies = titles.filter((t) => t.kind === "movie");
  const episodes = shows.reduce((a, t) => a + t.episodes, 0);
  const bytes = titles.reduce((a, t) => a + t.bytes, 0);

  return (
    <PageScroll className="manage">
      <header className="manage-head">
        <div>
          <h1>Library</h1>
          <p className="manage-sub">
            {shows.length} series · {movies.length} movies · {episodes} episodes · {fmtBytes(bytes) || "0 B"}
          </p>
        </div>
        <div className="actions">
          {libs.length > 0 && (
            <button className="btn" onClick={() => runJob((r) => scanAll(libs, r))} disabled={working}>Rescan</button>
          )}
          <button className="btn primary" onClick={addFolder} disabled={working}>Add folder</button>
          <button className="btn" onClick={() => push({ page: "settings", section: "library" })}>Settings</button>
        </div>
      </header>

      {progress && (
        <div className="scanbar">
          <div className="scanbar-fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 6}%` }} />
          <div className="scanbar-text">
            <span className="spinner" /> {progress.label}
            {progress.total > 0 && <span className="dim-num">{progress.done} / {progress.total}</span>}
            {progress.current && <span className="scanbar-file">{progress.current.split("/").pop()}</span>}
          </div>
        </div>
      )}

      <div className="manage-body">
        {message && !working && <div className="note">{message}</div>}
        {error && <div className="note error">{error}</div>}

        {tools && !(tools.ffmpeg && tools.ffprobe) && (
          <div className="banner">
            <span>Thumbnails and durations need ffmpeg. Everything else, including playback, works without it.</span>
          </div>
        )}
        {!hasKey && titles.length > 0 && (
          <div className="banner">
            <span>Add a free TMDB key to get posters, backgrounds and episode descriptions.</span>
            <button className="btn" onClick={() => push({ page: "settings", section: "discover" })}>Add key</button>
          </div>
        )}

        <section className="manage-section">
          <h2>Folders</h2>
          {libs.length === 0 ? (
            <div className="empty small">
              <p>No folders yet. Add a folder of shows or movies to get started.</p>
              <button className="btn primary" onClick={addFolder}>Add folder</button>
            </div>
          ) : (
            <div className="folders">
              {libs.map((l) => (
                <FolderChip key={l.id} lib={l} disabled={working} onRemove={async () => {
                  await removeLibrary(l.id);
                  libraryChanged();
                }} />
              ))}
            </div>
          )}
        </section>

        {titles.length > 0 && (
          <section className="manage-section">
            <h2>Titles</h2>
            <ul className="mtable">
              {titles.map((t) => {
                const check = hasKey && (t.match_state === "none" || (t.match_state === "auto" && (t.match_confidence ?? 0) < 0.8));
                const attention = t.unknown + t.probe_errors;
                return (
                  <li key={t.id} className="mrow">
                    <button className="mrow-main" onClick={() => push({ page: "title", id: t.id })}>
                      {t.poster || t.cover_thumb ? <img src={img(t.poster ?? t.cover_thumb)} alt="" loading="lazy" /> : <span className="mrow-ph" />}
                      <span className="mrow-text">
                        <span className="mrow-name">{displayName(t)}{displayYear(t) ? <span className="year"> {displayYear(t)}</span> : null}</span>
                        <span className="mrow-sub">
                          {t.kind === "show" ? `${t.seasons} seasons · ${t.episodes} episodes` : "Movie"}
                          {t.extras ? ` · ${t.extras} extras` : ""} · {fmtBytes(t.bytes)}
                        </span>
                      </span>
                    </button>
                    <span className={`mstate ${check ? "warn" : t.match_state}`}>
                      {t.match_state === "confirmed" ? "Picked by you"
                        : t.match_state === "auto" ? (check ? "Check match" : "Matched")
                        : t.match_state === "none" ? "No TMDB match"
                        : hasKey ? "Not matched yet" : "File names"}
                    </span>
                    {attention > 0 && <span className="mstate warn">{attention} need attention</span>}
                    {hasKey && (
                      <button className="btn small" disabled={working} onClick={() => setFixing(t)}>Fix match</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {fixing && (
        <FixMatch
          title={fixing}
          onClose={() => setFixing(null)}
          onPick={(choice) => {
            const t = fixing;
            setFixing(null);
            runJob((r) => fixMatch(t.id, choice, r));
          }}
        />
      )}
    </PageScroll>
  );
}

function FolderChip({ lib, onRemove, disabled }: { lib: Library; onRemove: () => void; disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);
  return (
    <div className="chip">
      <span className="chip-path" title={lib.path}>{lib.path}</span>
      <button
        className={`chip-x ${confirm ? "armed" : ""}`}
        disabled={disabled}
        title="Remove from library (files stay on disk)"
        onClick={() => (confirm ? onRemove() : setConfirm(true))}
      >
        {confirm ? "Remove?" : "×"}
      </button>
    </div>
  );
}
