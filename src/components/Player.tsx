import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, getProperty, setProperty } from "tauri-plugin-libmpv-api";
import { applyQuality, ensureMpv, getPrefs, loadAt, savePref, subscribe, type Quality } from "../player/mpv";
import { fmtTime, langName } from "../lib/format";
import { img } from "../lib/img";
import { getTitle, titleFiles, type FileRow, type Sidecar, type TitleRow } from "../library/db";
import { displayName, epCode, epName, playItem, progressOf, sharedChecker, watchOrder } from "../library/present";
import { getTitlePrefs, pickAudio, pickSub, savePosition, setTitlePref, type SubPref } from "../library/progress";
import { libraryChanged } from "../library/store";
import { classifyChapters, creditsPlan, normaliseChapters, runsInto, skipVisible, validManual, type Kind, type Span } from "../library/segmentRules";
import { applyToSeason, clearManual, loadMarkers, saveChapterMarkers, seasonOf, setManual, useSegmentsVersion, type FileMarkers } from "../library/segments";
import { segmentsPlayerClosed, segmentsPlayerOpened } from "../library/segmentScan";
import "./Player.css";

export type PlayItem = {
  path: string;
  title: string; // e.g. episode title
  eyebrow: string; // e.g. "Star Trek: The Next Generation · S1 E1"
  subs: Sidecar[];
  titleId?: number; // library context, for next/previous and the episodes drawer
  fileId?: number;
  titleKey?: string; // for the show's remembered audio/subtitle choice
  fingerprint?: string | null; // watch-state key
  resumeAt?: number; // seconds; 0 = from the start
};

type Track = {
  id: number;
  type: "video" | "audio" | "sub";
  title?: string;
  lang?: string;
  codec?: string;
  external?: boolean;
  "demux-channel-count"?: number;
};
type Chapter = { title?: string; time: number };

type State = {
  paused: boolean;
  time: number;
  duration: number;
  volume: number;
  mute: boolean;
  speed: number;
  sid: string | null;
  aid: string | null;
  tracks: Track[];
  chapters: Chapter[];
  buffering: boolean;
  seeking: boolean;
  hwdec: string | null;
  vcodec: string | null;
  width: number | null;
  height: number | null;
  acodec: string | null;
  channels: number | null;
  ao: string | null;
  outChannels: number | null;
  eof: boolean;
  dropped: number;
  decDropped: number;
};

const INITIAL: State = {
  paused: false, time: 0, duration: 0, volume: 100, mute: false, speed: 1, sid: null, aid: null,
  tracks: [], chapters: [], buffering: false, seeking: false, hwdec: null, vcodec: null,
  width: null, height: null, acodec: null, channels: null, ao: null, outChannels: null, eof: false,
  dropped: 0, decDropped: 0,
};

/** Episodes played back-to-back by autoplay with no key press or click; survives episode switches. */
let autoplayStreak = 0;
const STILL_WATCHING_AFTER = 3;
const COUNTDOWN = 10;
const SAVE_EVERY_MS = 5000;
/** Properties that describe the current file; cached values from the previous file are ignored. */
const FILE_PROPS = new Set(["time-pos", "duration", "track-list", "chapter-list", "eof-reached", "sid", "aid", "width", "height", "video-codec", "audio-codec-name", "frame-drop-count", "decoder-frame-drop-count"]);

