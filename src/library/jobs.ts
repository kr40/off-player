// Background work (scans, TMDB matching, thumbnails) runs one job at a time
// through this queue. Any page can show progress with useJobs().
import { useSyncExternalStore } from "react";
import { libraryChanged } from "./store";

export type Progress = { label: string; done: number; total: number; current?: string };
/**
 * `progress` is the queued job (scans, metadata…); pages disable their own
 * buttons while it runs. `background` is quiet long-running work (finding
 * intros) that never blocks anything and pauses itself while a job runs.
 */
type State = { progress: Progress | null; background: Progress | null; message: string | null; error: string | null };

let state: State = { progress: null, background: null, message: null, error: null };
let pending = 0;

/** True while a queued job is running or waiting. */
export const jobBusy = () => pending > 0;
export const setBackground = (p: Progress | null) => set({ background: p });
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};

export function useJobs(): State {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

let chain: Promise<unknown> = Promise.resolve();

/** Queue a job. It reports progress through `report` and may return a summary message. */
export function runJob(job: (report: (p: Progress) => void) => Promise<string | null | void>): Promise<void> {
  pending++;
  const next = chain.then(async () => {
    set({ progress: { label: "Working", done: 0, total: 0 }, error: null });
    try {
      const msg = await job((p) => set({ progress: p }));
      if (msg) set({ message: msg });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      pending--;
      set({ progress: null });
      libraryChanged();
    }
  });
  chain = next.catch(() => {});
  return next;
}
