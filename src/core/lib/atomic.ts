import { constants, cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { UserError } from "../command.ts";

// ponytail: every file the app owns is written beside itself then renamed over (Xray Editor's write_text), so a
// crash or a full disk leaves the old file whole — and a failed rename takes its .tmp away with it
export function writeAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// ponytail: a file from this PC is copied beside its target then renamed over (a clone where the disk can) — never
// held in memory, so a video past 2 GiB is copied too, and never holding the process while it copies
export async function copyFileAtomic(from: string, to: string): Promise<void> {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.tmp`;
  try {
    await copyFile(from, tmp, constants.COPYFILE_FICLONE);
    renameSync(tmp, to);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// ponytail: a folder is copied beside its target then renamed over, so a half-done copy never looks like a context
// or a test's images (a failed copy takes its .tmp folder away)
export function copyDirAtomic(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    cpSync(from, tmp, { recursive: true });
    renameSync(tmp, to);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

export function fileMtime(path: string): number {
  return existsSync(path) ? Math.round(statSync(path).mtimeMs) : 0;
}

// ponytail: a save that names the version it was made from (ifMtime, as the read gave it) is refused when the file
// moved on disk since — an edit made outside the app (Claude, an editor) is never overwritten unseen
export function unchangedSince(path: string, ifMtime: number | undefined, what: string): void {
  if (ifMtime === undefined || fileMtime(path) === ifMtime) return;
  throw new UserError(
    `${what} changed on disk since it was read.`,
    "Read it again to see that change, then make yours on top of it.",
    "conflict",
  );
}
