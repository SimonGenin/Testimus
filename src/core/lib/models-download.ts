import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { dirname, join, parse, win32 } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UserError } from "../command.ts";
import type { CatalogEntry, HfFile } from "../types.ts";
import { gb } from "./fit/verdict.ts";
import { modelDir, onnxFile } from "./models-store.ts";

export type DownloadDeps = {
  fetch(url: string, init: RequestInit): Promise<Response>;
  freeMB(dir: string): number | null;
};

// ponytail: a drive-letter path climbs as a Windows path on any system, so a drive that is not there gives null
// instead of the free space of the current folder (a Windows path read on a Mac is relative to it)
export function freeMB(dir: string): number | null {
  const climb = /^[a-z]:[\\/]/i.test(dir) ? win32.dirname : dirname;
  let d = dir;
  while (!existsSync(d)) {
    const up = climb(d);
    if (up === d) return null;
    d = up;
  }
  try {
    const s = statfsSync(d);
    return Math.floor((s.bavail * s.bsize) / (1024 * 1024));
  } catch {
    return null;
  }
}

// ponytail: a seam env does not have — Hugging Face's fetch (with Range and a stream) and the free space; --mock
// serves fake bytes through it and the tests play a cut connection or a full drive
export const downloadDeps: DownloadDeps = {
  fetch: (url, init) => fetch(url, init),
  freeMB,
};

