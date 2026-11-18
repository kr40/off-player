// Quick picker: tick many titles you've seen at once, to seed suggestions.
import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { lists, type Item } from "../discover/api";
import { listTitles } from "../library/db";
import { findSeen, markSeen, useSeen } from "../library/seen";
import { showToast } from "./Toast";
import { tmdbImg } from "../lib/img";
import { IconCheck, IconSearch } from "./icons";

const key = (i: Item) => `${i.type}:${i.id}`;

export default function SeenPicker({ onClose }: { onClose: () => void }) {
  const seen = useSeen();
  const [popular, setPopular] = useState<Item[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Map<string, Item>>(new Map());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([lists.trending(), lists.topTv(), lists.topMovies(), listTitles()])
      .then(([a, b, c, titles]) => {
        const lib = new Set(titles.filter((t) => t.tmdb_id).map((t) => `${t.tmdb_type}:${t.tmdb_id}`));
        const out = new Map<string, Item>();
        // Interleave so the grid mixes trending, series and movies.
        for (let i = 0; i < 20; i++) for (const l of [a, b, c]) if (l[i] && !lib.has(key(l[i]))) out.set(key(l[i]), l[i]);
        setPopular([...out.values()]);
      })
      .catch(() => setErr(true));
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!query) return setResults(null);
    let alive = true;
    const t = window.setTimeout(() => {
      lists.search(query).then((r) => alive && setResults(r)).catch(() => alive && setResults([]));
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const grid = useMemo(() => (q.trim() ? results : popular), [q, results, popular]);

  const toggle = (i: Item) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(key(i))) n.delete(key(i));
      else n.set(key(i), i);
      return n;
    });

  const done = async () => {
    if (!picked.size) return onClose();
    setSaving(true);
    const undo = await markSeen([...picked.values()]);
    showToast(`Marked ${picked.size} ${picked.size === 1 ? "title" : "titles"} as watched`, undo);
    onClose();
  };

  return (
    <Modal title="What have you watched?" onClose={onClose} wide>
      <div className="picker">
        <p className="hint">Pick at least 5 for better suggestions. You can come back and add more any time.</p>
        <label className="discover-search picker-search">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a show or movie" spellCheck={false} autoFocus aria-label="Search" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search">×</button>}
        </label>
        <div className="picker-grid">
          {err && !grid && <p className="hint">Couldn't reach TMDB. Check your connection and try again.</p>}
          {!grid && !err && Array.from({ length: 12 }, (_, i) => <span key={i} className="dskel" />)}
          {grid && grid.length === 0 && <p className="hint">Nothing on TMDB matches “{q.trim()}”.</p>}
          {grid?.map((i) => {
            const already = !!findSeen(seen, i.type, i.id);
            const on = already || picked.has(key(i));
            return (
              <button
                key={key(i)}
                className={`pick ${on ? "on" : ""}`}
                disabled={already}
                onClick={() => toggle(i)}
                title={already ? `${i.name} — already marked as watched` : i.name}
                aria-pressed={on}
              >
                <span className="pick-art">
                  {i.poster ? <img src={tmdbImg(i.poster, "w185")} alt="" loading="lazy" draggable={false} /> : <span className="tcard-ph dcard-ph">{i.name}</span>}
                  {on && <span className="pick-check"><IconCheck /></span>}
                </span>
                <span className="pick-name">{i.name}</span>
              </button>
            );
          })}
        </div>
        <footer className="picker-foot">
          <span className="picker-count">{picked.size} selected</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={done} disabled={saving}>Done</button>
        </footer>
      </div>
    </Modal>
  );
}
