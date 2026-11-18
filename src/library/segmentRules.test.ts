import { describe, expect, it } from "vitest";
import {
  audioSpan,
  classifyChapters,
  creditsPlan,
  effectiveMarker,
  END_MARGIN,
  fadeWindow,
  normaliseChapters,
  regionOf,
  runsInto,
  skipVisible,
  snapToBoundaries,
  validManual,
  withFade,
  type SegmentRow,
} from "./segmentRules";

const row = (p: Partial<SegmentRow>): SegmentRow => ({ kind: "intro", start_s: 60, end_s: 105, source: "audio", confidence: 1, ...p });

describe("effectiveMarker", () => {
  it("prefers manual over chapter over audio", () => {
    const rows = [row({ source: "audio" }), row({ source: "chapter", start_s: 50, end_s: 90 }), row({ source: "manual", start_s: 61, end_s: 100 })];
    expect(effectiveMarker(rows, "intro")).toEqual({ span: { start: 61, end: 100 }, source: "manual", confidence: 1 });
    expect(effectiveMarker(rows.slice(0, 2), "intro")?.source).toBe("chapter");
    expect(effectiveMarker(rows.slice(0, 1), "intro")?.source).toBe("audio");
  });
  it("a manual 'none' hides a detected intro", () => {
    const m = effectiveMarker([row({}), row({ source: "manual", start_s: null, end_s: null })], "intro");
    expect(m).toEqual({ span: null, source: "manual", confidence: 1 });
  });
  it("keeps kinds apart", () => {
    expect(effectiveMarker([row({ kind: "credits" })], "intro")).toBeNull();
  });
});

describe("chapters", () => {
  const D = 1400;
  it("normalises mpv's start-only list", () => {
    expect(normaliseChapters([{ title: "B", time: 100 }, { title: "A", time: 0 }], D)).toEqual([
      { title: "A", start: 0, end: 100 },
      { title: "B", start: 100, end: D },
    ]);
  });
  it("finds named intros and credits", () => {
    const ch = normaliseChapters(
      [{ title: "Prologue", time: 0 }, { title: "Opening", time: 95 }, { title: "Part A", time: 185 }, { title: "Ending", time: 1310 }, { title: "Preview", time: 1380 }],
      D,
    );
    expect(classifyChapters(ch, D)).toEqual({ intro: { start: 95, end: 185 }, credits: { start: 1310, end: 1380 } });
  });
  it("accepts OP / ED / Main Titles / Intro and ignores generic names", () => {
    const mk = (t: string) => normaliseChapters([{ title: "x", time: 0 }, { title: t, time: 30 }, { title: "y", time: 120 }], D);
    expect(classifyChapters(mk("OP"), D).intro).not.toBeNull();
    expect(classifyChapters(mk("Main Titles"), D).intro).not.toBeNull();
    expect(classifyChapters(mk("Intro"), D).intro).not.toBeNull();
    expect(classifyChapters(mk("Chapter 02"), D).intro).toBeNull();
    expect(classifyChapters(mk("Opener scene"), D).intro).toBeNull();
  });
  it("rejects intros that are too long, too short or too late, and credits before halfway", () => {
    const long = normaliseChapters([{ title: "Intro", time: 0 }, { title: "x", time: 200 }], D);
    expect(classifyChapters(long, D).intro).toBeNull();
    const short = normaliseChapters([{ title: "Intro", time: 0 }, { title: "x", time: 10 }], D);
    expect(classifyChapters(short, D).intro).toBeNull();
    const late = normaliseChapters([{ title: "x", time: 0 }, { title: "Intro", time: 700 }, { title: "y", time: 760 }], D);
    expect(classifyChapters(late, D).intro).toBeNull();
    const early = normaliseChapters([{ title: "x", time: 0 }, { title: "Credits", time: 300 }, { title: "y", time: 400 }], D);
    expect(classifyChapters(early, D).credits).toBeNull();
  });
  it("credits run to the end of the file when last", () => {
    const ch = normaliseChapters([{ title: "Chapter 1", time: 0 }, { title: "Credits", time: 2885.95 }], 2926.92);
    expect(classifyChapters(ch, 2926.92).credits).toEqual({ start: 2885.95, end: 2926.92 });
  });
});