export function hfUrl(repo: string, revision: string, path: string): string {
  return `https://huggingface.co/${repo}/resolve/${revision}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function filesFor(entry: CatalogEntry, dtype?: string): HfFile[] {
  const hf = entry.source.hf;
  if (!hf) return [];
  if (hf.path && entry.source.file) return [{ path: hf.path, ...entry.source.file }];
  const files = hf.files ?? [];
  const want = onnxFile(dtype);
  const onnx = files.filter((f) => f.path.startsWith("onnx/"));
  const match = want ? onnx.filter((f) => f.path.startsWith(`onnx/${want}`)) : [];
  if (!match.length) return files;
  return files.filter((f) => !f.path.startsWith("onnx/") || match.includes(f));
}

export function installPath(dir: string, entry: CatalogEntry): string {
  const hf = entry.source.hf;
  if (!hf) throw new UserError(`${entry.label} has no Hugging Face source.`);
  const root = modelDir(dir, hf.repo);
  return hf.path && entry.source.file ? join(root, ...hf.path.split("/")) : root;
}

export function filesPresent(root: string, files: HfFile[]): boolean {
  return files.every((f) => {
    const p = join(root, ...f.path.split("/"));
    return existsSync(p) && statSync(p).size === f.size;
  });
}

export async function hashFile(path: string): Promise<{ sha256: string; git: string }> {
  const size = statSync(path).size;
  const sha256 = createHash("sha256");
  const sha1 = createHash("sha1").update(`blob ${size}\0`);
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    sha256.update(chunk as Buffer);
    sha1.update(chunk as Buffer);
  }
  return { sha256: sha256.digest("hex"), git: `git:${sha1.digest("hex")}` };
}

export function matches(expected: string, got: { sha256: string; git: string }): boolean {
  return expected.startsWith("git:") ? expected === got.git : expected.toLowerCase() === got.sha256;
}

export async function checkFile(path: string, f: HfFile): Promise<boolean> {
  if (!existsSync(path) || statSync(path).size !== f.size) return false;
  return matches(f.sha256, await hashFile(path));
}

function cancelled(): UserError {
  return new UserError("Download cancelled.", "Run it again: it resumes where it stopped.");
}

export async function downloadFile(
  url: string,
  dest: string,
  f: HfFile,
  opts: { signal: AbortSignal; onBytes(n: number): void },
  deps: DownloadDeps = downloadDeps,
): Promise<"downloaded" | "present"> {
  if (existsSync(dest) && (await checkFile(dest, f))) {
    opts.onBytes(f.size);
    return "present";
  }
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let start = existsSync(part) ? statSync(part).size : 0;
  if (start > f.size) {
    rmSync(part, { force: true });
    start = 0;
  }
  if (start < f.size) {
    if (opts.signal.aborted) throw cancelled();
    let res: Response;
    try {
      res = await deps.fetch(url, {
        headers: start ? { Range: `bytes=${start}-` } : {},
        signal: opts.signal,
        redirect: "follow",
      });
    } catch (e) {
      if (opts.signal.aborted) throw cancelled();
      throw new UserError(`Download of ${f.path} failed: ${(e as Error).message}`, "Check the network or the proxy.");
    }
    if (res.status === 200) start = 0;
    else if (res.status !== 206)
      throw new UserError(`Download of ${f.path} failed: HTTP ${res.status}.`, "Check the network or the proxy.");
    if (!res.body) throw new UserError(`Download of ${f.path} returned no data.`, "Check the network or the proxy.");
    opts.onBytes(start);
    const count = new Transform({
      transform(chunk: Buffer, _enc, done) {
        opts.onBytes(chunk.length);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(res.body as never),
        count,
        createWriteStream(part, { flags: start ? "a" : "w" }),
        { signal: opts.signal },
      );
    } catch (e) {
      if (opts.signal.aborted) throw cancelled();
      throw new UserError(`Download of ${f.path} stopped: ${(e as Error).message}`, "Run it again: it resumes.");
    }
  } else opts.onBytes(f.size);
  const size = statSync(part).size;
  const got = size === f.size ? await hashFile(part) : null;
  if (!got || !matches(f.sha256, got)) {
    rmSync(part, { force: true });
    throw new UserError(
      `${f.path} does not match its published checksum (${got ? (f.sha256.startsWith("git:") ? got.git : got.sha256) : `${size} bytes instead of ${f.size}`}); the file was deleted.`,
      "Run the download again; if it fails again, the network may alter downloads (proxy).",
    );
  }
  renameSync(part, dest);
  return "downloaded";
}

export function checkSpace(dir: string, bytes: number, deps: DownloadDeps = downloadDeps): void {
  const free = deps.freeMB(dir);
  const needMB = (bytes / (1024 * 1024)) * 1.2;
  if (free !== null && free < needMB)
    throw new UserError(
      `Not enough space on ${parse(dir).root || dir}: ${gb(free)} free, ${gb(needMB)} needed (1.2 × ${gb(bytes / (1024 * 1024))}).`,
      "Free some space, or choose another models folder: testimus models setDir <folder> --move.",
    );
}

export type PullFilesResult = { path: string; downloaded: number; present: number; bytes: number };

export async function pullFiles(
  entry: CatalogEntry,
  dir: string,
  opts: { dtype?: string; signal: AbortSignal; onProgress(done: number, total: number, file: string): void },
  deps: DownloadDeps = downloadDeps,
): Promise<PullFilesResult> {
  const hf = entry.source.hf;
  if (!hf) throw new UserError(`${entry.label} has no Hugging Face source.`);
  const files = filesFor(entry, opts.dtype);
  const root = modelDir(dir, hf.repo);
  const target = (f: HfFile) => join(root, ...f.path.split("/"));
  const total = files.reduce((a, f) => a + f.size, 0);
  const left = files.reduce((a, f) => {
    const t = target(f);
    if (existsSync(t) && statSync(t).size === f.size) return a;
    const part = `${t}.part`;
    return a + f.size - (existsSync(part) ? Math.min(statSync(part).size, f.size) : 0);
  }, 0);
  checkSpace(dir, left, deps);
  let before = 0;
  let downloaded = 0;
  let present = 0;
  for (const f of files) {
    let mine = 0;
    const r = await downloadFile(
      hfUrl(hf.repo, hf.revision, f.path),
      target(f),
      f,
      {
        signal: opts.signal,
        onBytes: (n) => {
          mine += n;
          opts.onProgress(before + Math.min(mine, f.size), total, f.path);
        },
      },
      deps,
    );
    if (r === "downloaded") downloaded++;
    else present++;
    before += f.size;
  }
  return { path: installPath(dir, entry), downloaded, present, bytes: total };
}
