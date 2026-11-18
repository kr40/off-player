import { describe, expect, it } from "vitest";
import sample from "./__fixtures__/sample-library.json";
import {
  cleanName,
  parseEpisode,
  planLibrary,
  seasonFromName,
  subLang,
  type Entry,
  type PlannedTitle,
} from "./parse";

const entries = sample as Entry[];
const episodes = (t: PlannedTitle) => t.files.filter((f) => f.role === "episode");
const seasonCounts = (t: PlannedTitle) => {
  const c: Record<number, number> = {};
  for (const f of episodes(t)) c[f.season!] = (c[f.season!] ?? 0) + 1;
  return c;
};

describe("a media folder as one library", () => {
  const plan = planLibrary("Media", entries);
  const byName = Object.fromEntries(plan.titles.map((t) => [t.name, t]));

  it("finds exactly the three shows", () => {
    expect(plan.titles.map((t) => [t.name, t.year, t.kind])).toEqual([
      ["Friends", 1994, "show"],
      ["Snowfall", null, "show"],
      ["Star Trek - The Next Generation", null, "show"],
    ]);
  });

  it("parses all 176 TNG episodes into seasons 1–7 with no warnings", () => {
    const tng = byName["Star Trek - The Next Generation"];
    expect(episodes(tng)).toHaveLength(176);
    expect(seasonCounts(tng)).toEqual({ 1: 25, 2: 22, 3: 26, 4: 26, 5: 26, 6: 26, 7: 25 });
    expect(tng.warnings).toEqual([]);
  });

  it("reads TNG episode titles from the file names", () => {
    const tng = byName["Star Trek - The Next Generation"];
    const t = (s: number, e: number) =>
      episodes(tng).find((f) => f.season === s && f.episode === e)?.episodeTitle;
    expect(t(1, 1)).toBe("Encounter at Farpoint");
    expect(t(1, 14)).toBe("11001001");
    expect(t(1, 23)).toBe("We’ll Always Have Paris");
    expect(t(7, 25)).toBe("All Good Things");
    expect(episodes(tng).every((f) => f.episodeTitle)).toBe(true);
  });

  it("pairs every TNG .srt with its episode despite name differences", () => {
    const tng = byName["Star Trek - The Next Generation"];
    expect(episodes(tng).every((f) => f.subs.length === 1)).toBe(true);
    const pilot = episodes(tng)[0];
    expect(pilot.subs[0].entry.rel).toMatch(/Encounter\.At\.Farpoint\.srt$/);
  });

  it("merges Snowfall's six season folders into one show", () => {
    const sf = byName["Snowfall"];
    expect(sf.folders).toHaveLength(6);
    expect(seasonCounts(sf)).toEqual({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 });
    expect(sf.warnings).toEqual([]);
    expect(episodes(sf).every((f) => f.episodeTitle === null)).toBe(true);
  });

  it("separates Friends episodes from its 50 featurettes and reads double episodes", () => {
    const fr = byName["Friends"];
    expect(fr.files.filter((f) => f.role === "extra")).toHaveLength(50);
    expect(episodes(fr)).toHaveLength(234);
    expect(Object.keys(seasonCounts(fr))).toHaveLength(10);
    expect(fr.warnings).toEqual([]);
    const last = episodes(fr).find((f) => f.season === 10 && f.episode === 17)!;
    expect(last.episodeEnd).toBe(18);
    expect(last.episodeTitle).toBe("The Last One");
    const gag = fr.files.find((f) => f.entry.rel.endsWith("Season 6/Gag Reel_new.mkv"))!;
    expect(gag.extraGroup).toBe("Season 6");
    expect(gag.episodeTitle).toBe("Gag Reel");
  });
});

