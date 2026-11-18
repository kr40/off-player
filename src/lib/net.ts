// Online/offline state, shared by every page. TMDB calls report success or
// "unreachable"; the browser's own online/offline events count too.
import { useSyncExternalStore } from "react";

let online = typeof navigator === "undefined" ? true : navigator.onLine;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function markOnline(v: boolean) {
  if (online === v) return;
  online = v;
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => markOnline(true));
  window.addEventListener("offline", () => markOnline(false));
}

export const isOnline = () => online;

export function useOnline(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => online,
  );
}

/** Concurrency limiter with de-duplication of identical in-flight calls. */
export function makeQueue(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const inflight = new Map<string, Promise<unknown>>();
  async function slot() {
    if (active >= max) await new Promise<void>((r) => waiting.push(r));
    active++;
  }
  function release() {
    active--;
    waiting.shift()?.();
  }
  return {
    /** Run `fn` when a slot is free; a second call with the same key shares the first one's promise. */
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const hit = inflight.get(key);
      if (hit) return hit as Promise<T>;
      const p = (async () => {
        await slot();
        try {
          return await fn();
        } finally {
          release();
        }
      })();
      inflight.set(key, p);
      p.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      );
      return p;
    },
    get active() {
      return active;
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
