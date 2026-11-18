import { describe, expect, it } from "vitest";
import { classify, pickAudio, pickSub } from "./progress";
import { nextUp } from "./present";
import type { FileRow } from "./db";

const ep = (id: number, season: number, episode: number, pb: Partial<FileRow> = {}): FileRow =>
  ({
    id, season, episode, role: "episode", rel: `s${season}e${episode}.mkv`, duration: 2700,
    pb_position: null, pb_watched: null, pb_last: null, ...pb,
  }) as FileRow;

describe("classify", () => {
  it("ignores accidental starts and marks the end watched", () => {
    expect(classify(30, 2700)).toBe("ignored"); // 1%
    expect(classify(600, 2700)).toBe("progress");
    expect(classify(2500, 2700)).toBe("watched"); // 92.6%
    expect(classify(100, 0)).toBe("ignored");
  });
});

describe("nextUp", () => {
  it("starts at S1E1 when nothing is played, skipping specials", () => {
    expect(nextUp([ep(1, 0, 1), ep(2, 1, 1), ep(3, 1, 2)])).toMatchObject({ file: { id: 2 }, mode: "start" });
  });

  it("resumes an unfinished episode", () => {
    const r = nextUp([ep(1, 1, 1, { pb_watched: 1, pb_last: 10 }), ep(2, 1, 2, { pb_position: 600, pb_last: 20 }), ep(3, 1, 3)]);
    expect(r).toMatchObject({ file: { id: 2 }, mode: "resume" });
  });

  it("moves to the next unwatched episode after a finished one, across seasons", () => {
    const r = nextUp([ep(1, 1, 1, { pb_watched: 1, pb_last: 10 }), ep(2, 1, 2, { pb_watched: 1, pb_last: 20 }), ep(3, 2, 1)]);
    expect(r).toMatchObject({ file: { id: 3 }, mode: "next" });
  });

  it("skips episodes already marked watched", () => {
    const r = nextUp([ep(1, 1, 1, { pb_watched: 1, pb_last: 10 }), ep(2, 1, 2, { pb_watched: 1 }), ep(3, 1, 3)]);
    expect(r).toMatchObject({ file: { id: 3 }, mode: "next" });
  });

  it("uses the most recently played, not the furthest", () => {
    const r = nextUp([ep(1, 1, 1, { pb_position: 300, pb_last: 50 }), ep(5, 1, 5, { pb_position: 900, pb_last: 10 })]);
    expect(r).toMatchObject({ file: { id: 1 }, mode: "resume" });
  });

  it("is done when the last episode is watched", () => {
    expect(nextUp([ep(1, 1, 1, { pb_watched: 1, pb_last: 10 }), ep(2, 1, 2, { pb_watched: 1, pb_last: 20 })])).toBeUndefined();
  });
});

describe("track preferences", () => {
  const tracks = [
    { id: 1, type: "sub", lang: "eng", title: "English", external: false },
    { id: 2, type: "sub", lang: "eng", title: "English SDH", external: false },
    { id: 3, type: "sub", lang: "spa", title: "Spanish", external: false },
    { id: 4, type: "sub", external: true, title: "External" },
    { id: 1, type: "audio", lang: "eng", title: "Stereo" },
    { id: 2, type: "audio", lang: "jpn", title: "Original" },
  ];
  it("matches language, source and title, then looser", () => {
    expect(pickSub(tracks, { mode: "on", lang: "en", external: false, title: "English SDH" })).toBe(2);
    expect(pickSub(tracks, { mode: "on", lang: "en", external: false, title: "Forced" })).toBe(1);
    expect(pickSub(tracks, { mode: "on", lang: null, external: true, title: "External" })).toBe(4);
    expect(pickSub(tracks, { mode: "off" })).toBe("no");
    expect(pickSub(tracks, { mode: "on", lang: "fr", external: false, title: null })).toBeNull();
  });
  it("picks audio by language, comparing 2- and 3-letter codes", () => {
    expect(pickAudio(tracks, { lang: "ja", title: null })).toBe(2);
    expect(pickAudio(tracks, { lang: "jpn", title: "Original" })).toBe(2);
    expect(pickSub(tracks, { mode: "on", lang: "es", external: false, title: null })).toBe(3);
  });
});
