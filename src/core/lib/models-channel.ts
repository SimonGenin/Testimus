import { createReadStream, createWriteStream, renameSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { timeout } from "../../shared/run/work.ts";
import { UserError } from "../command.ts";
import { sha256File } from "../rag/runtimes/llamacpp.ts";
import { readSettings } from "./project.ts";
import { sourceOf, updater } from "./updates.ts";

export type Pinned = { sha256: string; size: number; name: string };
const CHANNEL_MS = 15_000;

// ponytail: GitHub may take a build's binaries away one day (the tagged versions already have none), so the team keeps
// a copy of each pinned file on its update channel (Settings › Updates), under runtimes/<file name>. It is taken from
// there first and held against the same SHA-256 as a download; a channel that does not answer, does not hold the file
// or holds another one leaves it to the network. A machine-local file like any download: written to a .part beside
// its place, renamed once it is the pinned one
export async function fromChannel(
  file: string,
  want: Pinned,
  onBytes: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<boolean> {
  const channel = sourceOf(readSettings(), updater.installation()).path;
  if (!channel) return false;
  const kept = join(channel, "runtimes", want.name);
  const part = `${file}.part`;
  try {
    if ((await timeout(CHANNEL_MS, () => stat(kept), signal)).size !== want.size) return false;
    let loaded = 0;
    const from = createReadStream(kept);
    from.on("data", (c) => {
      loaded += c.length;
      onBytes(loaded, want.size);
    });
    await pipeline(from, createWriteStream(part), { signal });
    if ((await sha256File(part)) !== want.sha256) throw new Error("not the pinned file");
    renameSync(part, file);
    return true;
  } catch {
    rmSync(part, { force: true });
    if (signal.aborted) throw new UserError("Download of the transcription engine cancelled.");
    return false;
  }
}