describe("a single show added as its own library", () => {
  it("TNG folder as root becomes one title named after the root", () => {
    const prefix = "Star Trek - The Next Generation/";
    const own = entries
      .filter((e) => e.rel.startsWith(prefix))
      .map((e) => ({ ...e, rel: e.rel.slice(prefix.length) }));
    const plan = planLibrary("Star Trek - The Next Generation", own);
    expect(plan.titles).toHaveLength(1);
    expect(plan.titles[0].name).toBe("Star Trek - The Next Generation");
    expect(episodes(plan.titles[0])).toHaveLength(176);
  });

  it("a Snowfall season folder as root keeps the show name", () => {
    const prefix = "Snowfall.S03.COMPLETE.720p.AMZN.WEBRip.x264-GROUP[TAG]/";
    const own = entries
      .filter((e) => e.rel.startsWith(prefix))
      .map((e) => ({ ...e, rel: e.rel.slice(prefix.length) }));
    const plan = planLibrary(prefix.slice(0, -1), own);
    expect(plan.titles.map((t) => t.name)).toEqual(["Snowfall"]);
    expect(seasonCounts(plan.titles[0])).toEqual({ 3: 10 });
  });
});

describe("other naming styles", () => {
  const v = (rel: string, size = 1e9): Entry => ({ rel, size, kind: "video" });

  it("handles a mixed movies folder", () => {
    const plan = planLibrary("Movies", [
      v("Blade.Runner.2049.2017.1080p.BluRay.x264-SPARKS.mkv"),
      v("The Matrix (1999)/The.Matrix.1999.2160p.UHD.BluRay.x265.mkv"),
      v("The Matrix (1999)/Featurettes/Making Of.mkv", 2e8),
      v("Heat (1995)/Heat.CD1.avi", 7e8),
      v("Heat (1995)/Heat.CD2.avi", 7e8),
      v("2012 (2009)/2012.2009.720p.mkv"),
      v("Old Films/Casablanca.1942.mkv"),
      v("Old Films/Nosferatu.1922.mkv"),
      v("Blade.Runner.2049.2017.1080p.BluRay.x264-SPARKS/sample.mkv", 5e7),
    ]);
    const names = plan.titles.map((t) => `${t.name} (${t.year}) ${t.kind} ${t.files.length}`);
    expect(names).toEqual([
      "2012 (2009) movie 1",
      "Blade Runner 2049 (2017) movie 1",
      "Casablanca (1942) movie 1",
      "Heat (1995) movie 2",
      "Nosferatu (1922) movie 1",
      "The Matrix (1999) movie 2",
    ]);
    expect(plan.skipped).toHaveLength(1);
  });

  it("handles shows nested in a container folder with bare season folders", () => {
    const plan = planLibrary("Media", [
      v("TV/The Wire/Season 1/01 - The Target.mkv"),
      v("TV/The Wire/Season 1/02 - The Detail.mkv"),
      v("TV/The Wire/Specials/Episode 1.mkv"),
      v("TV/Mr. Robot (2015)/Mr.Robot.1x01.eps1.0_hellofriend.mov.720p.mkv"),
      v("Show.Name.S02E05.Some.Title.1080p.WEB-DL.mkv"),
      v("Show.Name.S02E06.Other.Title.1080p.WEB-DL.mkv"),
    ]);
    const wire = plan.titles.find((t) => t.name === "The Wire")!;
    expect(episodes(wire).map((f) => [f.season, f.episode, f.episodeTitle])).toEqual([
      [0, 1, null],
      [1, 1, "The Target"],
      [1, 2, "The Detail"],
    ]);
    const robot = plan.titles.find((t) => t.name === "Mr. Robot")!;
    expect([robot.year, episodes(robot)[0].season, episodes(robot)[0].episode]).toEqual([2015, 1, 1]);
    const loose = plan.titles.find((t) => t.name === "Show Name")!;
    expect(episodes(loose).map((f) => f.episodeTitle)).toEqual(["Some Title", "Other Title"]);
  });

  it("flags files with no episode number and duplicate episodes", () => {
    const plan = planLibrary("Lib", [
      v("Show/Season 1/Show.S01E01.mkv"),
      v("Show/Season 1/Show.S01E01.PROPER.mkv"),
      v("Show/Season 1/random clip.mkv"),
    ]);
    expect(plan.titles[0].warnings).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("cleanName", () => {
    expect(cleanName("Friends (1994) Season 1-10 S01-S10 (1080p BluRay x265 HEVC 10bit AAC 5.1 NOGRP)")).toEqual({ name: "Friends", year: 1994 });
    expect(cleanName("Snowfall.S01.COMPLETE.720p.AMZN.WEBRip.x264-GROUP[TAG]")).toEqual({ name: "Snowfall", year: null });
    expect(cleanName("Star Trek TNG - Season 1")).toEqual({ name: "Star Trek TNG", year: null });
    expect(cleanName("The Office (US)")).toEqual({ name: "The Office (US)", year: null });
  });

  it("cleanName: year in front, pixel sizes", () => {
    expect(cleanName("1998.Rush.Hour.1920x784.BDRip.x264.DTS-HD.MA")).toEqual({ name: "Rush Hour", year: 1998 });
    expect(cleanName("2001.Rush.Hour.2.1920x800.BDRip.x264.DTS-HD.MA")).toEqual({ name: "Rush Hour 2", year: 2001 });
    expect(cleanName("2007.Rush.Hour.3.1920x800.BDRip.x264.DTS-HD.MA")).toEqual({ name: "Rush Hour 3", year: 2007 });
    expect(cleanName("1998 - Rush Hour")).toEqual({ name: "Rush Hour", year: 1998 });
    expect(cleanName("Heat.1995.1280x544.BluRay")).toEqual({ name: "Heat", year: 1995 });
    // A year that is the title stays the title.
    expect(cleanName("1917 (2019)")).toEqual({ name: "1917", year: 2019 });
    expect(cleanName("2012")).toEqual({ name: "2012", year: null });
    expect(cleanName("2001 A Space Odyssey")).toEqual({ name: "2001 A Space Odyssey", year: null });
    expect(cleanName("2001.A.Space.Odyssey.1968.1080p.BluRay")).toEqual({ name: "2001 A Space Odyssey", year: 1968 });
    expect(cleanName("1917.1080p.BluRay")).toEqual({ name: "1917", year: null });
  });

  it("plans a trilogy folder as three movies", () => {
    const v = (rel: string, size = 1e10): Entry => ({ rel, size, kind: "video" });
    const plan = planLibrary("Media", [
      v("Rush Hour Trilogy (1998-2007)/1998.Rush.Hour.1920x784.BDRip.x264.DTS-HD.MA.mkv"),
      v("Rush Hour Trilogy (1998-2007)/2001.Rush.Hour.2.1920x800.BDRip.x264.DTS-HD.MA.mkv"),
      v("Rush Hour Trilogy (1998-2007)/2007.Rush.Hour.3.1920x800.BDRip.x264.DTS-HD.MA.mkv"),
    ]);
    expect(plan.titles.map((t) => [t.kind, t.name, t.year]).sort((a, b) => Number(a[2]) - Number(b[2]))).toEqual([
      ["movie", "Rush Hour", 1998],
      ["movie", "Rush Hour 2", 2001],
      ["movie", "Rush Hour 3", 2007],
    ]);
  });

  it("seasonFromName", () => {
    expect(seasonFromName("Season 3")).toBe(3);
    expect(seasonFromName("Star Trek TNG - Season 7")).toBe(7);
    expect(seasonFromName("Snowfall.S04.COMPLETE.720p")).toBe(4);
    expect(seasonFromName("Specials")).toBe(0);
    expect(seasonFromName("Friends (1994) Season 1-10 S01-S10")).toBeNull();
    expect(seasonFromName("Star Trek - The Next Generation")).toBeNull();
  });

  it("parseEpisode ignores resolutions and fake ranges", () => {
    expect(parseEpisode("Show.S01E01-720p", null)?.episodeEnd).toBeNull();
    expect(parseEpisode("Video.1920x1080.mkv", null)).toBeNull();
    expect(parseEpisode("show.s03e15e16.title", null)).toMatchObject({ season: 3, episode: 15, episodeEnd: 16, title: "title" });
  });

  it("subLang", () => {
    expect(subLang("Movie.2019.en")).toBe("en");
    expect(subLang("2_English")).toBe("en");
    expect(subLang("StarTrek.TNG-s01e01.Encounter.At.Farpoint")).toBeNull();
  });
});
