import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UserError } from "../command.ts";
import { listJobs } from "../jobs.ts";
import type { ModelsRegistry } from "../types.ts";
import { downloadDeps } from "./models-download.ts";
import { gb } from "./models-fit.ts";
import { readRegistry, runtimesDir, writeRegistry } from "./models-registry.ts";
import { isProject, readSettings } from "./project.ts";

const MB = 1024 * 1024;

export type SetDirInput = {
  dir: string;
  runtimes: boolean;
  move: boolean;
  keep: boolean;
  copy: boolean;
  dryRun: boolean;
};
export type MoveItem = {
  what: string;
  models: string[];
  from: string;
  to: string;
  bytes: number;
  files: number;
  present: number;
  presentBytes: number;
};
export type SetDirPlan = {
  dir: string;
  previous: string | null;
  runtimes: boolean;
  action: "set" | "move" | "keep" | "copy";
  sameDrive: boolean;
  drive: { root: string; freeMB: number };
  installedMB: number;
  files: number;
  items: MoveItem[];
};
export type DirDeps = { freeMB(dir: string): number | null; busy(): string[]; projects(): string[] };

const BUSY = /rag-index|models-|bench|eval|compare/;

export const dirDeps: DirDeps = {
  freeMB: (d) => downloadDeps.freeMB(d),
  busy: () => {
    const out: string[] = [];
    for (const p of [null, ...readSettings().projects])
      for (const j of listJobs(p)) if (j.status === "running" && BUSY.test(j.kind)) out.push(`${j.kind} ${j.subject}`);
    return out;
  },
  projects: () => readSettings().projects,
};

export const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

export function inside(child: string, parent: string): boolean {
  const rel = relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function sameDrive(a: string, b: string): boolean {
  return parse(norm(a)).root === parse(norm(b)).root;
}

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(path, d.name)) : [join(path, d.name)],
  );
}

type Step = { from: string; to: string; bytes: number; present: boolean };

function stepsOf(from: string, to: string): Step[] {
  const isFile = existsSync(from) && statSync(from).isFile();
  return walk(from).map((f) => {
    const dest = isFile ? to : join(to, relative(from, f));
    return { from: f, to: dest, bytes: statSync(f).size, present: existsSync(dest) };
  });
}

// ponytail: a file already at the target is fine when it is the same file; another size is refused before anything moves
function itemOf(models: string[], from: string, previous: string, dir: string): MoveItem {
  const to = join(dir, relative(previous, from));
  const steps = stepsOf(from, to);
  for (const s of steps.filter((x) => x.present))
    if (statSync(s.to).size !== s.bytes)
      throw new UserError(
        `${s.to} already exists and differs from ${s.from} (${statSync(s.to).size} bytes instead of ${s.bytes}): nothing was changed.`,
        "Remove or rename it, choose another folder, or use --keep.",
      );
  const present = steps.filter((s) => s.present);
  return {
    what: models.join(", "),
    models,
    from,
    to,
    bytes: steps.reduce((a, s) => a + s.bytes, 0),
    files: steps.length,
    present: present.length,
    presentBytes: present.reduce((a, s) => a + s.bytes, 0),
  };
}

function nearest(dir: string): string {
  let d = dir;
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
  return d;
}

