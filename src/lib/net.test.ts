import { describe, expect, it } from "vitest";
import { makeQueue, sleep } from "./net";

describe("request queue", () => {
  it("never runs more than the limit at once", async () => {
    const q = makeQueue(3);
    let now = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        q.run(`k${i}`, async () => {
          now++;
          peak = Math.max(peak, now);
          await sleep(5);
          now--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
  it("shares one call between identical requests", async () => {
    const q = makeQueue(2);
    let calls = 0;
    const fn = async () => {
      calls++;
      await sleep(5);
      return 42;
    };
    const r = await Promise.all([q.run("same", fn), q.run("same", fn), q.run("same", fn)]);
    expect(r).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
    await q.run("same", fn);
    expect(calls).toBe(2);
  });
  it("a failure frees the slot and the key", async () => {
    const q = makeQueue(1);
    await expect(q.run("x", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await q.run("x", async () => 1)).toBe(1);
  });
});