const PROP_TO_STATE: Record<string, (p: State, d: any) => State> = {
  pause: (p, d) => ({ ...p, paused: !!d }),
  "time-pos": (p, d) => ({ ...p, time: d ?? 0 }),
  duration: (p, d) => ({ ...p, duration: d ?? 0 }),
  volume: (p, d) => ({ ...p, volume: d ?? 100 }),
  mute: (p, d) => ({ ...p, mute: !!d }),
  speed: (p, d) => ({ ...p, speed: d ?? 1 }),
  sid: (p, d) => ({ ...p, sid: d }),
  aid: (p, d) => ({ ...p, aid: d }),
  "track-list": (p, d) => ({ ...p, tracks: d ?? [] }),
  "chapter-list": (p, d) => ({ ...p, chapters: d ?? [] }),
  "paused-for-cache": (p, d) => ({ ...p, buffering: !!d }),
  seeking: (p, d) => ({ ...p, seeking: !!d }),
  "hwdec-current": (p, d) => ({ ...p, hwdec: d }),
  "video-codec": (p, d) => ({ ...p, vcodec: d }),
  width: (p, d) => ({ ...p, width: d }),
  height: (p, d) => ({ ...p, height: d }),
  "audio-codec-name": (p, d) => ({ ...p, acodec: d }),
  "audio-params/channel-count": (p, d) => ({ ...p, channels: d }),
  "current-ao": (p, d) => ({ ...p, ao: d }),
  "audio-out-params/channel-count": (p, d) => ({ ...p, outChannels: d }),
  "eof-reached": (p, d) => ({ ...p, eof: !!d }),
  "frame-drop-count": (p, d) => ({ ...p, dropped: Number(d ?? 0) }),
  "decoder-frame-drop-count": (p, d) => ({ ...p, decDropped: Number(d ?? 0) }),
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SUB_SIZES: { label: string; value: number }[] = [
  { label: "Small", value: 0.8 },
  { label: "Medium", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Extra large", value: 1.5 },
];

type Menu = null | "subs" | "audio" | "settings";
type Flash = { kind: "play" | "pause" | "back" | "fwd" | "text"; text?: string; n: number };

/** Episodes of the show being played, for next/previous and the drawer. */
type Queue = { t: TitleRow; eps: FileRow[]; shared: (f: FileRow) => boolean };

export default function Player({ item, onClose, onSwitch }: {
  item: PlayItem;
  onClose: () => void;
  onSwitch: (item: PlayItem) => void;
}) {
  const [s, setS] = useState<State>(INITIAL);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [diag, setDiag] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [seekMs, setSeekMs] = useState<number[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [remaining, setRemaining] = useState(false);
  const [prefs, setPrefs] = useState(getPrefs());
  const [queue, setQueue] = useState<Queue | null>(null);
  const [nextPeek, setNextPeek] = useState(false);
  const [subsDone, setSubsDone] = useState(false); // sidecar subtitles attached for this file
  const [sb, setSb] = useState<Storyboard | null>(null); // scrubber preview sprites
  const prefsApplied = useRef(false);
  const [upDismissed, setUpDismissed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [stillAsk, setStillAsk] = useState(false);
  const [markers, setMarkers] = useState<FileMarkers | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [pendingStart, setPendingStart] = useState<number | null>(null); // "Intro starts here" waiting for its end
  const [skipDim, setSkipDim] = useState(false);
  const segVersion = useSegmentsVersion();

  // Latest position, for saves from timers and cleanup.
  const timeRef = useRef(0);
  const durRef = useRef(0);
  const loadedRef = useRef(false); // true once this item's file has loaded
  timeRef.current = s.time;
  durRef.current = s.duration;
  const save = useCallback(
    () => (loadedRef.current ? savePosition(item.fingerprint, timeRef.current, durRef.current) : Promise.resolve("ignored" as const)),
    [item.fingerprint],
  );

  const hideTimer = useRef<number | undefined>(undefined);
  const volTimer = useRef<number | undefined>(undefined);
  const seekStart = useRef<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const flashN = useRef(0);
  const holdChrome = useRef(false);
  const pausedRef = useRef(false);
  pausedRef.current = s.paused;
  holdChrome.current = !!menu || drawer || help || nextPeek;

  const showFlash = useCallback((f: Omit<Flash, "n">) => setFlash({ ...f, n: ++flashN.current }), []);

  // ---- load the item ----
  useEffect(() => {
    let alive = true;
    let subsAdded = false;
    // subscribe() first replays cached values, which belong to the previous file;
    // file-specific ones (position, length, tracks…) must not leak into this one.
    let replaying = true;
    loadedRef.current = false;
    const unsub = subscribe({
      onProp: (name, data) => {
        if (replaying && FILE_PROPS.has(name)) return;
        const f = PROP_TO_STATE[name];
        if (f && alive) setS((p) => f(p, data));
      },
      onEvent: async (e) => {
        if (!alive) return;
        if (e.event === "file-loaded") {
          loadedRef.current = true;
          setStatus("ready");
          if (!subsAdded) {
            subsAdded = true;
            for (const [i, sub] of item.subs.entries()) {
              const flag = i === 0 ? "select" : "auto";
              await command("sub-add", [sub.path, flag, langName(sub.lang) || "External", sub.lang ?? ""]).catch(
                (err) => console.warn("sub-add", sub.path, err),
              );
            }
            // The show's remembered audio/subtitle choice is applied by an effect once the
            // observed track list includes these sidecars. Never read "track-list" with
            // getProperty(..., "node"): that path crashes the plugin natively.
            if (alive) setSubsDone(true);
          }
        } else if (e.event === "playback-restart") {
          if (seekStart.current !== null) {
            const ms = Math.round(performance.now() - seekStart.current);
            seekStart.current = null;
            setSeekMs((p) => [...p.slice(-9), ms]);
          }
          if (alive && loadedRef.current) savePosition(item.fingerprint, timeRef.current, durRef.current);
        } else if (e.event === "end-file" && e.reason === "error") {
          setStatus("error");
          setError("mpv could not open this file.");
        }
      },
    });
    replaying = false;
    (async () => {
      try {
        await ensureMpv();
        if (!alive) return;
        await loadAt(item.path, item.resumeAt ?? 0);
        await setProperty("pause", false);
      } catch (err) {
        if (alive) {
          setStatus("error");
          setError(String(err));
        }
      }
    })();
    return () => {
      alive = false;
      unsub();
      // Save where we stopped (refs still hold this file's values), then let pages refresh.
      if (loadedRef.current) savePosition(item.fingerprint, timeRef.current, durRef.current).finally(libraryChanged);
      command("stop").catch(() => {});
    };
  }, [item]);

  // ---- save position: every few seconds while playing, and on pause ----
  useEffect(() => {
    if (status !== "ready") return;
    if (s.paused) {
      save();
      return;
    }
    const id = window.setInterval(save, SAVE_EVERY_MS);
    return () => window.clearInterval(id);
  }, [status, s.paused, save]);

  // ---- show context: episode list for next/previous and the drawer ----
  useEffect(() => {
    if (!item.titleId) return;
    let alive = true;
    Promise.all([getTitle(item.titleId), titleFiles(item.titleId)]).then(([t, files]) => {
      if (alive && t) setQueue({ t, eps: watchOrder(files), shared: sharedChecker(files) });
    });
    return () => {
      alive = false;
    };
  }, [item.titleId]);

  const index = queue ? queue.eps.findIndex((f) => f.id === item.fileId) : -1;
  const prevEp = index > 0 ? queue!.eps[index - 1] : undefined;
  const nextEp = index >= 0 && index < (queue?.eps.length ?? 0) - 1 ? queue!.eps[index + 1] : undefined;
  const switchTo = useCallback(
    (f: FileRow | undefined) => {
      if (f && queue) onSwitch(playItem(queue.t, f, queue.shared(f)));
    },
    [queue, onSwitch],
  );

  // ---- intro and credits markers (skip intro) ----
  useEffect(() => {
    segmentsPlayerOpened(item.fingerprint);
    setMarkers(null);
    setPendingStart(null);
    if (item.fingerprint) seasonOf(item.fingerprint).then(setSeason).catch(() => setSeason(null));
  }, [item.fingerprint]);
  useEffect(() => () => segmentsPlayerClosed(), []);
  useEffect(() => {
    if (!item.fingerprint) return;
    let alive = true;
    loadMarkers(item.fingerprint)
      .then((m) => alive && setMarkers(m))
      .catch((e) => console.warn("markers", e));
    return () => {
      alive = false;
    };
  }, [item.fingerprint, segVersion]);
  const chapters = useMemo(() => normaliseChapters(s.chapters, s.duration), [s.chapters, s.duration]);
  // Named chapters ("Intro", "Opening", "Credits"…) work on first play, before any analysis.
  useEffect(() => {
    if (status !== "ready" || !item.fingerprint || !markers || !chapters.length || !(s.duration > 0)) return;
    saveChapterMarkers(item.fingerprint, classifyChapters(chapters, s.duration), markers.rows).catch((e) => console.warn("chapters", e));
  }, [status, item.fingerprint, markers, chapters, s.duration]);

  const intro: Span | null = prefs.skipIntro ? (markers?.intro?.span ?? null) : null;
  const showSkip = status === "ready" && !s.eof && skipVisible(s.time, intro);
  const skipIntro = useCallback(
    (auto = false) => {
      if (!intro) return;
      seekStart.current = performance.now();
      command("seek", [intro.end, "absolute"]).catch(() => {});
      setFlash({ kind: "text", text: auto ? "Intro skipped · ← to go back" : "Intro skipped", n: ++flashN.current });
    },
    [intro],
  );
  // Auto-skip: once per file, only when playback runs into the intro (not after a seek into it).
  const prevTime = useRef<number | null>(null);
  const autoSkipped = useRef(false);
  useEffect(() => {
    prevTime.current = null;
    autoSkipped.current = false;
  }, [item]);
  useEffect(() => {
    if (status !== "ready") return;
    const prev = prevTime.current;
    prevTime.current = s.time;
    if (!prefs.skipIntroAuto || !intro || autoSkipped.current || s.paused) return;
    if (runsInto(prev, s.time, intro)) {
      autoSkipped.current = true;
      skipIntro(true);
    }
  }, [s.time, status, intro, prefs.skipIntroAuto, s.paused, skipIntro]);
  // The button stays on screen; it quietens once the controls have been hidden a few seconds (~6 s idle).
  useEffect(() => {
    if (chrome || !showSkip) {
      setSkipDim(false);
      return;
    }
    const t = window.setTimeout(() => setSkipDim(true), 3000);
    return () => window.clearTimeout(t);
  }, [chrome, showSkip]);

  // Hand-set markers from the player menu.
  const markIntro = useCallback(
    async (edge: "start" | "end") => {
      if (!item.fingerprint) return;
      const t = Math.round(timeRef.current * 10) / 10;
      const cur = markers?.intro?.span ?? null;
      const start = edge === "start" ? t : (pendingStart ?? cur?.start ?? null);
      const end = edge === "end" ? t : (cur && cur.end > t ? cur.end : null);
      if (validManual(start, end)) {
        await setManual(item.fingerprint, "intro", { start, end: end! });
        setPendingStart(null);
        showFlash({ kind: "text", text: `Intro ${fmtTime(start)} – ${fmtTime(end!)}` });
      } else if (edge === "start") {
        setPendingStart(t);
        showFlash({ kind: "text", text: "Intro start marked · now mark where it ends" });
      } else {
        showFlash({ kind: "text", text: start === null ? "Mark where the intro starts first" : "An intro is 5 s to 5 min long" });
      }
    },
    [item.fingerprint, markers, pendingStart, showFlash],
  );

  // ---- up next: card at the credits, countdown, autoplay, end screen ----
  const plan = useMemo(
    () => creditsPlan(markers?.credits?.span ?? null, chapters, s.duration),
    [markers, chapters, s.duration],
  );
  const inCredits = status === "ready" && s.time >= plan.cardAt;
  const countdownReady = status === "ready" && s.time >= plan.countdownAt;
  const showUpNext = !!nextEp && inCredits && !upDismissed && !stillAsk && !s.eof;
  const showEnd = status === "ready" && s.eof && !stillAsk && (!nextEp || upDismissed || !prefs.autoplay);

  const advance = useCallback(
    async (auto: boolean) => {
      if (!nextEp) return;
      if (inCredits || s.eof) await savePosition(item.fingerprint, durRef.current, durRef.current); // finished
      if (auto) {
        if (autoplayStreak >= STILL_WATCHING_AFTER) {
          setStillAsk(true);
          setCount(null);
          setProperty("pause", true);
          return;
        }
        autoplayStreak++;
      } else autoplayStreak = 0;
      switchTo(nextEp);
    },
    [nextEp, inCredits, s.eof, item.fingerprint, switchTo],
  );

  // Countdown while the card is up (paused countdown while paused).
  useEffect(() => {
    if (!showUpNext || !prefs.autoplay || !countdownReady) {
      setCount(null);
      return;
    }
    setCount((c) => c ?? COUNTDOWN);
  }, [showUpNext, prefs.autoplay, countdownReady]);
  useEffect(() => {
    if (count === null || s.paused) return;
    if (count <= 0) {
      advance(true);
      return;
    }
    const id = window.setTimeout(() => setCount((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [count, s.paused, advance]);
  // Reached the very end (e.g. seeked past the card): autoplay straight away.
  useEffect(() => {
    if (status === "ready" && s.eof && nextEp && prefs.autoplay && !upDismissed && !stillAsk) advance(true);
    else if (status === "ready" && s.eof) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.eof]);

  // Any key press or click means someone is watching.
  useEffect(() => {
    const reset = () => (autoplayStreak = 0);
    window.addEventListener("keydown", reset);
    window.addEventListener("mousedown", reset);
    return () => {
      window.removeEventListener("keydown", reset);
      window.removeEventListener("mousedown", reset);
    };
  }, []);

  // ---- scrubber previews: build (or load) this file's storyboard in the background ----
  useEffect(() => {
    if (status !== "ready" || !item.fingerprint || !(s.duration > 0) || sb) return;
    let alive = true;
    invoke<Omit<Storyboard, "tileW" | "tileH">>("storyboard", { path: item.path, fingerprint: item.fingerprint, duration: s.duration })
      .then((raw) => {
        // Tile size comes from the first sheet's real dimensions.
        const im = new Image();
        im.onload = () => {
          if (alive) setSb({ ...raw, tileW: im.naturalWidth / raw.cols, tileH: im.naturalHeight / raw.rows });
        };
        im.src = img(raw.sheets[0])!;
      })
      .catch((e) => console.warn("storyboard", e));
    return () => {
      alive = false;
    };
  }, [status, item.fingerprint, item.path, s.duration, sb]);

  // ---- per-session picture and subtitle-size preferences (may change in Settings) ----
  useEffect(() => {
    if (status !== "ready") return;
    const p = getPrefs();
    setProperty("sub-scale", p.subScale).catch(() => {});
    applyQuality(p.quality).catch(() => {});
  }, [status]);

  // ---- re-apply this show's remembered audio/subtitle choice ----
  // Waits for the observed track list to include every sidecar we attached.
  useEffect(() => {
    if (prefsApplied.current || status !== "ready" || !subsDone) return;
    const externals = s.tracks.filter((t) => t.type === "sub" && t.external).length;
    if (!s.tracks.length || externals < item.subs.length) return;
    prefsApplied.current = true;
    getTitlePrefs(item.titleKey).then((prefs) => {
      const sid = prefs.subs ? pickSub(s.tracks, prefs.subs) : null;
      if (sid !== null) setProperty("sid", String(sid)).catch((e) => console.warn("sid", e));
      const aid = prefs.audio ? pickAudio(s.tracks, prefs.audio) : null;
      if (aid !== null) setProperty("aid", String(aid)).catch((e) => console.warn("aid", e));
    });
  }, [status, subsDone, s.tracks, item.subs.length, item.titleKey]);

  // ---- remember this show's audio/subtitle choice (explicit choices only) ----
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = s.tracks;
  const rememberSub = useCallback(
    (sid: number | "no") => {
      const t = tracksRef.current.find((x) => x.type === "sub" && x.id === sid);
      const pref: SubPref =
        sid === "no" || !t ? { mode: "off" } : { mode: "on", lang: t.lang ?? null, external: !!t.external, title: t.title ?? null };
      setTitlePref(item.titleKey, "subs", pref);
    },
    [item.titleKey],
  );
  const rememberAudio = useCallback(
    (aid: number) => {
      const t = tracksRef.current.find((x) => x.type === "audio" && x.id === aid);
      if (t) setTitlePref(item.titleKey, "audio", { lang: t.lang ?? null, title: t.title ?? null });
    },
    [item.titleKey],
  );
  // Track ids go to mpv as strings: the plugin passes JS numbers in a form
  // mpv's sid/aid properties reject ("error accessing property").
  const chooseSub = useCallback(
    (sid: number | "no") => {
      setProperty("sid", String(sid)).catch((e) => console.warn("sid", e));
      rememberSub(sid);
    },
    [rememberSub],
  );
  const chooseAudio = useCallback(
    (aid: number) => {
      setProperty("aid", String(aid)).catch((e) => console.warn("aid", e));
      rememberAudio(aid);
    },
    [rememberAudio],
  );
  /** C / A keys cycle tracks; remember wherever the cycle lands. */
  const cycleTrack = useCallback(
    async (kind: "sub" | "audio") => {
      await command("cycle", [kind]);
      const v = await getProperty(kind === "sub" ? "sid" : "aid", "string").catch(() => null);
      if (kind === "sub") rememberSub(v === "no" || v === null ? "no" : Number(v));
      else if (v && v !== "no") rememberAudio(Number(v));
    },
    [rememberSub, rememberAudio],
  );

  // ---- window title and keep-awake ----
  useEffect(() => {
    getCurrentWindow().setTitle(`${item.title} · Off Player`).catch(() => {});
    return () => {
      getCurrentWindow().setTitle("Off Player").catch(() => {});
    };
  }, [item.title]);
  const playing = status === "ready" && !s.paused;
  useEffect(() => {
    invoke("set_keep_awake", { on: playing }).catch(() => {});
  }, [playing]);
  useEffect(() => () => void invoke("set_keep_awake", { on: false }).catch(() => {}), []);

  // ---- controls ----
  const seekTo = useCallback(async (t: number) => {
    seekStart.current = performance.now();
    await command("seek", [Math.max(0, t), "absolute"]);
  }, []);
  const seekBy = useCallback(
    async (d: number) => {
      seekStart.current = performance.now();
      showFlash({ kind: d < 0 ? "back" : "fwd", text: `${Math.abs(d)} s` });
      await command("seek", [d, "relative"]);
    },
    [showFlash],
  );
  const togglePause = useCallback(() => {
    showFlash({ kind: pausedRef.current ? "play" : "pause" });
    return command("cycle", ["pause"]);
  }, [showFlash]);
  const toggleMute = useCallback(() => command("cycle", ["mute"]), []);
  const toggleFullscreen = useCallback(async () => {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  }, []);
  const setVolume = useCallback(
    (v: number, announce = false) => {
      const vol = Math.round(Math.min(130, Math.max(0, v)));
      setProperty("volume", vol);
      if (s.mute && vol > 0) setProperty("mute", false);
      if (announce) showFlash({ kind: "text", text: `Volume ${vol}%` });
      window.clearTimeout(volTimer.current);
      volTimer.current = window.setTimeout(() => savePref("volume", vol), 600);
    },
    [s.mute, showFlash],
  );
  const setSpeed = useCallback(
    (v: number) => {
      const sp = Math.min(3, Math.max(0.25, Math.round(v * 100) / 100));
      setProperty("speed", sp);
      showFlash({ kind: "text", text: `${sp}×` });
    },
    [showFlash],
  );
  const setSubScale = useCallback(async (v: number) => {
    await setProperty("sub-scale", v);
    await savePref("subScale", v);
    setPrefs(getPrefs());
  }, []);
  const setQuality = useCallback(async (q: Quality) => {
    await applyQuality(q);
    await savePref("quality", q);
    setPrefs(getPrefs());
  }, []);
  const close = useCallback(async () => {
    const w = getCurrentWindow();
    if (await w.isFullscreen()) await w.setFullscreen(false);
    onClose();
  }, [onClose]);

  // ---- auto-hide chrome ----
  const poke = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!pausedRef.current && !holdChrome.current) setChrome(false);
    }, 3000);
  }, []);
  useEffect(() => {
    if (s.paused) setChrome(true);
    else poke();
  }, [s.paused, menu, drawer, help, poke]);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // Lift subtitles clear of the control bar while it is visible (100 = bottom).
  useEffect(() => {
    if (status !== "ready") return;
    setProperty("sub-pos", chrome ? 83 : 100).catch(() => {});
  }, [chrome, status]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      poke();
      const k = e.key;
      if (k === "Escape" || k === "Backspace") {
        e.preventDefault();
        if (help) setHelp(false);
        else if (drawer) setDrawer(false);
        else if (menu) setMenu(null);
        else
          getCurrentWindow().isFullscreen().then((fs) => {
            if (fs && k === "Escape") getCurrentWindow().setFullscreen(false);
            else close();
          });
        return;
      }
      if (k >= "0" && k <= "9" && s.duration > 0) {
        seekTo((Number(k) / 10) * s.duration);
        return;
      }
      switch (k.toLowerCase()) {
        case " ": case "k": e.preventDefault(); togglePause(); break;
        case "arrowleft": case "j": e.preventDefault(); seekBy(e.shiftKey ? -60 : -10); break;
        case "arrowright": case "l": e.preventDefault(); seekBy(e.shiftKey ? 60 : 10); break;
        case "arrowup": e.preventDefault(); setVolume(s.volume + 5, true); break;
        case "arrowdown": e.preventDefault(); setVolume(s.volume - 5, true); break;
        case "f": toggleFullscreen(); break;
        case "m": toggleMute(); showFlash({ kind: "text", text: s.mute ? "Sound on" : "Muted" }); break;
        case "c": cycleTrack("sub"); break;
        case "a": cycleTrack("audio"); break;
        case "n": if (nextEp) advance(false); break;
        case "p": if (prevEp) switchTo(prevEp); break;
        case "e": if (queue) setDrawer((d) => !d); break;
        case "[": setSpeed(s.speed - 0.25); break;
        case "]": setSpeed(s.speed + 0.25); break;
        case "=": setSpeed(1); break;
        case ",": command("frame-back-step"); break;
        case ".": command("frame-step"); break;
        case "i": setDiag((d) => !d); break;
        case "?": case "/": e.preventDefault(); setHelp((h) => !h); break;
        case "s": if (showSkip) skipIntro(); break;
        // Enter on a focused button already clicks it; only take Enter when nothing else would.
        case "enter": if (showSkip && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); skipIntro(); } break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poke, togglePause, seekBy, seekTo, setVolume, setSpeed, toggleFullscreen, toggleMute, close, showFlash,
      s.volume, s.mute, s.speed, s.duration, menu, drawer, help, queue, nextEp, prevEp, switchTo, advance, cycleTrack,
      showSkip, skipIntro]);

  // ---- scrubber ----
  const fracAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const onBarDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    setScrub(fracAt(e.clientX) * s.duration);
  };
  const onBarMove = (e: React.PointerEvent) => {
    const t = fracAt(e.clientX) * s.duration;
    setHover(t);
    if (scrub !== null) setScrub(t);
  };
  const onBarUp = async (e: React.PointerEvent) => {
    if (scrub === null) return;
    const t = fracAt(e.clientX) * s.duration;
    setScrub(null);
    await seekTo(t);
  };

  const shown = scrub ?? s.time;
  const pct = s.duration > 0 ? (shown / s.duration) * 100 : 0;
  const subTracks = s.tracks.filter((t) => t.type === "sub");
  const audioTracks = s.tracks.filter((t) => t.type === "audio");
  const chapterAt = (t: number) => {
    let idx = -1;
    s.chapters.forEach((c, i) => {
      if (c.time <= t) idx = i;
    });
    return idx;
  };
  const hoverChapter = hover !== null ? chapterAt(hover) : -1;
  const avgSeek = seekMs.length ? Math.round(seekMs.reduce((a, b) => a + b, 0) / seekMs.length) : null;
  const trackLabel = (t: Track) =>
    [t.title, langName(t.lang), t.external ? "external" : null].filter(Boolean).join(" · ") || `Track ${t.id}`;
  const busy = status === "loading" || ((s.buffering || s.seeking) && status === "ready");

  return (
    <div
      className={`player ${chrome ? "" : "idle"}`}
      onMouseMove={poke}
      onMouseDown={poke}
    >
      <div
        className="surface"
        onClick={() => (menu ? setMenu(null) : drawer ? setDrawer(false) : togglePause())}
        onDoubleClick={toggleFullscreen}
        onWheel={(e) => setVolume(s.volume + (e.deltaY < 0 ? 5 : -5), true)}
      />

      {busy && status !== "loading" && <div className="buffering"><span className="spinner big" /></div>}
      {status === "loading" && (
        <div className="center-pill">
          <span className="spinner" /> Opening…
        </div>
      )}
      {status === "error" && (
        <div className="error-card">
          <h2>Playback failed</h2>
          <p>{error}</p>
          <button className="btn" onClick={close}>Back</button>
        </div>
      )}

      {flash && <FlashBadge key={flash.n} f={flash} />}

      <header className="top">
        <button className="icon back" onClick={close} aria-label="Back" title="Back (Esc)"><IconBack /></button>
        <div className="title-block">
          <div className="eyebrow">{item.eyebrow}</div>
          <h1>{item.title}</h1>
        </div>
        {s.speed !== 1 && <span className="speed-chip">{s.speed}×</span>}
      </header>

      {diag && (
        <aside className="diag">
          <h3>Stats</h3>
          <dl>
            <dt>Video</dt><dd>{s.vcodec ?? "—"} {s.width && s.height ? `· ${s.width}×${s.height}` : ""}</dd>
            <dt>Decoder</dt><dd>{s.hwdec && s.hwdec !== "no" ? `hardware (${s.hwdec})` : "software"}</dd>
            <dt>Upscaling</dt><dd>{prefs.quality === "high" ? "EWA Lanczos (sharp), deband" : "Lanczos"}</dd>
            <dt>Audio</dt><dd>{s.acodec ?? "—"} {s.channels ? `· ${s.channels} ch` : ""}</dd>
            <dt>Output</dt><dd>{s.ao ?? "—"} {s.outChannels ? `· ${s.outChannels} ch` : ""}</dd>
            <dt>Subtitles</dt><dd>{subTracks.length} track(s), active: {s.sid ?? "—"}</dd>
            <dt>Chapters</dt><dd>{s.chapters.length}</dd>
            <dt>Dropped</dt><dd>{s.dropped} frames{s.decDropped ? ` (decoder ${s.decDropped})` : ""}</dd>
            <dt>Seek</dt><dd>{avgSeek !== null ? `avg ${avgSeek} ms (${seekMs.length})` : "seek to measure"}</dd>
          </dl>
        </aside>
      )}

      {drawer && queue && (
        <EpisodeDrawer
          queue={queue}
          currentId={item.fileId}
          onPick={(f) => {
            setDrawer(false);
            if (f.id !== item.fileId) switchTo(f);
          }}
          onClose={() => setDrawer(false)}
        />
      )}

      {help && <Shortcuts onClose={() => setHelp(false)} />}

      {showSkip && (
        <button
          className={`skip-intro ${chrome ? "" : "low"} ${skipDim ? "dim" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            skipIntro();
          }}
          title="Skip intro (S)"
        >
          Skip intro
        </button>
      )}

      {showUpNext && nextEp && queue && (
        <div className={`up-next ${chrome ? "" : "low"}`}>
          {(nextEp.meta_still ?? nextEp.thumb) && <img src={img(nextEp.meta_still ?? nextEp.thumb)} alt="" />}
          <div className="up-next-body">
            <span className="up-next-eyebrow">
              {count !== null ? `Next episode in ${count}` : "Next episode"}
            </span>
            <span className="up-next-title">{epCode(nextEp)} · {epName(nextEp, queue.shared(nextEp))}</span>
            <div className="up-next-buttons">
              <button className="up-ghost" onClick={() => { autoplayStreak = 0; setUpDismissed(true); }}>Watch credits</button>
              <button
                className="up-primary"
                style={{ ["--p" as string]: count !== null ? `${((COUNTDOWN - count) / COUNTDOWN) * 100}%` : "0%" }}
                onClick={() => advance(false)}
              >
                <IconPlay /> Next episode
              </button>
            </div>
          </div>
        </div>
      )}

      {showEnd && (
        <div className="end-screen">
          {nextEp && queue ? (
            <div className="end-card">
              {(nextEp.meta_still ?? nextEp.thumb) && <img src={img(nextEp.meta_still ?? nextEp.thumb)} alt="" />}
              <div className="end-body">
                <span className="up-next-eyebrow">Up next · {epCode(nextEp)}</span>
                <h2>{epName(nextEp, queue.shared(nextEp))}</h2>
                {nextEp.meta_overview && <p>{nextEp.meta_overview}</p>}
                <div className="end-buttons">
                  <button className="up-primary" onClick={() => advance(false)}><IconPlay /> Play next episode</button>
                  <button className="up-ghost" onClick={close}>Back to browse</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="end-card plain">
              <div className="end-body">
                <span className="up-next-eyebrow">{queue ? displayName(queue.t) : "Finished"}</span>
                <h2>{queue ? "That's the last episode you have." : "The end."}</h2>
                <div className="end-buttons">
                  <button className="up-ghost" onClick={() => seekTo(0)}>Watch again</button>
                  <button className="up-primary" onClick={close}>Back to browse</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {stillAsk && (
        <div className="end-screen">
          <div className="end-card plain">
            <div className="end-body">
              <span className="up-next-eyebrow">{queue ? displayName(queue.t) : ""}</span>
              <h2>Are you still watching?</h2>
              <div className="end-buttons">
                <button className="up-primary" onClick={() => { autoplayStreak = 0; setStillAsk(false); switchTo(nextEp); }}>
                  <IconPlay /> Continue watching
                </button>
                <button className="up-ghost" onClick={close}>Back to browse</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="controls">
        <div
          className="bar"
          ref={bar}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerLeave={() => setHover(null)}
        >
          <div className="track">
            <div className="fill" style={{ width: `${pct}%` }} />
            {hover !== null && s.duration > 0 && (
              <div className="ghost" style={{ width: `${(hover / s.duration) * 100}%` }} />
            )}
            {s.duration > 0 &&
              s.chapters.slice(1).map((c, i) => (
                <span key={i} className="tick" style={{ left: `${(c.time / s.duration) * 100}%` }} />
              ))}
            {s.duration > 0 &&
              (["intro", "credits"] as Kind[]).map((k) => {
                const span = k === "intro" ? intro : (markers?.credits?.span ?? null);
                return span ? (
                  <span
                    key={k}
                    className={`seg-tint ${k}`}
                    style={{ left: `${(span.start / s.duration) * 100}%`, width: `${((span.end - span.start) / s.duration) * 100}%` }}
                  />
                ) : null;
              })}
          </div>
          <div className="knob" style={{ left: `${pct}%` }} />
          {hover !== null && s.duration > 0 && (
            <div
              className={`hover-tip ${sb ? "with-preview" : ""}`}
              style={{ left: `clamp(${sb ? sb.tileW / 2 + 12 : 60}px, ${(hover / s.duration) * 100}%, calc(100% - ${sb ? sb.tileW / 2 + 12 : 60}px))` }}
            >
              {sb && <ScrubPreview sb={sb} t={hover} />}
              <span className="tc">{fmtTime(hover)}</span>
              {intro && hover >= intro.start && hover < intro.end ? (
                <span className="ch">Intro</span>
              ) : markers?.credits?.span && hover >= markers.credits.span.start && hover < markers.credits.span.end ? (
                <span className="ch">Credits</span>
              ) : hoverChapter >= 0 ? (
                <span className="ch">{s.chapters[hoverChapter].title || `Chapter ${hoverChapter + 1}`}</span>
              ) : null}
            </div>
          )}
        </div>

        <div className="row">
          <div className="group">
            <button className="icon big" onClick={togglePause} aria-label={s.paused ? "Play" : "Pause"} title={s.paused ? "Play (Space)" : "Pause (Space)"}>
              {s.paused ? <IconPlay /> : <IconPause />}
            </button>
            <button className="icon" onClick={() => seekBy(-10)} aria-label="Back 10 seconds" title="Back 10 s (←)"><IconRew /></button>
            <button className="icon" onClick={() => seekBy(10)} aria-label="Forward 10 seconds" title="Forward 10 s (→)"><IconFwd /></button>
            {nextEp && (
              <div className="menu-anchor" onMouseEnter={() => setNextPeek(true)} onMouseLeave={() => setNextPeek(false)}>
                <button className="icon" onClick={() => switchTo(nextEp)} aria-label="Next episode" title="Next episode (N)"><IconNext /></button>
                {nextPeek && queue && <NextPeek f={nextEp} label={epName(nextEp, queue.shared(nextEp))} />}
              </div>
            )}
            <div className="volume">
              <button className="icon" onClick={toggleMute} aria-label="Mute" title="Mute (M)">
                {s.mute || s.volume === 0 ? <IconMute /> : <IconVol />}
              </button>
              <input
                type="range" min={0} max={130} step={1}
                value={s.mute ? 0 : s.volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                style={{ ["--v" as string]: `${((s.mute ? 0 : s.volume) / 130) * 100}%` }}
                aria-label="Volume"
              />
            </div>
            <button className="time" onClick={() => setRemaining((r) => !r)} title="Show time remaining">
              {remaining ? (
                <span>−{fmtTime(Math.max(0, s.duration - shown))}</span>
              ) : (
                <>
                  <span>{fmtTime(shown)}</span>
                  <span className="dim"> / {fmtTime(s.duration)}</span>
                </>
              )}
            </button>
          </div>

          <div className="group">
            {queue && queue.eps.length > 1 && (
              <button className={`icon ${drawer ? "on" : ""}`} onClick={() => setDrawer((d) => !d)} aria-label="Episodes" title="Episodes (E)">
                <IconEpisodes />
              </button>
            )}
            <div className="menu-anchor">
              <button className={`icon ${menu === "audio" ? "on" : ""}`} onClick={() => setMenu(menu === "audio" ? null : "audio")} aria-label="Audio track" title="Audio (A)">
                <IconAudio />
              </button>
              {menu === "audio" && (
                <div className="menu">
                  <div className="menu-title">Audio</div>
                  {audioTracks.map((t) => (
                    <button key={t.id} className={String(t.id) === s.aid ? "sel" : ""}
                      onClick={() => { chooseAudio(t.id); setMenu(null); }}>
                      {trackLabel(t)}
                      <span className="meta">{t.codec?.toUpperCase()} {t["demux-channel-count"] ? `${t["demux-channel-count"]}ch` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button className={`icon ${menu === "subs" ? "on" : ""}`} onClick={() => setMenu(menu === "subs" ? null : "subs")} aria-label="Subtitles" title="Subtitles (C)">
                <IconSubs />
              </button>
              {menu === "subs" && (
                <div className="menu scroll">
                  <div className="menu-title">Subtitles</div>
                  <button className={s.sid === "no" || s.sid === null ? "sel" : ""}
                    onClick={() => { chooseSub("no"); setMenu(null); }}>Off</button>
                  {subTracks.map((t) => (
                    <button key={t.id} className={String(t.id) === s.sid ? "sel" : ""}
                      onClick={() => { chooseSub(t.id); setMenu(null); }}>
                      {trackLabel(t)}
                      <span className="meta">{t.codec?.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="menu-anchor">
              <button className={`icon ${menu === "settings" ? "on" : ""}`} onClick={() => setMenu(menu === "settings" ? null : "settings")} aria-label="Playback settings" title="Playback settings">
                <IconGear />
              </button>
              {menu === "settings" && (
                <div className="menu wide">
                  <div className="menu-title">Speed</div>
                  <div className="chips">
                    {SPEEDS.map((v) => (
                      <button key={v} className={s.speed === v ? "on" : ""} onClick={() => setSpeed(v)}>{v === 1 ? "Normal" : `${v}×`}</button>
                    ))}
                  </div>
                  <div className="menu-title">Subtitle size</div>
                  <div className="chips">
                    {SUB_SIZES.map((z) => (
                      <button key={z.value} className={prefs.subScale === z.value ? "on" : ""} onClick={() => setSubScale(z.value)}>{z.label}</button>
                    ))}
                  </div>
                  <div className="menu-title">Autoplay next episode</div>
                  <div className="chips">
                    <button className={prefs.autoplay ? "on" : ""} onClick={async () => { await savePref("autoplay", true); setPrefs(getPrefs()); }}>On</button>
                    <button className={!prefs.autoplay ? "on" : ""} onClick={async () => { await savePref("autoplay", false); setPrefs(getPrefs()); }}>Off</button>
                  </div>
                  {item.fingerprint && (
                    <>
                      <div className="menu-title">
                        Intro <span className="menu-note">{introNote(markers, pendingStart)}</span>
                      </div>
                      <div className="chips">
                        <button onClick={() => markIntro("start")} title="Mark the current moment as the start of the intro">Starts here</button>
                        <button onClick={() => markIntro("end")} title="Mark the current moment as the end of the intro">Ends here</button>
                        <button
                          className={markers?.intro?.source === "manual" && !markers.intro.span ? "on" : ""}
                          onClick={() => { setPendingStart(null); setManual(item.fingerprint!, "intro", null); }}
                          title="This episode has no intro"
                        >
                          None
                        </button>
                      </div>
                      {markers?.intro?.source === "manual" && (
                        <>
                          {markers.intro.span && season !== null && (
                            <button
                              onClick={async () => {
                                const n = await applyToSeason(item.fingerprint!, "intro", markers.intro!.span!);
                                showFlash({ kind: "text", text: n ? `Applied to ${n} more episode${n === 1 ? "" : "s"}` : "No other episodes without your own times" });
                              }}
                            >
                              Use these times for the rest of season {season}
                            </button>
                          )}
                          <button onClick={() => clearManual(item.fingerprint!, "intro")}>Back to automatic</button>
                        </>
                      )}
                    </>
                  )}
                  <div className="menu-title">Picture</div>
                  <div className="chips">
                    <button className={prefs.quality === "high" ? "on" : ""} onClick={() => setQuality("high")}>Sharper upscaling</button>
                    <button className={prefs.quality === "standard" ? "on" : ""} onClick={() => setQuality("standard")}>Standard</button>
                  </div>
                  <div className="menu-sep" />
                  <button onClick={() => { setMenu(null); setDiag((d) => !d); }}>{diag ? "Hide" : "Show"} stats <span className="meta">I</span></button>
                  <button onClick={() => { setMenu(null); setHelp(true); }}>Keyboard shortcuts <span className="meta">?</span></button>
                </div>
              )}
            </div>
            <button className="icon" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen (F)"><IconFull /></button>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<string, string> = { manual: "set by you", chapter: "from chapters", audio: "found automatically" };

/** One line on where this episode's intro marker came from. */
function introNote(m: FileMarkers | null, pendingStart: number | null): string {
  if (pendingStart !== null) return `start marked at ${fmtTime(pendingStart)}`;
  const i = m?.intro;
  if (!i) return m ? "none found" : "";
  if (!i.span) return `none (${SOURCE_LABEL[i.source]})`;
  return `${fmtTime(i.span.start)}–${fmtTime(i.span.end)}, ${SOURCE_LABEL[i.source]}`;
}

type Storyboard ={ sheets: string[]; interval: number; cols: number; rows: number; count: number; tileW: number; tileH: number };

/** One tile of the storyboard sprite sheets, for the moment under the pointer. */
function ScrubPreview({ sb, t }: { sb: Storyboard; t: number }) {
  const i = Math.min(sb.count - 1, Math.max(0, Math.floor(t / sb.interval)));
  const perSheet = sb.cols * sb.rows;
  const sheet = sb.sheets[Math.floor(i / perSheet)] ?? sb.sheets[sb.sheets.length - 1];
  const k = i % perSheet;
  return (
    <span
      className="scrub-preview"
      style={{
        width: sb.tileW,
        height: sb.tileH,
        backgroundImage: `url("${img(sheet)}")`,
        backgroundSize: `${sb.tileW * sb.cols}px ${sb.tileH * sb.rows}px`,
        backgroundPosition: `-${(k % sb.cols) * sb.tileW}px -${Math.floor(k / sb.cols) * sb.tileH}px`,
      }}
    />
  );
}

function FlashBadge({ f }: { f: Flash }) {
  return (
    <div className={`flash flash-${f.kind}`} aria-hidden>
      {f.kind === "play" && <IconPlay />}
      {f.kind === "pause" && <IconPause />}
      {f.kind === "back" && <IconSkipBack />}
      {f.kind === "fwd" && <IconSkipFwd />}
      {f.text && <span>{f.text}</span>}
    </div>
  );
}

function NextPeek({ f, label }: { f: FileRow; label: string }) {
  const still = f.meta_still ?? f.thumb;
  return (
    <div className="next-peek">
      {still && <img src={img(still)} alt="" />}
      <div className="next-peek-text">
        <span className="next-peek-eyebrow">Next episode · {epCode(f)}</span>
        <span className="next-peek-title">{label}</span>
        {f.meta_overview && <span className="next-peek-overview">{f.meta_overview}</span>}
      </div>
    </div>
  );
}

function EpisodeDrawer({ queue, currentId, onPick, onClose }: {
  queue: Queue; currentId?: number; onPick: (f: FileRow) => void; onClose: () => void;
}) {
  const current = queue.eps.find((f) => f.id === currentId);
  const seasons = useMemo(() => [...new Set(queue.eps.map((f) => f.season!))], [queue.eps]);
  const [season, setSeason] = useState(current?.season ?? seasons[0]);
  const list = queue.eps.filter((f) => f.season === season);
  const currentRef = useRef<HTMLLIElement>(null);
  // Braces matter: in this WebView scrollIntoView() returns a Promise, which
  // React would otherwise take as the effect's cleanup and crash on unmount.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center" });
  }, [season]);
  return (
    <aside className="drawer" onClick={(e) => e.stopPropagation()}>
      <header className="drawer-head">
        <h3>Episodes</h3>
        <button className="icon" onClick={onClose} aria-label="Close episodes">×</button>
      </header>
      {seasons.length > 1 && (
        <div className="drawer-seasons">
          {seasons.map((n) => (
            <button key={n} className={n === season ? "on" : ""} onClick={() => setSeason(n)}>
              {n === 0 ? "Specials" : `S${n}`}
            </button>
          ))}
        </div>
      )}
      <ol className="drawer-list">
        {list.map((f) => {
          const still = f.meta_still ?? f.thumb;
          const isCur = f.id === currentId;
          return (
            <li key={f.id} ref={isCur ? currentRef : undefined}>
              <button className={`drawer-ep ${isCur ? "current" : ""}`} onClick={() => onPick(f)}>
                <span className="drawer-still">
                  {still && <img src={img(still)} alt="" loading="lazy" />}
                  {isCur ? <span className="now">Playing</span> : f.pb_watched ? <span className="seen" aria-label="Watched">✓</span> : null}
                  {!isCur && !f.pb_watched && progressOf(f) !== null && (
                    <span className="mini-progress"><span style={{ width: `${progressOf(f)! * 100}%` }} /></span>
                  )}
                </span>
                <span className="drawer-text">
                  <span className="drawer-code">{epCode(f)}{f.duration ? ` · ${Math.round(f.duration / 60)} min` : ""}</span>
                  <span className="drawer-title">{epName(f, queue.shared(f))}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play or pause"],
  ["← / →", "Back / forward 10 s"],
  ["Shift + ← / →", "Back / forward 1 min"],
  ["J / L", "Back / forward 10 s"],
  ["0 – 9", "Jump to 0–90%"],
  ["↑ / ↓", "Volume"],
  ["M", "Mute"],
  ["Mouse wheel", "Volume"],
  ["C", "Next subtitle track"],
  ["A", "Next audio track"],
  ["S", "Skip intro (while the button shows)"],
  ["N / P", "Next / previous episode"],
  ["E", "Episodes list"],
  ["[ / ] / =", "Slower / faster / normal speed"],
  [", / .", "Frame back / forward"],
  ["F / double-click", "Fullscreen"],
  ["I", "Stats"],
  ["Esc", "Close panel, exit fullscreen, back"],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts" onClick={onClose}>
      <div className="shortcuts-card" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        <dl>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* ---- icons (inline, 24px grid) ---- */
const P = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IconPlay = () => <svg {...P} fill="currentColor" stroke="none"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.4-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" /></svg>;
const IconPause = () => <svg {...P} fill="currentColor" stroke="none"><rect x="6" y="4" width="4.2" height="16" rx="1.2" /><rect x="13.8" y="4" width="4.2" height="16" rx="1.2" /></svg>;
const IconBack = () => <svg {...P}><path d="M15 5l-7 7 7 7" /></svg>;
const IconRew = () => <svg {...P}><path d="M11 5 6 9l5 4" /><path d="M6 9h8a5 5 0 0 1 0 10h-3" /><text x="12.5" y="17.2" fontSize="6.5" fill="currentColor" stroke="none" fontWeight="700" textAnchor="middle">10</text></svg>;
const IconFwd = () => <svg {...P}><path d="m13 5 5 4-5 4" /><path d="M18 9h-8a5 5 0 0 0 0 10h3" /><text x="11.5" y="17.2" fontSize="6.5" fill="currentColor" stroke="none" fontWeight="700" textAnchor="middle">10</text></svg>;
const IconSkipBack = () => <svg {...P}><path d="m11 6-6 6 6 6M19 6l-6 6 6 6" /></svg>;
const IconSkipFwd = () => <svg {...P}><path d="m13 6 6 6-6 6M5 6l6 6-6 6" /></svg>;
const IconNext = () => <svg {...P}><path d="M6 5.5v13l9-6.5Z" fill="currentColor" stroke="none" /><path d="M18 5v14" strokeWidth="2.2" /></svg>;
const IconVol = () => <svg {...P}><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" fill="currentColor" /><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
const IconMute = () => <svg {...P}><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" fill="currentColor" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></svg>;
const IconSubs = () => <svg {...P}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 12.5h4M13 12.5h4M7 15.5h7" /></svg>;
const IconAudio = () => <svg {...P}><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></svg>;
const IconEpisodes = () => <svg {...P}><rect x="3" y="4" width="13" height="9" rx="2" /><path d="M7 17h13M7 20.5h9M19.5 8v5" /></svg>;
const IconGear = () => <svg {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>;
const IconFull = () => <svg {...P}><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" /></svg>;
