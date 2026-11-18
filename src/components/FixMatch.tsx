import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import { searchTmdb } from "../library/metadata";
import { candidateName, candidateYear, type Candidate } from "../library/match";
import type { TitleRow } from "../library/db";
import { tmdbImg } from "../lib/img";

type Result = Candidate & { poster_path?: string | null; overview?: string };

export default function FixMatch({ title, onClose, onPick }: {
  title: TitleRow;
  onClose: () => void;
  onPick: (choice: { type: "tv" | "movie"; id: number } | null) => void;
}) {
  const [query, setQuery] = useState(title.name);
  const [type, setType] = useState<"tv" | "movie">(title.tmdb_type ?? (title.kind === "show" ? "tv" : "movie"));
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults((await searchTmdb(type, query.trim())) as Result[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [query, type]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  return (
    <Modal title={`Fix match · ${title.name}`} onClose={onClose} wide>
      <div className="row-gap">
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search TMDB"
          autoFocus
        />
        <div className="seg">
          <button className={type === "tv" ? "on" : ""} onClick={() => setType("tv")}>Series</button>
          <button className={type === "movie" ? "on" : ""} onClick={() => setType("movie")}>Movie</button>
        </div>
        <button className="btn" onClick={search} disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </div>
      {error && <p className="status-err" style={{ marginTop: 12 }}>{error}</p>}
      {results && results.length === 0 && <p className="hint" style={{ marginTop: 14 }}>No results.</p>}
      <ul className="results">
        {results?.slice(0, 12).map((r) => {
          const current = title.tmdb_id === r.id && title.tmdb_type === type;
          return (
            <li key={r.id}>
              <button className={`result ${current ? "current" : ""}`} onClick={() => onPick({ type, id: r.id })}>
                {r.poster_path ? <img src={tmdbImg(r.poster_path, "w92")} alt="" /> : <span className="noimg" />}
                <span>
                  <h3>
                    {candidateName(r)}
                    {candidateYear(r) && <span>{candidateYear(r)}</span>}
                  </h3>
                  <p>{r.overview || "No description."}</p>
                </span>
                <span className="use">{current ? "Current" : "Use this"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="fine">
        Not on TMDB?{" "}
        <button className="link" onClick={() => onPick(null)}>Use file names only</button> — the title keeps its
        frame-grab thumbnails.
      </p>
    </Modal>
  );
}
