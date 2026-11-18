import { titleFiles, type FileRow, type TitleRow } from "./db";
import { nextUp, sharedChecker } from "./present";
import { recentTitleIds } from "./progress";

export type ContinueItem = { t: TitleRow; f: FileRow; mode: "resume" | "next" | "start"; shared: boolean };

/** One entry per recently played title: the episode to resume, or the next one. Finished titles drop out. */
export async function continueWatching(titles: TitleRow[]): Promise<ContinueItem[]> {
  const byId = new Map(titles.map((t) => [t.id, t]));
  const out: ContinueItem[] = [];
  for (const id of await recentTitleIds()) {
    const t = byId.get(id);
    if (!t) continue;
    const files = await titleFiles(id);
    const up = nextUp(files);
    if (up) out.push({ t, f: up.file, mode: up.mode, shared: sharedChecker(files)(up.file) });
  }
  return out;
}
