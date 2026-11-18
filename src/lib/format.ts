export function fmtTime(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t) || t < 0) t = 0;
  const s = Math.floor(t % 60);
  const m = Math.floor((t / 60) % 60);
  const h = Math.floor(t / 3600);
  return `${h > 0 ? `${h}:` : ""}${h > 0 ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
}

/** "1 h 31 min", "42 min" */
export function fmtRuntime(t: number | null | undefined): string {
  if (!t) return "";
  const m = Math.round(t / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function fmtBytes(b: number | null | undefined): string {
  if (!b) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(b >= 100 || i < 3 ? 0 : 1)} ${units[i]}`;
}

const VCODEC: Record<string, string> = {
  h264: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9", mpeg4: "MPEG-4", mpeg2video: "MPEG-2", vc1: "VC-1",
};
const ACODEC: Record<string, string> = {
  ac3: "Dolby Digital", eac3: "Dolby Digital+", truehd: "TrueHD", dts: "DTS", aac: "AAC",
  flac: "FLAC", opus: "Opus", mp3: "MP3", vorbis: "Vorbis",
};

export const videoCodec = (c: string | null) => (c ? VCODEC[c] ?? c.toUpperCase() : "");
export const audioCodec = (c: string | null) => (c ? ACODEC[c] ?? c.toUpperCase() : "");

export function channels(n: number | null): string {
  if (!n) return "";
  return n === 1 ? "Mono" : n === 2 ? "Stereo" : n === 6 ? "5.1" : n === 8 ? "7.1" : `${n} ch`;
}

export function resolution(w: number | null, h: number | null): string {
  if (!w || !h) return "";
  if (w >= 3200 || h >= 2000) return "4K";
  if (w >= 1800 || h >= 1000) return "1080p";
  if (w >= 1200 || h >= 700) return "720p";
  return "SD";
}

const LANG: Record<string, string> = {
  en: "English", eng: "English", es: "Spanish", spa: "Spanish", fr: "French", fre: "French",
  de: "German", ger: "German", it: "Italian", ita: "Italian", ja: "Japanese", jpn: "Japanese",
  hi: "Hindi", hin: "Hindi", pt: "Portuguese", por: "Portuguese", ru: "Russian", rus: "Russian",
};
export const langName = (l: string | null | undefined) => (l ? LANG[l.toLowerCase()] ?? l.toUpperCase() : "");

export const pad2 = (n: number) => String(n).padStart(2, "0");
export function episodeCode(s: number | null, e: number | null, end?: number | null) {
  if (s == null || e == null) return "";
  return `S${pad2(s)}E${pad2(e)}${end ? `–E${pad2(end)}` : ""}`;
}
