// Skip intro: the pure rules. Which chapter is the intro or the credits, which
// marker wins, where the analysed regions are, when the Skip intro button
// shows, when auto-skip fires, and when the Next-episode card appears.
// No I/O here, so all of it is unit-tested (segmentRules.test.ts).

export type Kind = "intro" | "credits";
export type Source = "manual" | "chapter" | "audio";
export type Span = { start: number; end: number };
export type SegmentRow = {
  kind: Kind;
  start_s: number | null;
  end_s: number | null;
  source: Source;
  confidence: number | null;
};
/** The marker in effect for one kind: a span, or `null` span = "none", plus the source that decided it. */
export type Marker = { span: Span | null; source: Source; confidence: number | null };
export type Chapter = { title: string | null; start: number; end: number };

/** Highest priority first; a manual marker is never overwritten by analysis. */
const PRIORITY: Source[] = ["manual", "chapter", "audio"];

export function effectiveMarker(rows: SegmentRow[], kind: Kind): Marker | null {
  for (const source of PRIORITY) {
    const r = rows.find((x) => x.kind === kind && x.source === source);
    if (r) {
      const span = r.start_s !== null && r.end_s !== null ? { start: r.start_s, end: r.end_s } : null;
      return { span, source, confidence: r.confidence };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chapters

const INTRO_TITLE = /^(intro|opening( credits| theme)?|op|main titles?|title sequence|theme)\b/i;
const CREDITS_TITLE = /credit|ending|outro|\bed\b/i;
export const INTRO_LEN = { min: 15, max: 150 };
export const CREDITS_LEN = { min: 15, max: 300 };

/** Chapters with start and end, sorted. mpv lists only start times (`time`). */
export function normaliseChapters(
  list: { title?: string | null; time?: number; start?: number; end?: number }[],
  duration: number,
): Chapter[] {
  const xs = list
    .map((c) => ({ title: c.title ?? null, start: c.start ?? c.time ?? NaN, end: c.end }))
    .filter((c) => Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start);
  return xs.map((c, i) => ({
    title: c.title,
    start: c.start,
    end: c.end !== undefined && c.end > c.start ? c.end : (xs[i + 1]?.start ?? duration),
  }));
}

/**
 * The intro is a chapter named like one ("Intro", "Opening", "OP", "Main titles"…)
 * in the first 40% lasting 15–150 s. The credits are a chapter named like
 * them ("Credits", "Ending", "ED"…) starting after the halfway point.
 */
export function classifyChapters(chapters: Chapter[], duration: number): { intro: Span | null; credits: Span | null } {
  let intro: Span | null = null;
  let credits: Span | null = null;
  if (!(duration > 0)) return { intro, credits };
  for (const c of chapters) {
    const title = (c.title ?? "").trim();
    const len = c.end - c.start;
    if (!intro && INTRO_TITLE.test(title) && c.start <= duration * 0.4 && len >= INTRO_LEN.min && len <= INTRO_LEN.max) {
      intro = { start: c.start, end: c.end };
    } else if (!credits && CREDITS_TITLE.test(title) && c.start >= duration * 0.5 && len >= 5) {
      credits = { start: c.start, end: c.end };
    }
  }
  return { intro, credits };
}

/** Moves each edge to a chapter boundary when one is within `within` seconds. */
export function snapToBoundaries(span: Span, bounds: number[], within = 3): Span {
  const snap = (t: number) => {
    let best = t;
    let dist = within;
    for (const b of bounds) {
      const d = Math.abs(b - t);
      if (d <= dist) {
        dist = d;
        best = b;
      }
    }
    return best;
  };
  const s = { start: snap(span.start), end: snap(span.end) };
  return s.end > s.start ? s : span;
}

// ---------------------------------------------------------------------------
// Analysis regions and results

/** The part of a file the audio analysis reads for each kind. */
export function regionOf(kind: Kind, duration: number): { start: number; length: number } {
  if (kind === "intro") return { start: 0, length: Math.min(600, duration * 0.3) };
  const length = Math.min(300, duration * 0.2);
  return { start: Math.max(0, duration - length), length };
}

/** Skipping lands this far before the detected end, so it never cuts the first line after the intro. */
export const END_MARGIN = 0.5;

/**
 * An analysis result (seconds from the region start) as a marker span in the
 * file, or null when it breaks the rules (credits before the halfway point).
 */
export function audioSpan(kind: Kind, found: Span, duration: number, chapterStarts: number[]): Span | null {
  const r = regionOf(kind, duration);
  let s = snapToBoundaries({ start: r.start + found.start, end: r.start + found.end }, chapterStarts);
  s = { start: Math.max(0, s.start), end: Math.min(duration, s.end) };
  if (kind === "intro") s = { start: s.start, end: s.end - END_MARGIN };
  if (kind === "credits" && s.start < duration * 0.5) return null;
  return s.end > s.start ? round(s) : null;
}

const round = (s: Span): Span => ({ start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100 });

/**
 * Where to look for the fade that ends an intro: from 1 s before the end the
 * audio match found to 8 s after it. The music can stop a few seconds before
 * the title sequence does (a "Created by" card over other audio).
 */
export function fadeWindow(intro: Span): { start: number; length: number } {
  return { start: Math.max(0, intro.end + END_MARGIN - 1), length: 9 };
}

/** The intro extended to the fade (black picture over silence) found after it, if any. */
export function withFade(intro: Span, fadeEnd: number | null): Span {
  if (fadeEnd === null) return intro;
  const raw = intro.end + END_MARGIN;
  if (fadeEnd <= raw || fadeEnd > raw + 8) return intro;
  return round({ start: intro.start, end: fadeEnd - END_MARGIN });
}

// ---------------------------------------------------------------------------
// Player

/** The button hides when fewer than this many seconds of the intro remain. */
export const SKIP_MIN_LEFT = 5;

export function skipVisible(time: number, intro: Span | null): boolean {
  return !!intro && time >= intro.start && time < intro.end - SKIP_MIN_LEFT;
}

/**
 * Auto-skip fires only when playback runs into the intro: the previous
 * position was just before its start (normal playback, not a seek), or the
 * file has just started (`prev` null) within 2 s of the intro's start.
 * Seeking into the intro or resuming in the middle of it shows the button instead.
 */
export function runsInto(prev: number | null, time: number, intro: Span): boolean {
  if (!skipVisible(time, intro)) return false;
  if (prev === null) return time <= intro.start + 2;
  return prev < intro.start && time - prev >= 0 && time - prev <= 1.5;
}

/** Valid hand-set intro: end after start, 5–300 s long. */
export function validManual(start: number | null, end: number | null): start is number {
  return start !== null && end !== null && end - start >= 5 && end - start <= 300;
}

/**
 * When the Next-episode card shows (`cardAt`) and when its autoplay countdown
 * may start (`countdownAt`). Detected credits come first; when something
 * plays after them (they end more than 20 s before the file does), the card
 * shows at the credits but the countdown waits for the old end-of-file point,
 * so a scene after the credits isn't cut off. When they run to the end, the
 * card never comes later than the old guess: audio matching sometimes finds
 * only the last part of the credits (the music shared by every episode).
 */
export function creditsPlan(credits: Span | null, chapters: Chapter[], duration: number): { cardAt: number; countdownAt: number } {
  if (!(duration > 0)) return { cardAt: Infinity, countdownAt: Infinity };
  const fallback = duration - Math.max(20, Math.min(45, duration * 0.025));
  if (credits) {
    if (credits.end < duration - 20) return { cardAt: credits.start, countdownAt: Math.max(credits.start, fallback) };
    const at = Math.min(credits.start, fallback);
    return { cardAt: at, countdownAt: at };
  }
  const ch = chapters.find((c) => /credit|ending|outro/i.test(c.title ?? "") && c.start > duration * 0.7);
  const at = ch ? ch.start : fallback;
  return { cardAt: at, countdownAt: at };
}
