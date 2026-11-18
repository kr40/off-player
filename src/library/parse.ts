// Turns a flat list of files under a library root into shows, movies,
// episodes, extras and paired subtitles. Pure: no I/O, so it is unit-tested
// against real file lists in __fixtures__.

export type Entry = {
  rel: string; // path relative to the library root, "/" separated
  size: number;
  kind: "video" | "sub";
  path?: string; // absolute path (absent in fixtures)
  mtime?: number;
};

export type Role = "episode" | "movie" | "extra" | "unknown";

export type SidecarSub = { entry: Entry; lang: string | null };

export type PlannedFile = {
  entry: Entry;
  role: Role;
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  episodeTitle: string | null; // parsed episode title, or display label for extras/unknown
  extraGroup: string | null;
  subs: SidecarSub[];
};

export type PlannedTitle = {
  key: string;
  name: string;
  year: number | null;
  kind: "show" | "movie";
  folders: string[]; // rel paths of the folders this title came from ("" = root)
  files: PlannedFile[];
  warnings: string[];
};

export type Plan = {
  titles: PlannedTitle[];
  skipped: { rel: string; reason: string }[];
};

// ---------------------------------------------------------------------------
// Name cleaning

// Release tags. Anything from the first of these onwards is not part of a name.
const JUNK =
  /(?:^|[\s\[(._-])(?:2160p|1080[pi]|720p|576p|480p|[1-9]\d{2,3}x[1-9]\d{2,3}|4k|uhd|hdr10\+?|hdr|dolby[\s.]?vision|x26[45]|h[\s.]?26[45]|hevc|avc|xvid|divx|10[\s.-]?bit|8[\s.-]?bit|blu-?ray|bdrip|brrip|bdremux|remux|web[\s.-]?dl|web[\s.-]?rip|hdtv|hdrip|dvdrip|dvd[\s.-]?r|amzn|nf|dsnp|hmax|atvp|hulu|ddp?[\s.]?[257][\s.]?[01]|dd[257][\s.]?[01]|aac(?:[\s.]?[257][\s.]?[01])?|e?ac3|dts(?:-?hd)?|truehd|atmos|flac|proper|repack|rerip|internal|complete|multi|dual[\s.-]?audio)(?=$|[\s\])._-])/i;

const SEASON_TOKEN =
  /(?:^|[\s\[(._-])(?:seasons?[\s._-]*\d{1,2}(?:[\s._-]*(?:-|to)[\s._-]*\d{1,2})?|series[\s._-]*\d{1,2}|s\d{1,2}(?:[\s._-]?-[\s._-]?s?\d{1,2})?)(?=$|[\s\])._-])/i;

const GENERIC_FOLDER =
  /^(movies?|films?|videos?|downloads?|torrents?|media|tv|tv[\s._-]?shows|shows|series|complete)$/i;

const EXTRAS_DIR =
  /^(featurettes?|extras?|bonus(?:[\s._-]+(?:disc|features|content|material))?|behind[\s._-]the[\s._-]scenes|deleted[\s._-]scenes|interviews?|trailers?|shorts?|making[\s._-]of|other|special[\s._-]features)$/i;

const SUBS_DIR = /^(subs?|subtitles?)$/i;

/** Dots and underscores become spaces in scene-style names (no spaces). */
function despace(raw: string): string {
  let s = raw.replace(/_new$/i, "").replace(/_/g, " ");
  if (!/\s/.test(s)) s = s.replace(/\./g, " ");
  return s;
}

function tidy(s: string): string {
  return s
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–._:]+|[\s\-–._:(\[]+$/g, "")
    .trim();
}

