import { existsSync, type FSWatcher, watch } from "node:fs";
import { resolve } from "node:path";
import { debounce } from "../shared/run/work.ts";
import { filesChanged } from "./jobs.ts";
import { skipped } from "./lib/changed.ts";

const watchers = new Map<string, FSWatcher>();

// ponytail: one recursive watcher per project a page has used; a burst of writes (a save, a Claude run, a sync) becomes
// one `changed` event 200 ms after the last of them, naming every path (relative, `/`)
export function watchProject(project: string, settleMs = 200): void {
  const dir = resolve(project);
  if (watchers.has(dir)) return;
  const batch = debounce<string>(settleMs, (paths) => filesChanged(dir, [...new Set(paths)].sort()));
  let w: FSWatcher;
  try {
    w = watch(dir, { recursive: true, persistent: false }, (kind, name) => {
      if (!name) return;
      // ponytail: on Windows a watched folder that is deleted makes Node fire « rename <its own path> » without end
      // and never an error — hundreds of thousands a second, each held by the batch that never settles, until the
      // heap is full; the watch stops there, and the next request on the folder, once it is back, watches it again
      if (kind === "rename" && !existsSync(dir)) {
        batch.cancel();
        if (watchers.get(dir) === w) unwatchProject(dir);
        else w.close();
        return;
      }
      const rel = String(name).replaceAll("\\", "/");
      if (!skipped(rel)) batch.push(rel);
    });
  } catch {
    return;
  }
  w.on("error", () => unwatchProject(dir));
  watchers.set(dir, w);
}

export function unwatchProject(project: string): void {
  const dir = resolve(project);
  watchers.get(dir)?.close();
  watchers.delete(dir);
}

export function unwatchAll(): void {
  for (const dir of [...watchers.keys()]) unwatchProject(dir);
}
