import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  activeChips, DECADES, DEFAULT_FILTERS, RUNTIME_LABEL, SORTS, switchType,
  type BrowseFilters, type Runtime, type Sort, type Status,
} from "../../discover/filters";
import { LANGUAGES, MOVIE_GENRES, TV_GENRES } from "../../discover/genres";
import { searchKeywords, watchProviders, type Keyword, type WatchProvider } from "../../discover/api";
import { setKind } from "../../discover/kind";
import { tmdbImg } from "../../lib/img";
import { IconCheck, IconChevronDown, IconClose, IconFilter, IconSearch } from "../icons";

/** A button that opens a panel; closes on outside click or Escape. */
export function Popover({ label, active, children, wide, align = "left" }: {
  label: ReactNode;
  active?: boolean;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  return (
    <div className="pop" ref={root}>
      <button className={`fbtn ${active ? "set" : ""} ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
        <IconChevronDown className="chev" />
      </button>
      {open && <div className={`pop-panel ${wide ? "wide" : ""} ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return <span className={`check ${on ? "on" : ""}`} aria-hidden>{on && <IconCheck />}</span>;
}

export default function FilterBar({ f, onChange, region, onSave }: {
  f: BrowseFilters;
  onChange: (f: BrowseFilters) => void;
  region: string;
  onSave: (name: string) => void;
}) {
  const set = (patch: Partial<BrowseFilters>) => onChange({ ...f, ...patch });
  const genres = f.type === "movie" ? MOVIE_GENRES : TV_GENRES;
  const [providers, setProviders] = useState<WatchProvider[]>([]);
  useEffect(() => {
    watchProviders(f.type, region).then(setProviders).catch(() => setProviders([]));
  }, [f.type, region]);

  const chips = activeChips(f, {
    genre: (id) => [...MOVIE_GENRES, ...TV_GENRES].find((g) => g.id === id)?.name ?? `Genre ${id}`,
    language: (code) => LANGUAGES.find((l) => l.code === code)?.name ?? code,
    provider: (id) => providers.find((p) => p.id === id)?.name ?? "Service",
  });

  const typeId = f.anime ? "anime" : f.type;
  const pickType = (id: "tv" | "movie" | "anime") => {
    const next = id === "anime" ? switchType(f, f.type, true) : switchType(f, id, false);
    onChange(next);
    setKind(id);
  };

  return (
    <div className="filterbar">
      <div className="filter-row">
        <div className="seg" role="tablist" aria-label="Type">
          {(["tv", "movie", "anime"] as const).map((id) => (
            <button key={id} className={typeId === id ? "on" : ""} onClick={() => pickType(id)} role="tab" aria-selected={typeId === id}>
              {id === "tv" ? "Series" : id === "movie" ? "Movies" : "Anime"}
            </button>
          ))}
        </div>
        {f.anime && (
          <div className="seg small" aria-label="Anime type">
            {(["tv", "movie"] as const).map((t) => (
              <button key={t} className={f.type === t ? "on" : ""} onClick={() => onChange(switchType(f, t, true))}>
                {t === "tv" ? "Series" : "Movies"}
              </button>
            ))}
          </div>
        )}

        <Popover label={f.genres.length ? `Genres · ${f.genres.length}` : "Genres"} active={f.genres.length > 0} wide>
          {() => (
            <>
              <div className="pop-head">
                <span>Genres</span>
                <div className="seg small">
                  <button className={f.genreMode === "any" ? "on" : ""} onClick={() => set({ genreMode: "any" })} title="Titles in any of the chosen genres">Any</button>
                  <button className={f.genreMode === "all" ? "on" : ""} onClick={() => set({ genreMode: "all" })} title="Titles in every chosen genre">All</button>
                </div>
              </div>
              <div className="pop-grid three">
                {genres
                  .filter((g) => !(f.anime && g.id === 16))
                  .map((g) => {
                    const on = f.genres.includes(g.id);
                    return (
                      <button key={g.id} className={`pop-opt ${on ? "on" : ""}`} onClick={() => set({ genres: on ? f.genres.filter((x) => x !== g.id) : [...f.genres, g.id] })}>
                        <Check on={on} /> {g.name}
                      </button>
                    );
                  })}
              </div>
            </>
          )}
        </Popover>

        <Popover label={f.yearFrom || f.yearTo ? yearLabel(f) : "Year"} active={!!(f.yearFrom || f.yearTo)} wide>
          {(close) => <YearPanel f={f} set={set} close={close} />}
        </Popover>

        <Popover label={f.rating ? `Rated ${f.rating}+` : "Rating"} active={!!f.rating || f.wellKnown}>
          {() => (
            <div className="pop-pad">
              <div className="pop-head"><span>Minimum TMDB rating</span><b className="big-num">{f.rating ? `${f.rating}+` : "Any"}</b></div>
              <input
                type="range"
                className="range"
                min={4.5}
                max={9}
                step={0.5}
                value={f.rating ?? 4.5}
                onChange={(e) => set({ rating: Number(e.target.value) <= 4.5 ? null : Number(e.target.value) })}
                aria-label="Minimum rating"
              />
              <div className="range-ticks"><span>Any</span><span>6</span><span>7</span><span>8</span><span>9</span></div>
              <label className="toggle-row">
                <input type="checkbox" checked={f.wellKnown} onChange={(e) => set({ wellKnown: e.target.checked })} />
                <span>Only well-known titles<small>{f.type === "movie" ? "500+" : "200+"} ratings on TMDB</small></span>
              </label>
            </div>
          )}
        </Popover>

        <Popover label={f.runtime ? RUNTIME_LABEL[f.type][f.runtime] : "Length"} active={!!f.runtime}>
          {(close) => (
            <div className="pop-list">
              {(["short", "mid", "long"] as Runtime[]).map((r) => (
                <button key={r} className={`pop-opt ${f.runtime === r ? "on" : ""}`} onClick={() => { set({ runtime: f.runtime === r ? null : r }); close(); }}>
                  <Check on={f.runtime === r} /> {RUNTIME_LABEL[f.type][r]}{f.type === "tv" ? " per episode" : ""}
                </button>
              ))}
            </div>
          )}
        </Popover>

        {!f.anime && (
          <Popover label={f.language ? LANGUAGES.find((l) => l.code === f.language)?.name ?? f.language : "Language"} active={!!f.language}>
            {(close) => <LanguagePanel value={f.language} onPick={(code) => { set({ language: code }); close(); }} />}
          </Popover>
        )}

        {f.type === "tv" && (
          <Popover label={f.status ? { ongoing: "Ongoing", ended: "Ended", mini: "Miniseries" }[f.status] : "Status"} active={!!f.status}>
            {(close) => (
              <div className="pop-list">
                {([["ongoing", "Ongoing"], ["ended", "Ended or cancelled"], ["mini", "Miniseries"]] as [Status, string][]).map(([s, label]) => (
                  <button key={s} className={`pop-opt ${f.status === s ? "on" : ""}`} onClick={() => { set({ status: f.status === s ? null : s }); close(); }}>
                    <Check on={f.status === s} /> {label}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        )}

        <Popover label={f.providers.length ? `On ${f.providers.length} service${f.providers.length > 1 ? "s" : ""}` : "Available on"} active={f.providers.length > 0} wide>
          {() => (
            <>
              <div className="pop-head"><span>Streaming in {regionName(region)}</span>{f.providers.length > 0 && <button className="link-btn" onClick={() => set({ providers: [] })}>Clear</button>}</div>
              {providers.length === 0 ? (
                <p className="hint pad">No streaming data for this country.</p>
              ) : (
                <div className="prov-pick">
                  {providers.slice(0, 40).map((p) => {
                    const on = f.providers.includes(p.id);
                    return (
                      <button key={p.id} className={`prov-chip ${on ? "on" : ""}`} title={p.name} onClick={() => set({ providers: on ? f.providers.filter((x) => x !== p.id) : [...f.providers, p.id] })}>
                        {p.logo ? <img src={tmdbImg(p.logo, "w92")} alt="" /> : null}
                        <span>{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Popover>

        <Popover label={f.keywords.length ? `Themes · ${f.keywords.length}` : "Themes"} active={f.keywords.length > 0} wide>
          {() => <KeywordPanel f={f} set={set} />}
        </Popover>

        <Popover label={<><IconFilter /> Hide</>} active={f.hideWatched || f.hideOwned || f.hideSaved} align="right">
          {() => (
            <div className="pop-pad">
              <label className="toggle-row"><input type="checkbox" checked={f.hideWatched} onChange={(e) => set({ hideWatched: e.target.checked })} /><span>Titles I've watched</span></label>
              <label className="toggle-row"><input type="checkbox" checked={f.hideOwned} onChange={(e) => set({ hideOwned: e.target.checked })} /><span>Titles in my library</span></label>
              <label className="toggle-row"><input type="checkbox" checked={f.hideSaved} onChange={(e) => set({ hideSaved: e.target.checked })} /><span>Titles on my watchlist</span></label>
            </div>
          )}
        </Popover>

        <div className="filter-spacer" />
        <label className="sort-select">
          <span>Sort</span>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value as Sort })} aria-label="Sort">
            {SORTS.filter((s) => !(s.movieOnly && f.type === "tv")).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className={`chip-row ${chips.length ? "" : "empty"}`}>
        {chips.map((c) => (
          <button key={c.key} className="fchip" onClick={() => onChange(c.clear(f))} title="Remove">
            {c.label} <IconClose />
          </button>
        ))}
        {chips.length > 0 && (
          <>
            <button className="link-btn" onClick={() => onChange({ ...DEFAULT_FILTERS, type: f.type, anime: f.anime, sort: f.sort })}>Clear all</button>
            <SaveFilter onSave={onSave} />
          </>
        )}
      </div>
    </div>
  );
}

const yearLabel = (f: BrowseFilters) =>
  f.yearFrom && f.yearTo ? (f.yearFrom === f.yearTo ? `${f.yearFrom}` : `${f.yearFrom}–${f.yearTo}`) : f.yearFrom ? `From ${f.yearFrom}` : `Until ${f.yearTo}`;

function regionName(cc: string) {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

function YearPanel({ f, set, close }: { f: BrowseFilters; set: (p: Partial<BrowseFilters>) => void; close: () => void }) {
  const [from, setFrom] = useState(f.yearFrom ? String(f.yearFrom) : "");
  const [to, setTo] = useState(f.yearTo ? String(f.yearTo) : "");
  const now = new Date().getFullYear();
  const apply = () => {
    const a = Number(from) || null;
    const b = Number(to) || null;
    set({ yearFrom: a && b && a > b ? b : a, yearTo: a && b && a > b ? a : b });
    close();
  };
  return (
    <div className="pop-pad">
      <div className="decades">
        {DECADES.map((d) => {
          const on = f.yearFrom === d.from && f.yearTo === d.to;
          return (
            <button key={d.label} className={`pill ${on ? "on" : ""}`} onClick={() => { set({ yearFrom: on ? null : d.from, yearTo: on ? null : d.to }); close(); }}>
              {d.label}
            </button>
          );
        })}
        {[2, 5].map((n) => (
          <button key={n} className={`pill ${f.yearFrom === now - n && f.yearTo === now ? "on" : ""}`} onClick={() => { set({ yearFrom: now - n, yearTo: now }); close(); }}>
            Last {n} years
          </button>
        ))}
      </div>
      <div className="year-range">
        <input className="input" inputMode="numeric" placeholder="From" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && apply()} aria-label="From year" />
        <span>to</span>
        <input className="input" inputMode="numeric" placeholder="To" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && apply()} aria-label="To year" />
        <button className="btn small" onClick={apply}>Apply</button>
      </div>
    </div>
  );
}

function LanguagePanel({ value, onPick }: { value: string | null; onPick: (code: string | null) => void }) {
  const [q, setQ] = useState("");
  const list = LANGUAGES.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="lang-panel">
      <label className="pop-search"><IconSearch /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a language" /></label>
      <div className="pop-list scroll">
        <button className={`pop-opt ${!value ? "on" : ""}`} onClick={() => onPick(null)}><Check on={!value} /> Any language</button>
        {list.map((l, i) => (
          <button key={l.code} className={`pop-opt ${value === l.code ? "on" : ""} ${!q && i === 12 ? "sep" : ""}`} onClick={() => onPick(l.code)}>
            <Check on={value === l.code} /> {l.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function KeywordPanel({ f, set }: { f: BrowseFilters; set: (p: Partial<BrowseFilters>) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Keyword[]>([]);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return setHits([]);
    const t = window.setTimeout(() => searchKeywords(text).then(setHits).catch(() => setHits([])), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="pop-pad">
      <label className="pop-search"><IconSearch /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Heist, time travel, based on a novel…" /></label>
      {f.keywords.length > 0 && (
        <div className="kw-chips">
          {f.keywords.map((k) => (
            <button key={k.id} className="fchip" onClick={() => set({ keywords: f.keywords.filter((x) => x.id !== k.id) })}>{k.name} <IconClose /></button>
          ))}
        </div>
      )}
      <div className="pop-list">
        {hits.map((k) => {
          const on = f.keywords.some((x) => x.id === k.id);
          return (
            <button key={k.id} className={`pop-opt ${on ? "on" : ""}`} onClick={() => set({ keywords: on ? f.keywords.filter((x) => x.id !== k.id) : [...f.keywords, k] })}>
              <Check on={on} /> {k.name}
            </button>
          );
        })}
        {q.trim().length >= 2 && hits.length === 0 && <p className="hint pad">No matching themes.</p>}
      </div>
    </div>
  );
}

function SaveFilter({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) return <button className="link-btn" onClick={() => setOpen(true)}>Save filter</button>;
  return (
    <form
      className="save-filter"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave(name.trim());
        setName("");
        setOpen(false);
      }}
    >
      <input className="input small" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this filter" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false))} />
      <button className="btn small primary" type="submit">Save</button>
    </form>
  );
}