/** Strip release junk and pull out a year: "Friends (1994) Season 1-10 (1080p…)" → Friends, 1994. */
export function cleanName(raw: string): { name: string; year: number | null } {
  let s = despace(raw)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ");

  // Parenthesised groups: keep a bare year, drop anything containing junk.
  let parenYear: number | null = null;
  s = s.replace(/\(([^)]*)\)/g, (m, inner: string) => {
    const y = inner.trim().match(/^((?:19|20)\d{2})$/);
    if (y) {
      parenYear = Number(y[1]);
      return " ";
    }
    return JUNK.test(` ${inner} `) ? " " : m;
  });

  const cut = (re: RegExp) => {
    const m = re.exec(s);
    if (m) s = s.slice(0, m.index);
  };
  cut(JUNK);
  cut(SEASON_TOKEN);

  let year: number | null = parenYear;
  const years = [...s.matchAll(/(?:^|[\s(\[])((?:19|20)\d{2})(?=$|[\s)\]])/g)];
  const last = years.filter((m) => (m.index ?? 0) > 0).pop();
  if (last) {
    year = Number(last[1]);
    s = s.slice(0, last.index);
  } else if (year === null && years[0]?.index === 0) {
    // A year in front ("1998.Rush.Hour.1920x784…", "1998 - Rush Hour") is the release
    // year only in those two release styles; otherwise it's the title ("1917", "2012").
    const lead = Number(years[0][1]);
    const rest = s.slice(years[0][0].length);
    const styled = !/\s/.test(raw) || /^\s*[-–]\s/.test(rest);
    if (styled && /[a-z]/i.test(rest) && lead <= new Date().getFullYear() + 1) {
      year = lead;
      s = rest;
    }
  }
  s = s.replace(/-[a-z0-9]+$/i, (m) => (/\s/.test(s) ? m : "")); // scene group suffix
  return { name: tidy(s), year };
}

export function titleKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

// ---------------------------------------------------------------------------
// Seasons and episodes

/** Season number named by a folder ("Season 3", "S03", "Specials"), or null. Ranges return null. */
export function seasonFromName(raw: string): number | null {
  const s = despace(raw);
  if (/^specials?$/i.test(s.trim())) return 0;
  let m = s.match(/(?:^|[^a-z])season[\s._-]*(\d{1,2})(?![\d])(?![\s._-]*(?:-|to)[\s._-]*\d)/i);
  if (m) return Number(m[1]);
  m = s.match(/(?:^|[^a-z])series[\s._-]*(\d{1,2})(?!\d)/i);
  if (m) return Number(m[1]);
  // "S03" alone; not either end of a range like "S01-S10".
  m = s.match(/(?:^|[\s\[(._-])(?<!s\d{1,2}[\s._]?-[\s._]?)s(\d{1,2})(?=$|[\s\])._-])(?![\s._-]?-[\s._-]?s?\d)/i);
  if (m) return Number(m[1]);
  return null;
}

export function isSeasonDir(name: string) {
  return seasonFromName(name) !== null;
}
export function isExtrasDir(name: string) {
  return EXTRAS_DIR.test(despace(name).trim());
}

export type EpisodeMatch = {
  season: number;
  episode: number;
  episodeEnd: number | null;
  prefix: string; // text before the marker (show name in loose files)
  title: string | null; // text after the marker
};

const EP_PATTERNS: { re: RegExp; needsSeason: boolean }[] = [
  // S01E02, s01e02, S01.E02, S01E02-E03, S01E02E03
  { re: /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]?e(\d{1,3})(?:[\s._-]?-?[\s._-]?e(\d{1,3})|-(\d{1,3}))?(?!\d)/i, needsSeason: false },
  // 1x02
  { re: /(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?!\d)/i, needsSeason: false },
  // Season 1 Episode 2
  { re: /season[\s._-]*(\d{1,2})[\s._-]*(?:episode|ep|e)[\s._-]*(\d{1,3})(?!\d)/i, needsSeason: false },
  // Episode 2 / Ep 2 / E02 (season from folder)
  { re: /(?:^|[^a-z0-9])(?:episode|ep|e)[\s._-]*(\d{1,3})(?!\d)/i, needsSeason: true },
  // "02 - Title" (season from folder)
  { re: /^(\d{1,3})(?=[\s._-]|$)/, needsSeason: true },
];