describe("analysis results", () => {
  it("regions: opening 30% up to 10 min, closing 20% up to 5 min", () => {
    expect(regionOf("intro", 1369)).toEqual({ start: 0, length: 1369 * 0.3 });
    expect(regionOf("intro", 2730)).toEqual({ start: 0, length: 600 });
    expect(regionOf("credits", 1000)).toEqual({ start: 800, length: 200 });
    expect(regionOf("credits", 2730)).toEqual({ start: 2430, length: 300 });
  });
  it("snaps edges to a chapter boundary within 3 s", () => {
    expect(snapToBoundaries({ start: 116.2, end: 162.4 }, [117.7, 690.5])).toEqual({ start: 117.7, end: 162.4 });
    expect(snapToBoundaries({ start: 110, end: 162 }, [117.7])).toEqual({ start: 110, end: 162 });
  });
  it("intro: region offset, snap, and the end pulled in", () => {
    expect(audioSpan("intro", { start: 116.2, end: 162.4 }, 1372, [117.7])).toEqual({ start: 117.7, end: 162.4 - END_MARGIN });
  });
  it("credits: moved into the file and rejected before halfway", () => {
    const d = 2730;
    expect(audioSpan("credits", { start: 250, end: 299 }, d, [])).toEqual({ start: 2680, end: 2729 });
    expect(audioSpan("credits", { start: 0, end: 40 }, 500, [])).toEqual({ start: 400, end: 440 });
    // A 100 s file's closing region starts at 80 s; a match at its start would be before halfway only if the region were longer.
    expect(audioSpan("credits", { start: 1, end: 20 }, 60, [])).toEqual({ start: 49, end: 60 });
  });
});

describe("intro fade", () => {
  const intro = { start: 69.29, end: 98.81 }; // Friends S10E4 as the audio match left it
  it("looks from 1 s before the raw end to 8 s after", () => {
    expect(fadeWindow(intro)).toEqual({ start: 98.31, length: 9 });
  });
  it("extends to where the picture comes back", () => {
    expect(withFade(intro, 106.15)).toEqual({ start: 69.29, end: 105.65 });
  });
  it("keeps the end when the fade is at it, missing, or too far", () => {
    expect(withFade(intro, 99.0)).toEqual(intro);
    expect(withFade(intro, null)).toEqual(intro);
    expect(withFade(intro, 120)).toEqual(intro);
  });
});

describe("player", () => {
  const intro = { start: 100, end: 146 };
  it("shows the button from the start until 5 s are left", () => {
    expect(skipVisible(99.9, intro)).toBe(false);
    expect(skipVisible(100, intro)).toBe(true);
    expect(skipVisible(140.9, intro)).toBe(true);
    expect(skipVisible(141, intro)).toBe(false);
    expect(skipVisible(120, null)).toBe(false);
  });
  it("auto-skips when playback runs into the intro", () => {
    expect(runsInto(99.8, 100.05, intro)).toBe(true);
  });
  it("does not auto-skip after a seek into it, or when resuming in the middle", () => {
    expect(runsInto(20, 110, intro)).toBe(false);
    expect(runsInto(null, 120, intro)).toBe(false);
    expect(runsInto(101, 101.3, intro)).toBe(false); // already inside: the one chance has passed
  });
  it("auto-skips a file that starts with its intro", () => {
    expect(runsInto(null, 0.4, { start: 0, end: 50 })).toBe(true);
  });
  it("validates hand-set intros", () => {
    expect(validManual(10, 60)).toBe(true);
    expect(validManual(10, 12)).toBe(false);
    expect(validManual(10, 400)).toBe(false);
    expect(validManual(null, 60)).toBe(false);
    expect(validManual(60, 10)).toBe(false);
  });
});

describe("credits plan", () => {
  const D = 2730;
  const fallback = D - 45;
  it("falls back to the old end-of-file guess", () => {
    expect(creditsPlan(null, [], D)).toEqual({ cardAt: fallback, countdownAt: fallback });
    expect(creditsPlan(null, [], 1369)).toEqual({ cardAt: 1369 - 1369 * 0.025, countdownAt: 1369 - 1369 * 0.025 });
  });
  it("uses a named credits chapter late in the file", () => {
    const ch = normaliseChapters([{ title: "Chapter 1", time: 0 }, { title: "End Credits", time: 2600 }], D);
    expect(creditsPlan(null, ch, D)).toEqual({ cardAt: 2600, countdownAt: 2600 });
  });
  it("detected credits that run to the end: card and countdown together", () => {
    expect(creditsPlan({ start: 2680, end: 2729 }, [], D)).toEqual({ cardAt: 2680, countdownAt: 2680 });
  });
  it("only the tail of the credits found: never later than the old guess", () => {
    expect(creditsPlan({ start: 2712, end: 2728 }, [], D)).toEqual({ cardAt: fallback, countdownAt: fallback });
  });
  it("something after the credits: the countdown waits for the old guess", () => {
    expect(creditsPlan({ start: 2500, end: 2560 }, [], D)).toEqual({ cardAt: 2500, countdownAt: fallback });
  });
});
