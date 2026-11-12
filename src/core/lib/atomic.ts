import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cp } from "node:fs/promises";
import { dirname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UserError } from "../command.ts";
import { sha256File } from "./hash.ts";

const CHUNK = 4 * 1024 * 1024;

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

export type CopyOptions = {
  signal?: AbortSignal;
  onBytes?: (n: number) => void;
  verify?: boolean;
};

// ponytail: a file from this PC streams beside its target then is renamed over — never held in memory (a video passes
// 2 GiB), never holding the process, stopped by its job's signal between two chunks (a cancelled copy takes its .tmp
// away), and hashed as it passes: the SHA-256 it answers is of the bytes read, so nothing reads the file twice. verify
// reads the copy back and refuses one that differs (the models moved between drives)
export async function copyFileAtomic(from: string, to: string, o: CopyOptions = {}): Promise<string> {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.tmp`;
  const hash = createHash("sha256");
  try {
    await pipeline(
      createReadStream(from, { highWaterMark: CHUNK }),
      new Transform({
        transform(chunk: Buffer, _e, done) {
          hash.update(chunk);
          o.onBytes?.(chunk.length);
          done(null, chunk);
        },
      }),
      createWriteStream(tmp),
      { signal: o.signal },
    );
    const sum = hash.digest("hex");
    if (o.verify && (await sha256File(tmp, o.signal)) !== sum)
      throw new UserError(`The copy of ${from} differs from the original (SHA-256): nothing was changed.`, "Retry.");
    renameSync(tmp, to);
    return sum;
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// ponytail: a copy says how far it is once per hundredth of the file, never once per chunk
export function byteSteps(total: number, report: (done: number) => void): (n: number) => void {
  let done = 0;
  let said = -1;
  return (n) => {
    done += n;
    const step = total ? Math.floor((done * 100) / total) : 100;
    if (step === said) return;
    said = step;
    report(done);
  };
}

const UNITS: [number, string][] = [
  [1024 ** 3, "GB"],
  [1024 ** 2, "MB"],
  [1024, "KB"],
];

export function copyingLine(name: string, done: number, total: number): string {
  const [size, unit] = UNITS.find(([u]) => total >= u) ?? UNITS[2];
  const at = (b: number) => (b / size).toFixed(size === 1024 ** 3 ? 1 : 0);
  return `Copying ${name} — ${at(done)} / ${at(total)} ${unit}`;
}

// ponytail: a folder is copied beside its target then renamed over, so a half-done copy never looks like a context
// or a test's images (a failed copy takes its .tmp folder away)
export async function copyDirAtomic(from: string, to: string): Promise<void> {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    await cp(from, tmp, { recursive: true });
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