function cleanEpisodeTitle(rest: string): string | null {
  let s = despace(rest).replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\(([^)]*)\)/g, (m, inner: string) => (JUNK.test(` ${inner} `) ? " " : m));
  const j = JUNK.exec(s);
  if (j) s = s.slice(0, j.index);
  const t = tidy(s);
  return t.length ? t : null;
}

/** Parse an episode marker from a file name (no extension). */
export function parseEpisode(base: string, folderSeason: number | null): EpisodeMatch | null {
  for (const { re, needsSeason } of EP_PATTERNS) {
    if (needsSeason && folderSeason === null) continue;
    const m = re.exec(base);
    if (!m) continue;
    let season: number, episode: number, endRaw: string | undefined;
    if (needsSeason) {
      season = folderSeason!;
      episode = Number(m[1]);
    } else {
      season = Number(m[1]);
      episode = Number(m[2]);
      endRaw = m[3] ?? m[4];
    }
    let episodeEnd: number | null = endRaw ? Number(endRaw) : null;
    // "S01E01-720p" is not a double episode.
    if (episodeEnd !== null && (episodeEnd <= episode || episodeEnd > episode + 4)) episodeEnd = null;
    const start = m.index + (m[0].length - m[0].trimStart().length);
    return {
      season,
      episode,
      episodeEnd,
      prefix: cleanName(base.slice(0, start)).name,
      title: cleanEpisodeTitle(base.slice(m.index + m[0].length)),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Subtitle language

const LANGS: Record<string, string> = {
  en: "en", eng: "en", english: "en",
  es: "es", spa: "es", spanish: "es",
  fr: "fr", fre: "fr", fra: "fr", french: "fr",
  de: "de", ger: "de", deu: "de", german: "de",
  it: "it", ita: "it", italian: "it",
  pt: "pt", por: "pt", portuguese: "pt",
  nl: "nl", dut: "nl", dutch: "nl",
  ru: "ru", rus: "ru", russian: "ru",
  ja: "ja", jpn: "ja", japanese: "ja",
  ko: "ko", kor: "ko", korean: "ko",
  zh: "zh", chi: "zh", zho: "zh", chinese: "zh",
  hi: "hi", hin: "hi", hindi: "hi",
  ar: "ar", ara: "ar", arabic: "ar",
};

export function subLang(base: string): string | null {
  const tokens = base.toLowerCase().split(/[\s._\-\[\]()]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= Math.max(0, tokens.length - 3); i--) {
    const t = tokens[i];
    if (LANGS[t]) return LANGS[t];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grouping

type Node = {
  name: string;
  rel: string;
  dirs: Map<string, Node>;
  videos: Entry[];
  videoCount: number; // videos in this subtree
};

const baseOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const isSample = (e: Entry) => /(?:^|[\s._-])sample(?:$|[\s._-])/i.test(baseOf(e.rel)) && e.size < 300e6;

function buildTree(rootName: string, videos: Entry[]): Node {
  const root: Node = { name: rootName, rel: "", dirs: new Map(), videos: [], videoCount: 0 };
  for (const v of videos) {
    const parts = v.rel.split("/");
    let node = root;
    node.videoCount++;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.dirs.get(parts[i]);
      if (!next) {
        next = { name: parts[i], rel: parts.slice(0, i + 1).join("/"), dirs: new Map(), videos: [], videoCount: 0 };
        node.dirs.set(parts[i], next);
      }
      node = next;
      node.videoCount++;
    }
    node.videos.push(v);
  }
  return root;
}

function allVideos(n: Node): Entry[] {
  return [...n.videos, ...[...n.dirs.values()].flatMap(allVideos)];
}

/** Folders that are titles, plus loose files that each form their own title. */
function findTitleNodes(root: Node): { nodes: Node[]; loose: Entry[] } {
  const nodes: Node[] = [];
  const loose: Entry[] = [];
  const childDirs = (n: Node) => [...n.dirs.values()].filter((d) => d.videoCount > 0);

  const rootDirs = childDirs(root);
  const seasonDirs = rootDirs.filter((d) => isSeasonDir(d.name));
  const prefixes = new Set(seasonDirs.map((d) => titleKey(cleanName(d.name).name)).filter(Boolean));
  const rootLooksLikeShow =
    (rootDirs.length > 0 &&
      seasonDirs.length > 0 &&
      rootDirs.every((d) => isSeasonDir(d.name) || isExtrasDir(d.name)) &&
      prefixes.size <= 1) ||
    (rootDirs.length === 0 &&
      root.videos.length > 1 &&
      root.videos.every((v) => parseEpisode(baseOf(v.rel), null)) &&
      new Set(root.videos.map((v) => titleKey(parseEpisode(baseOf(v.rel), null)!.prefix))).size <= 1);
  if (rootLooksLikeShow) return { nodes: [root], loose };

  loose.push(...root.videos);
  const visit = (n: Node) => {
    const dirs = childDirs(n);
    const allSpecial = dirs.every((d) => isSeasonDir(d.name) || isExtrasDir(d.name));
    if (allSpecial || n.videos.length > 0) nodes.push(n);
    else dirs.forEach(visit);
  };
  rootDirs.forEach(visit);
  return { nodes, loose };
}

type Draft = Omit<PlannedTitle, "key"> & { key?: string };

function planFolder(node: Node | null, files: Entry[], rootName: string): Draft[] {
  const folderName = node ? (node.rel === "" ? rootName : node.name) : "";
  const folderSeason = node ? seasonFromName(folderName) : null;

  type Parsed = { e: Entry; inner: string[]; extra: string | null; season: number | null; ep: EpisodeMatch | null };
  const parsed: Parsed[] = files.map((e) => {
    const rel = node && node.rel ? e.rel.slice(node.rel.length + 1) : e.rel;
    const inner = rel.split("/").slice(0, -1);
    const exIdx = inner.findIndex(isExtrasDir);
    const extra = exIdx >= 0 ? inner.slice(exIdx + 1).join(" / ") || inner[exIdx] : null;
    let season = folderSeason;
    for (const d of inner) {
      const s = seasonFromName(d);
      if (s !== null) season = s;
    }
    const ep = exIdx >= 0 ? null : parseEpisode(baseOf(e.rel), season);
    return { e, inner, extra, season, ep };
  });

  const isShow = parsed.some((p) => p.ep);
  const extraLabel = (e: Entry) => cleanEpisodeTitle(baseOf(e.rel)) ?? baseOf(e.rel);

  if (isShow) {
    let { name, year } = cleanName(folderName);
    if (!name || GENERIC_FOLDER.test(name)) {
      const pre = parsed.find((p) => p.ep?.prefix)?.ep?.prefix;
      if (pre) ({ name, year } = { ...cleanName(pre), year: year ?? cleanName(pre).year });
    }
    return [
      {
        name: name || folderName,
        year,
        kind: "show",
        folders: node ? [node.rel] : [],
        warnings: [],
        files: parsed.map((p) => ({
          entry: p.e,
          role: p.extra !== null ? "extra" : p.ep ? "episode" : "unknown",
          season: p.ep?.season ?? (p.extra === null ? p.season : null),
          episode: p.ep?.episode ?? null,
          episodeEnd: p.ep?.episodeEnd ?? null,
          episodeTitle: p.ep ? p.ep.title : extraLabel(p.e),
          extraGroup: p.extra,
          subs: [],
        })),
      },
    ];
  }

  // Movies. Group main videos by name so a folder of unrelated films splits up,
  // while CD1/CD2 parts stay together.
  const mains = parsed.filter((p) => p.extra === null);
  const extras = parsed.filter((p) => p.extra !== null);
  const partless = (e: Entry) =>
    titleKey(cleanName(baseOf(e.rel).replace(/[\s._-]*(?:cd|disc|part|pt)[\s._-]*\d+$/i, "")).name);
  const groups = new Map<string, Parsed[]>();
  for (const p of mains) {
    const k = partless(p.e);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const folderClean = cleanName(folderName);
  const folderUsable = !!folderClean.name && !GENERIC_FOLDER.test(folderClean.name);

  if (groups.size <= 1 && folderUsable) {
    const largest = Math.max(0, ...mains.map((p) => p.e.size));
    return [
      {
        name: folderClean.name,
        year: folderClean.year ?? (mains[0] ? cleanName(baseOf(mains[0].e.rel)).year : null),
        kind: "movie",
        folders: node ? [node.rel] : [],
        warnings: [],
        files: parsed.map((p) => {
          const isMain = p.extra === null && p.e.size >= largest * 0.4;
          return {
            entry: p.e,
            role: isMain ? "movie" : "extra",
            season: null,
            episode: null,
            episodeEnd: null,
            episodeTitle: isMain ? null : extraLabel(p.e),
            extraGroup: p.extra,
            subs: [],
          };
        }),
      },
    ];
  }

  return [...groups.values()].map((ps) => {
    const { name, year } = cleanName(baseOf(ps[0].e.rel));
    return {
      name: name || baseOf(ps[0].e.rel),
      year,
      kind: "movie" as const,
      folders: node ? [node.rel] : [],
      warnings: [],
      files: [
        ...ps.map((p) => ({
          entry: p.e, role: "movie" as Role, season: null, episode: null, episodeEnd: null,
          episodeTitle: null, extraGroup: null, subs: [],
        })),
        // Extras in a shared folder can't be attributed; attach to the first group only.
        ...(ps === [...groups.values()][0]
          ? extras.map((p) => ({
              entry: p.e, role: "extra" as Role, season: null, episode: null, episodeEnd: null,
              episodeTitle: extraLabel(p.e), extraGroup: p.extra, subs: [],
            }))
          : []),
      ],
    };
  });
}

function pairSubs(titles: PlannedTitle[], subs: Entry[]) {
  const byDir = new Map<string, PlannedFile[]>();
  for (const t of titles)
    for (const f of t.files) {
      const d = dirOf(f.entry.rel);
      byDir.set(d, [...(byDir.get(d) ?? []), f]);
    }
  const norm = (s: string) => titleKey(s);

  for (const sub of subs) {
    const d = dirOf(sub.rel);
    const dName = d.slice(d.lastIndexOf("/") + 1);
    const parent = dirOf(d);
    const pName = parent.slice(parent.lastIndexOf("/") + 1);
    const base = baseOf(sub.rel);

    let candidates = byDir.get(d) ?? [];
    let nameHint: string | null = null;
    if (!candidates.length && SUBS_DIR.test(dName)) candidates = byDir.get(parent) ?? [];
    if (!candidates.length && SUBS_DIR.test(pName)) {
      candidates = byDir.get(dirOf(parent)) ?? []; // Subs/<video name>/2_English.srt
      nameHint = dName;
    }
    if (!candidates.length) continue;

    const ep = parseEpisode(base, candidates.find((c) => c.season !== null)?.season ?? null);
    let match =
      (ep &&
        candidates.find(
          (c) => c.role === "episode" && c.season === ep.season && c.episode === ep.episode,
        )) ||
      candidates.find((c) => norm(base).startsWith(norm(baseOf(c.entry.rel)))) ||
      (nameHint && candidates.find((c) => norm(baseOf(c.entry.rel)) === norm(nameHint!))) ||
      (candidates.filter((c) => c.role === "movie").length === 1
        ? candidates.find((c) => c.role === "movie")
        : undefined);
    if (match) match.subs.push({ entry: sub, lang: subLang(base) });
  }
}

/** Build the plan for one library root. `rootName` is the root folder's own name. */
export function planLibrary(rootName: string, entries: Entry[]): Plan {
  const skipped: Plan["skipped"] = [];
  const videos: Entry[] = [];
  for (const e of entries) {
    if (e.kind !== "video") continue;
    if (isSample(e)) skipped.push({ rel: e.rel, reason: "sample" });
    else videos.push(e);
  }

  const root = buildTree(rootName, videos);
  const { nodes, loose } = findTitleNodes(root);
  const drafts: Draft[] = nodes.flatMap((n) => planFolder(n, allVideos(n), rootName));

  // Loose files at the root: episodes group by their name prefix, the rest are movies.
  const looseShows = new Map<string, Entry[]>();
  for (const e of loose) {
    const ep = parseEpisode(baseOf(e.rel), null);
    if (ep && ep.prefix) {
      const k = titleKey(ep.prefix);
      looseShows.set(k, [...(looseShows.get(k) ?? []), e]);
    } else drafts.push(...planFolder(null, [e], rootName));
  }
  for (const files of looseShows.values()) {
    const d = planFolder(null, files, rootName)[0];
    const pre = parseEpisode(baseOf(files[0].rel), null)!.prefix;
    d.name = cleanName(pre).name;
    d.year = cleanName(pre).year;
    drafts.push(d);
  }

  // Merge titles that clean to the same name (a show split into one folder per season).
  // An undated title joins a dated one of the same name when there is exactly one.
  const byName = new Map<string, Draft[]>();
  for (const d of drafts) {
    const k = `${d.kind}:${titleKey(d.name)}`;
    byName.set(k, [...(byName.get(k) ?? []), d]);
  }
  const titles: PlannedTitle[] = [];
  for (const group of byName.values()) {
    const years = [...new Set(group.map((g) => g.year).filter((y): y is number => y !== null))];
    const buckets = new Map<string, Draft[]>();
    for (const g of group) {
      const y = g.year ?? (years.length === 1 ? years[0] : null);
      const k = String(y);
      buckets.set(k, [...(buckets.get(k) ?? []), g]);
    }
    for (const [y, ds] of buckets) {
      const year = y === "null" ? null : Number(y);
      const name = ds.map((d) => d.name).sort((a, b) => b.length - a.length)[0];
      titles.push({
        key: `${ds[0].kind}:${titleKey(name)}${year ? `:${year}` : ""}`,
        name,
        year,
        kind: ds[0].kind,
        folders: [...new Set(ds.flatMap((d) => d.folders))],
        files: ds.flatMap((d) => d.files),
        warnings: [],
      });
    }
  }

  pairSubs(titles, entries.filter((e) => e.kind === "sub"));

  for (const t of titles) {
    if (t.kind !== "show") continue;
    const seen = new Map<string, PlannedFile>();
    for (const f of t.files) {
      if (f.role === "unknown") t.warnings.push(`No episode number: ${f.entry.rel}`);
      if (f.role !== "episode") continue;
      for (let e = f.episode!; e <= (f.episodeEnd ?? f.episode!); e++) {
        const k = `${f.season}x${e}`;
        const prev = seen.get(k);
        if (prev) t.warnings.push(`Duplicate S${f.season}E${e}: ${prev.entry.rel} and ${f.entry.rel}`);
        else seen.set(k, f);
      }
    }
    t.files.sort(
      (a, b) =>
        (a.role === "extra" ? 1 : 0) - (b.role === "extra" ? 1 : 0) ||
        (a.season ?? 999) - (b.season ?? 999) ||
        (a.episode ?? 999) - (b.episode ?? 999) ||
        a.entry.rel.localeCompare(b.entry.rel),
    );
  }
  titles.sort((a, b) => a.name.localeCompare(b.name));
  return { titles, skipped };
}
