import { describe, expect, it, vi } from "vitest";

// transfer.ts imports Tauri modules; the parsers under test don't touch them.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn() } }));

const { parseCsv, readImdbExport, reactionFor } = await import("./transfer");

describe("IMDb export import", () => {
  it("parses quoted CSV with commas, doubled quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });
  it("reads a ratings export", () => {
    const csv = "﻿Const,Your Rating,Date Rated,Title,URL\ntt0111161,10,2024-01-01,\"Shawshank Redemption, The\",x\ntt0903747,7,2024-01-02,Breaking Bad,x\nbad,5,,Nope,x\n";
    const r = readImdbExport(csv);
    expect(r.kind).toBe("ratings");
    expect(r.entries).toEqual([
      { tconst: "tt0111161", title: "Shawshank Redemption, The", rating: 10 },
      { tconst: "tt0903747", title: "Breaking Bad", rating: 7 },
    ]);
  });
  it("reads a watchlist export", () => {
    const r = readImdbExport("Position,Const,Created,Title\n1,tt1375666,2024-01-01,Inception\n");
    expect(r.kind).toBe("watchlist");
    expect(r.entries[0]).toEqual({ tconst: "tt1375666", title: "Inception", rating: null });
  });
  it("rejects files that aren't IMDb exports", () => {
    expect(() => readImdbExport("a,b\n1,2\n")).toThrow(/IMDb export/);
  });
  it("maps ratings to reactions", () => {
    expect([10, 8, 7, 6, 5, 1].map(reactionFor)).toEqual([2, 2, 1, 1, -1, -1]);
  });
});
