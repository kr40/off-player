import { describe, expect, it } from "vitest";
import { mapEpisodes, pickBest, similarity, type Candidate, type FileForMapping, type TmdbEpisode } from "./match";
import real from "./__fixtures__/tmdb-episodes.json";

type Show = { files: FileForMapping[]; tmdb: Record<string, TmdbEpisode[]> };
const mapShow = (show: Show) => {
  const seasons = new Map(Object.entries(show.tmdb).map(([s, eps]) => [Number(s), eps]));
  const m = mapEpisodes(show.files, seasons);
  const moved = show.files
    .filter((f) => m.get(f.id)!.episode !== f.episode)
    .map((f) => `${f.season}x${f.episode}→${m.get(f.id)!.episode}`);
  const missing = show.files.filter((f) => !seasons.get(f.season)?.some((e) => e.episode_number === m.get(f.id)!.episode));
  return { moved, missing };
};

describe("mapEpisodes on real TMDB data", () => {
  it("Friends: only TMDB's merged two-parters shift numbering", () => {
    const { moved, missing } = mapShow((real as Record<string, Show>)["Friends"]);
    expect(moved).toEqual([
      "4x24→23", // Ross's Wedding (2) → TMDB's single entry
      "5x24→23", // The One In Vegas (2)
      "6x16→15", // The One That Could Have Been (2)
      "6x17→16", "6x18→17", "6x19→18", "6x20→19", "6x21→20", "6x22→21", "6x23→22", // shifted by the merge
      "6x24→23", "6x25→23", // The Proposal (1) and (2)
      "7x24→23", // Chandler and Monica's Wedding (2)
      "8x24→23", // Rachel Has a Baby (2)
    ]);
    expect(missing).toEqual([]);
  });

  it("Star Trek: TNG and Snowfall keep their numbering", () => {
    for (const name of ["Star Trek: The Next Generation", "Snowfall"]) {
      const { moved, missing } = mapShow((real as Record<string, Show>)[name]);
      expect([name, moved, missing.length]).toEqual([name, [], 0]);
    }
  });
});

describe("similarity", () => {
  it("treats punctuation and case as equal", () => {
    expect(similarity("Star Trek - The Next Generation", "Star Trek: The Next Generation")).toBe(1);
    expect(similarity("We’ll Always Have Paris", "We'll Always Have Paris")).toBe(1);
  });
  it("matches part numbers written differently", () => {
    expect(similarity("Descent-Part 2", "Descent (2)")).toBeGreaterThanOrEqual(0.9);
    expect(similarity("Descent, Part II", "Descent (2)")).toBeGreaterThanOrEqual(0.9);
  });
  it("scores unrelated titles low", () => {
    expect(similarity("The Naked Now", "Code of Honor")).toBeLessThan(0.3);
  });
});

describe("pickBest", () => {
  const tv = (id: number, name: string, date: string, votes: number): Candidate => ({
    id, name, first_air_date: date, vote_count: votes,
  });

  it("picks the exact name and is confident", () => {
    const r = pickBest(
      [
        tv(1, "Star Trek", "1966-09-08", 1500),
        tv(655, "Star Trek: The Next Generation", "1987-09-28", 1800),
        tv(3, "Star Trek: Deep Space Nine", "1993-01-03", 1000),
      ],
      "Star Trek - The Next Generation",
      null,
    );
    expect(r?.candidate.id).toBe(655);
    expect(r?.confidence).toBeGreaterThan(0.9);
  });

  it("uses the year to separate same-named shows", () => {
    const results = [tv(10, "Friends", "1994-09-22", 9000), tv(11, "Friends", "2009-01-01", 3)];
    expect(pickBest(results, "Friends", 1994)?.candidate.id).toBe(10);
    expect(pickBest(results, "Friends", 2009)?.candidate.id).toBe(11);
  });

  it("prefers the well-known show when there is no year", () => {
    const r = pickBest([tv(20, "Snowfall", "2004-01-01", 2), tv(21, "Snowfall", "2017-07-05", 900)], "Snowfall", null);
    expect(r?.candidate.id).toBe(21);
  });

  it("returns null when nothing is close", () => {
    expect(pickBest([tv(1, "Completely Different", "2000-01-01", 10)], "Snowfall", null)).toBeNull();
  });
});

describe("mapEpisodes", () => {
  const seasons = (eps: string[]) => new Map([[1, eps.map((name, i) => ({ episode_number: i + 1, name }))]]);

  it("keeps numbers when titles agree", () => {
    const m = mapEpisodes(
      [
        { id: 1, season: 1, episode: 1, title: "Encounter at Farpoint" },
        { id: 2, season: 1, episode: 2, title: "The Naked Now" },
      ],
      seasons(["Encounter at Farpoint", "The Naked Now"]),
    );
    expect([...m.values()].map((v) => v.episode)).toEqual([1, 2]);
  });

  it("follows titles when TMDB splits a feature-length pilot", () => {
    const m = mapEpisodes(
      [
        { id: 1, season: 1, episode: 1, title: "Encounter at Farpoint" },
        { id: 2, season: 1, episode: 2, title: "The Naked Now" },
        { id: 3, season: 1, episode: 3, title: "Code of Honor" },
      ],
      seasons(["Encounter at Farpoint (1)", "Encounter at Farpoint (2)", "The Naked Now", "Code of Honor"]),
    );
    expect([...m.values()].map((v) => v.episode)).toEqual([1, 3, 4]);
  });

  it("trusts numbers when the file has no title", () => {
    const m = mapEpisodes([{ id: 1, season: 1, episode: 2, title: null }], seasons(["A", "B"]));
    expect(m.get(1)).toEqual({ season: 1, episode: 2 });
  });
});