export function writable(dir: string, create: boolean): boolean {
  try {
    if (!create) {
      accessSync(nearest(dir), constants.W_OK);
      return true;
    }
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.testimus-write-${process.pid}`);
    writeFileSync(probe, "");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function planSetDir(
  input: SetDirInput,
  deps: DirDeps = dirDeps,
  r: ModelsRegistry = readRegistry(),
): SetDirPlan {
  if (!isAbsolute(input.dir))
    throw new UserError(
      `${input.dir} is not an absolute folder.`,
      "Give a full path, e.g. D:\\Testimus\\models or /Users/you/Testimus/models.",
    );
  const dir = resolve(input.dir);
  const flags = [input.move && "move", input.keep && "keep", input.copy && "copy"].filter(Boolean) as (
    | "move"
    | "keep"
    | "copy"
  )[];
  if (flags.length > 1) throw new UserError("Choose one of --move, --keep or --copy.");
  for (const p of deps.projects())
    if (inside(dir, p))
      throw new UserError(
        `${dir} is inside the project folder ${p}: models are not project data and would be synced with it.`,
        "Choose a folder outside every project.",
      );
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, "project.json")) && isProject(d))
      throw new UserError(
        `${dir} is inside the project folder ${d}: models are not project data and would be synced with it.`,
        "Choose a folder outside every project.",
      );
    if (dirname(d) === d) break;
  }
  const previous = (input.runtimes ? runtimesDir(r) : r.dir) ?? null;
  const sources = new Map<string, { path: string; models: string[] }>();
  if (previous && norm(previous) !== norm(dir)) {
    if (input.runtimes) {
      if (r.llamacpp?.via === "download" && inside(r.llamacpp.exe, previous))
        sources.set(norm(dirname(r.llamacpp.exe)), {
          path: dirname(r.llamacpp.exe),
          models: [`llama.cpp ${r.llamacpp.build}`],
        });
    } else
      for (const i of r.installs)
        if (i.via === "download" && i.path && existsSync(i.path) && inside(i.path, previous)) {
          const seen = sources.get(norm(i.path));
          if (seen) {
            if (!seen.models.includes(i.model)) seen.models.push(i.model);
          } else sources.set(norm(i.path), { path: i.path, models: [i.model] });
        }
  }
  const items = [...sources.values()].map((s) => itemOf(s.models, s.path, previous ?? dir, dir));
  const installedMB = Math.round(items.reduce((a, i) => a + i.bytes, 0) / MB);
  const files = items.reduce((a, i) => a + i.files, 0);
  const free = deps.freeMB(dir);
  const same = previous ? sameDrive(previous, dir) : true;
  let action: SetDirPlan["action"] = "set";
  if (items.length) {
    if (!flags.length)
      throw new UserError(
        `${items.length} downloaded item${items.length === 1 ? "" : "s"} (${gb(installedMB)}) ${items.length === 1 ? "is" : "are"} in ${previous}. Say what to do with ${items.length === 1 ? "it" : "them"}.`,
        `testimus models setDir "${dir}" --move (move them), --keep (leave them where they are) or --copy (copy them, keep the old copy).`,
      );
    action = flags[0];
  }
  const plan: SetDirPlan = {
    dir,
    previous,
    runtimes: input.runtimes,
    action,
    sameDrive: same,
    drive: { root: parse(dir).root, freeMB: free ?? 0 },
    installedMB,
    files,
    items,
  };
  const needsSpace = action === "copy" || (action === "move" && !same);
  const toWrite = items.reduce((a, i) => a + i.bytes - i.presentBytes, 0);
  if (needsSpace && free !== null && free * MB < toWrite)
    throw new UserError(
      `Not enough space on ${parse(dir).root}: ${gb(free)} free, ${gb(toWrite / MB)} to ${action}.`,
      "Free some space, choose another folder, or use --keep.",
    );
  if (!writable(dir, !input.dryRun))
    throw new UserError(`Cannot write to ${dir}.`, "Choose a folder you can write to (not a read-only share).");
  if (action === "move" || action === "copy") {
    const busy = deps.busy();
    if (busy.length)
      throw new UserError(
        `A job is using the models (${busy.join(", ")}).`,
        "Retry once it ends, or cancel it in Jobs.",
      );
  }
  return plan;
}

async function sha256Of(path: string, signal: AbortSignal): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * MB, signal })) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function copyChecked(from: string, to: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  mkdirSync(dirname(to), { recursive: true });
  const part = `${to}.part`;
  const src = createHash("sha256");
  await pipeline(
    createReadStream(from),
    new Transform({
      transform(chunk: Buffer, _e, done) {
        src.update(chunk);
        onBytes(chunk.length);
        done(null, chunk);
      },
    }),
    createWriteStream(part),
    { signal },
  );
  const a = src.digest("hex");
  const b = await sha256Of(part, signal);
  if (a !== b) {
    rmSync(part, { force: true });
    throw new UserError(`The copy of ${from} differs from the original (SHA-256): nothing was changed.`, "Retry.");
  }
  renameSync(part, to);
}

export function pruneEmpty(dir: string, stop: string): void {
  for (let d = dir; inside(d, stop) && norm(d) !== norm(stop); d = dirname(d)) {
    try {
      if (readdirSync(d).length) return;
      rmdirSync(d);
    } catch {
      return;
    }
  }
}

function commit(plan: SetDirPlan): void {
  const r = readRegistry();
  const moved = plan.action === "move";
  if (plan.runtimes) {
    r.runtimesDir = plan.dir;
    if (moved && r.llamacpp && plan.items[0])
      r.llamacpp = { ...r.llamacpp, exe: join(plan.items[0].to, relative(plan.items[0].from, r.llamacpp.exe)) };
    if (plan.action === "keep" && r.llamacpp?.via === "download") r.llamacpp = { ...r.llamacpp, via: "path" };
  } else {
    r.dir = plan.dir;
    const by = new Map(plan.items.map((i) => [norm(i.from), i]));
    r.installs = r.installs.map((i) => {
      const it = i.path ? by.get(norm(i.path)) : undefined;
      if (!it || i.via !== "download") return i;
      if (moved) return { ...i, path: it.to };
      if (plan.action === "keep") return { ...i, via: "path" as const };
      return i;
    });
  }
  writeRegistry(r);
}

function cancelledError(): UserError {
  return new UserError("Cancelled.");
}

// ponytail: whole-file steps, so a folder two variants share moves once and a file already at the target is reused
export async function applySetDir(
  plan: SetDirPlan,
  opts: { signal: AbortSignal; onProgress(done: number, total: number, what: string): void },
): Promise<{ cancelled: boolean }> {
  if (plan.action === "set" || plan.action === "keep" || !plan.items.length) {
    if (!existsSync(plan.dir)) mkdirSync(plan.dir, { recursive: true });
    commit(plan);
    return { cancelled: false };
  }
  const total = plan.items.reduce((a, i) => a + i.bytes, 0);
  const rename = plan.action === "move" && plan.sameDrive;
  const work = plan.items.map((it) => ({ it, steps: stepsOf(it.from, it.to) }));
  const renamed: Step[] = [];
  const written: string[] = [];
  let done = 0;
  try {
    for (const { it, steps } of work)
      for (const s of steps.filter((x) => x.present)) {
        if (opts.signal.aborted) throw cancelledError();
        const same =
          statSync(s.to).size === s.bytes &&
          (await sha256Of(s.from, opts.signal)) === (await sha256Of(s.to, opts.signal));
        if (!same)
          throw new UserError(
            `${s.to} already exists and differs from ${s.from} (SHA-256): nothing was changed.`,
            "Remove or rename it, choose another folder, or use --keep.",
          );
        done += s.bytes;
        opts.onProgress(done, total, it.what);
      }
    for (const { it, steps } of work)
      for (const s of steps.filter((x) => !x.present)) {
        if (opts.signal.aborted) throw cancelledError();
        if (rename) {
          mkdirSync(dirname(s.to), { recursive: true });
          renameSync(s.from, s.to);
          renamed.push(s);
          done += s.bytes;
          opts.onProgress(done, total, it.what);
        } else {
          await copyChecked(s.from, s.to, opts.signal, (n) => {
            done += n;
            opts.onProgress(done, total, it.what);
          });
          written.push(s.to);
        }
      }
    if (opts.signal.aborted) throw cancelledError();
  } catch (e) {
    for (const s of renamed.reverse()) {
      mkdirSync(dirname(s.from), { recursive: true });
      renameSync(s.to, s.from);
      pruneEmpty(dirname(s.to), plan.dir);
    }
    for (const to of written) {
      rmSync(to, { force: true });
      pruneEmpty(dirname(to), plan.dir);
    }
    for (const { steps } of work)
      for (const s of steps.filter((x) => !x.present)) {
        rmSync(`${s.to}.part`, { force: true });
        pruneEmpty(dirname(s.to), plan.dir);
      }
    if (opts.signal.aborted) return { cancelled: true };
    throw e;
  }
  commit(plan);
  if (plan.action === "move")
    for (const { steps } of work)
      for (const s of steps) {
        if (existsSync(s.from)) rmSync(s.from, { force: true });
        if (plan.previous) pruneEmpty(dirname(s.from), plan.previous);
      }
  return { cancelled: false };
}

export async function copyTree(
  from: string,
  to: string,
  signal: AbortSignal,
  onBytes: (n: number) => void,
): Promise<void> {
  const root = statSync(from).isFile() ? dirname(from) : from;
  const target = statSync(from).isFile() ? dirname(to) : to;
  const written: string[] = [];
  try {
    for (const file of walk(from)) {
      if (signal.aborted) throw new UserError("Cancelled.");
      const dest = statSync(from).isFile() ? to : join(target, relative(root, file));
      if (existsSync(dest))
        throw new UserError(`${dest} already exists: nothing was changed.`, "Remove it, or use --keep.");
      await copyChecked(file, dest, signal, onBytes);
      written.push(dest);
    }
  } catch (e) {
    for (const f of written) rmSync(f, { force: true });
    for (const f of walk(target)) if (f.endsWith(".part")) rmSync(f, { force: true });
    pruneEmpty(target, dirname(target));
    throw e;
  }
}
