// One mpv instance for the app's lifetime, with a small fan-out so player
// components can subscribe and unsubscribe as they mount.
import { invoke } from "@tauri-apps/api/core";
import {
  command,
  getProperty,
  init,
  listenEvents,
  observeProperties,
  setProperty,
  type MpvConfig,
  type MpvEvent,
  type MpvObservableProperty,
} from "tauri-plugin-libmpv-api";
import { getSetting, setSetting } from "../library/db";

export const OBSERVED = [
  ["pause", "flag"],
  ["time-pos", "double", "none"],
  ["duration", "double", "none"],
  ["volume", "double"],
  ["mute", "flag"],
  ["speed", "double"],
  ["sid", "string", "none"],
  ["aid", "string", "none"],
  ["track-list", "node", "none"],
  ["chapter-list", "node", "none"],
  ["paused-for-cache", "flag", "none"],
  ["seeking", "flag", "none"],
  ["hwdec-current", "string", "none"],
  ["video-codec", "string", "none"],
  ["width", "int64", "none"],
  ["height", "int64", "none"],
  ["audio-codec-name", "string", "none"],
  ["audio-params/channel-count", "int64", "none"],
  ["current-ao", "string", "none"],
  ["audio-out-params/channel-count", "int64", "none"],
  ["eof-reached", "flag", "none"],
  // For the stats panel (I): frames the video output and the decoder dropped.
  ["frame-drop-count", "int64", "none"],
  ["decoder-frame-drop-count", "int64", "none"],
] as const satisfies MpvObservableProperty[];

/** Load a file, optionally starting part-way in (no flash of the opening frame). */
export async function loadAt(path: string, startAt: number) {
  await setProperty("start", startAt > 0 ? String(Math.floor(startAt)) : "none");
  await command("loadfile", [path]);
}

const CONFIG: MpvConfig = {
  initialOptions: {
    vo: "gpu-next",
    hwdec: "auto-safe",
    "keep-open": "yes",
    "force-window": "yes",
    "osd-level": 0,
    "input-default-bindings": "no",
    // The library pairs sidecar subtitles itself; mpv's own matching would add duplicates.
    "sub-auto": "no",
    "sub-font-size": 44,
    "sub-border-size": 2.5,
    "sub-shadow-offset": 1,
  },
  observedProperties: OBSERVED,
};

// ---------------------------------------------------------------------------
// Preferences that persist between sessions.

export type Quality = "high" | "standard";
export type Prefs = {
  volume: number;
  subScale: number;
  quality: Quality;
  autoplay: boolean;
  /** Show the Skip intro button. */
  skipIntro: boolean;
  /** Skip intros without asking. */
  skipIntroAuto: boolean;
  /** Find intros and credits in the background. */
  detectSegments: boolean;
};
const DEFAULTS: Prefs = { volume: 100, subScale: 1, quality: "high", autoplay: true, skipIntro: true, skipIntroAuto: false, detectSegments: true };
const KEYS: Record<keyof Prefs, string> = {
  volume: "volume",
  subScale: "sub_scale",
  quality: "video_quality",
  autoplay: "autoplay",
  skipIntro: "skip_intro",
  skipIntroAuto: "skip_intro_auto",
  detectSegments: "detect_segments",
};

let prefs: Prefs = { ...DEFAULTS };
export const getPrefs = () => prefs;

export async function loadPrefs() {
  const [v, s, q, a, si, sa, ds] = await Promise.all([
    getSetting(KEYS.volume), getSetting(KEYS.subScale), getSetting(KEYS.quality), getSetting(KEYS.autoplay),
    getSetting(KEYS.skipIntro), getSetting(KEYS.skipIntroAuto), getSetting(KEYS.detectSegments),
  ]);
  prefs = {
    volume: v !== null ? Number(v) : DEFAULTS.volume,
    subScale: s !== null ? Number(s) : DEFAULTS.subScale,
    quality: q === "standard" ? "standard" : "high",
    autoplay: a !== "false",
    skipIntro: si !== "false",
    skipIntroAuto: sa === "true",
    detectSegments: ds !== "false",
  };
}

/** High: EWA Lanczos upscaling and debanding — worth it for DVD sources on a strong GPU. */
export async function applyQuality(q: Quality) {
  const high = q === "high";
  await setProperty("scale", high ? "ewa_lanczossharp" : "lanczos");
  await setProperty("cscale", high ? "ewa_lanczossharp" : "lanczos");
  await setProperty("dscale", high ? "mitchell" : "hermite");
  await setProperty("deband", high);
}

export async function savePref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs = { ...prefs, [key]: value };
  await setSetting(KEYS[key], String(value));
}

// ---------------------------------------------------------------------------

type Listener = {
  onProp?: (name: string, data: unknown) => void;
  onEvent?: (e: MpvEvent) => void;
};

const listeners = new Set<Listener>();
// Last value of every observed property, replayed to new subscribers.
const latest = new Map<string, unknown>();
let ready: Promise<void> | null = null;

/** Initialise mpv once. Observers are attached before init so initial values aren't missed. */
export function ensureMpv(): Promise<void> {
  return (ready ??= (async () => {
    await observeProperties(OBSERVED, ({ name, data }) => {
      latest.set(name, data);
      listeners.forEach((l) => l.onProp?.(name, data));
    });
    await listenEvents((e) => {
      if (e.event !== "property-change") listeners.forEach((l) => l.onEvent?.(e));
    });
    await loadPrefs();
    await init(CONFIG);
    await setProperty("start", "none");
    await setProperty("volume", prefs.volume);
    await setProperty("sub-scale", prefs.subScale);
    await applyQuality(prefs.quality).catch((e) => console.warn("quality", e));
    if (await invoke<boolean>("dev_start_muted").catch(() => false)) await setProperty("mute", true);
    // If mpv outlived a page reload, init() was a no-op and sent no initial
    // values; read the current ones so the UI never shows stale state.
    for (const [name, format] of [["mute", "flag"], ["volume", "double"], ["speed", "double"], ["pause", "flag"]] as const) {
      const v = await getProperty(name, format).catch(() => null);
      if (v !== null) {
        latest.set(name, v);
        listeners.forEach((l) => l.onProp?.(name, v));
      }
    }
  })().catch((e) => {
    ready = null;
    throw e;
  }));
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  latest.forEach((data, name) => l.onProp?.(name, data));
  return () => listeners.delete(l);
}
