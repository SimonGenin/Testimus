import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startJob } from "../../src/core/jobs.ts";
import { registryFile } from "../../src/core/lib/models-catalog.ts";
import {
  applySetDir,
  copyTree,
  type DirDeps,
  dirDeps,
  norm,
  planSetDir,
  writable,
} from "../../src/core/lib/models-dir.ts";
import { readRegistry, writeRegistry } from "../../src/core/lib/models-registry.ts";
import type { ModelsRegistry } from "../../src/core/types.ts";

const deps = (over: Partial<DirDeps> = {}): DirDeps => ({
  freeMB: () => 1e9,
  busy: () => [],
  projects: () => [],
  ...over,
});
const input = (dir: string, o: Partial<Parameters<typeof planSetDir>[0]> = {}) => ({
  dir,
  runtimes: false,
  move: false,
  keep: false,
  copy: false,
  dryRun: false,
  ...o,
});
const platform = process.platform;
let base = "";
let old = "";

const put = (path: string, body: string | Buffer) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
};

function seedModel(): ModelsRegistry {
  const m = join(old, "acme", "m");
  put(join(m, "a.bin"), Buffer.alloc(1000, 1));
  put(join(m, "sub", "b.bin"), Buffer.alloc(500, 2));
  const r: ModelsRegistry = {
    dir: old,
    installs: [{ model: "m", via: "download", runtime: "transformers", path: m, status: "installed" }],
  };
  writeRegistry(r);
  return r;
}

function seedRuntime(): ModelsRegistry {
  const exe = join(old, "runtimes", "llama-b1", "llama-server.exe");
  put(exe, "exe");
  const r: ModelsRegistry = {
    dir: old,
    installs: [],
    llamacpp: { exe, build: "b1", backend: "cpu", via: "download" },
  };
  writeRegistry(r);
  return r;
}

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  base = mkdtempSync(join(tmpdir(), "testimus-cov-dir-"));
  old = join(base, "old");
  mkdirSync(old);
});
afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  rmSync(base, { recursive: true, force: true });
});

describe("the default deps and helpers", () => {
  it("busy lists no running job, projects are the settings' ones, free space is measured", () => {
    expect(dirDeps.busy()).toEqual([]);
    expect(dirDeps.projects()).toEqual([]);
    expect(dirDeps.freeMB(base)).toBeGreaterThan(0);
  });

  it("busy names a running models job", async () => {
    let release = () => {};
    const { done } = startJob("models-pull", "bge", null, () => new Promise<void>((r) => (release = r)));
    expect(dirDeps.busy()).toEqual(["models-pull bge"]);
    release();
    await done;
    expect(dirDeps.busy()).toEqual([]);
  });

  it("norm keeps the case off Windows; writable without creating checks the nearest folder", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    expect(norm(join(base, "AbC"))).toBe(join(base, "AbC"));
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    expect(writable(join(base, "not", "yet"), false)).toBe(true);
  });
});

describe("runtimes folder", () => {
  it("moves a downloaded llama.cpp build and points the registry at its new place", async () => {
    const r = seedRuntime();
    const to = join(base, "rt");
    const plan = planSetDir(input(to, { runtimes: true, move: true }), deps(), r);
    expect(plan.items.map((i) => i.what)).toEqual(["llama.cpp b1"]);
    expect((await applySetDir(plan, { signal: new AbortController().signal, onProgress: () => {} })).cancelled).toBe(
      false,
    );
    const reg = readRegistry();
    expect(reg.runtimesDir).toBe(plan.dir);
    expect(reg.llamacpp?.exe).toBe(join(to, "llama-b1", "llama-server.exe"));
    expect(existsSync(reg.llamacpp?.exe ?? "")).toBe(true);
  });

  it("keeping the build in place turns it into a path installation", async () => {
    const r = seedRuntime();
    const plan = planSetDir(input(join(base, "rt"), { runtimes: true, keep: true }), deps(), r);
    await applySetDir(plan, { signal: new AbortController().signal, onProgress: () => {} });
    expect(readRegistry().llamacpp?.via).toBe("path");
  });
});

describe("applySetDir — the edges", () => {
  it("a dry-run plan applied later creates the folder", async () => {
    const to = join(base, "new");
    const plan = planSetDir(input(to, { dryRun: true }), deps(), { installs: [] });
    expect(existsSync(to)).toBe(false);
    await applySetDir(plan, { signal: new AbortController().signal, onProgress: () => {} });
    expect(existsSync(to)).toBe(true);
    expect(readRegistry().dir).toBe(plan.dir);
  });

  it("an item whose files vanished after the plan moves nothing and still commits", async () => {
    const r = seedModel();
    const plan = planSetDir(input(join(base, "to"), { move: true }), deps(), r);
    rmSync(join(old, "acme"), { recursive: true });
    await applySetDir(plan, { signal: new AbortController().signal, onProgress: () => {} });
    expect(readRegistry().installs[0].path).toBe(join(base, "to", "acme", "m"));
  });

  it("a cancel while checking files already at the target changes nothing", async () => {
    const r = seedModel();
    const to = join(base, "to");
    put(join(to, "acme", "m", "a.bin"), Buffer.alloc(1000, 1));
    const plan = planSetDir(input(to, { copy: true }), deps(), r);
    const ctl = new AbortController();
    ctl.abort();
    expect(await applySetDir(plan, { signal: ctl.signal, onProgress: () => {} })).toEqual({ cancelled: true });
    expect(readRegistry().dir).toBe(old);
  });

  it("a cancel after the last file rolls the moves back", async () => {
    const r = seedModel();
    const to = join(base, "to");
    const plan = planSetDir(input(to, { move: true }), deps(), r);
    const ctl = new AbortController();
    const res = await applySetDir(plan, {
      signal: ctl.signal,
      onProgress: (done, total) => {
        if (done === total) ctl.abort();
      },
    });
    expect(res).toEqual({ cancelled: true });
    expect(existsSync(join(old, "acme", "m", "sub", "b.bin"))).toBe(true);
    expect(existsSync(join(to, "acme"))).toBe(false);
  });

  it("a copy that fails midway removes the files it wrote and throws", async () => {
    const r = seedModel();
    const to = join(base, "to");
    const plan = planSetDir(input(to, { copy: true }), deps(), r);
    put(join(to, "acme", "m", "sub"), "a file where a folder is needed");
    await expect(applySetDir(plan, { signal: new AbortController().signal, onProgress: () => {} })).rejects.toThrow();
    expect(existsSync(join(to, "acme", "m", "a.bin"))).toBe(false);
    expect(readFileSync(join(old, "acme", "m", "a.bin")).length).toBe(1000);
  });
});

describe("planSetDir — the edges", () => {
  it("two downloaded items without a flag are named in the plural; unknown free space reads 0", () => {
    const r = seedModel();
    const n = join(old, "acme", "n");
    put(join(n, "x.bin"), "x");
    r.installs.push(
      { model: "n", via: "download", runtime: "transformers", path: n, status: "installed" },
      { model: "p", via: "download", runtime: "transformers", status: "installed" },
    );
    writeRegistry(r);
    expect(() => planSetDir(input(join(base, "to")), deps(), r)).toThrow(/2 downloaded items .* are in .* them/);
    const plan = planSetDir(input(join(base, "to"), { keep: true }), deps({ freeMB: () => null }), r);
    expect(plan.drive.freeMB).toBe(0);
  });

  it("an installation without a path is kept as is", async () => {
    const r = seedModel();
    r.installs.push({ model: "p", via: "download", runtime: "transformers", status: "installed" });
    writeRegistry(r);
    const plan = planSetDir(input(join(base, "to"), { move: true }), deps(), r);
    await applySetDir(plan, { signal: new AbortController().signal, onProgress: () => {} });
    expect(readRegistry().installs.find((i) => i.model === "p")?.path).toBeUndefined();
  });
});

describe("copyTree", () => {
  it("a cancel in the middle of a file removes its .part", async () => {
    const from = join(base, "big");
    put(join(from, "big.bin"), Buffer.alloc(3 * 1024 * 1024, 5));
    const to = join(base, "bigdst");
    const ctl = new AbortController();
    await expect(copyTree(from, to, ctl.signal, () => ctl.abort())).rejects.toThrow();
    expect(existsSync(join(to, "big.bin.part"))).toBe(false);
  });

  it("copies a folder, refuses an existing target file and rolls back", async () => {
    const from = join(base, "src");
    put(join(from, "a.txt"), "a");
    put(join(from, "z", "b.txt"), "b");
    const to = join(base, "dst");
    put(join(to, "z", "b.txt"), "already");
    await expect(copyTree(from, to, new AbortController().signal, () => {})).rejects.toThrow(/already exists/);
    expect(existsSync(join(to, "a.txt"))).toBe(false);
    expect(readFileSync(join(to, "z", "b.txt"), "utf8")).toBe("already");
  });

  it("stops when cancelled", async () => {
    const from = join(base, "src");
    put(join(from, "a.txt"), "a");
    const ctl = new AbortController();
    ctl.abort();
    await expect(copyTree(from, join(base, "dst2"), ctl.signal, () => {})).rejects.toThrow(/Cancelled/);
  });

  it("copies a single file to its target name", async () => {
    const file = join(base, "one.gguf");
    put(file, "g");
    const to = join(base, "out", "one.gguf");
    await copyTree(file, to, new AbortController().signal, () => {});
    expect(readFileSync(to, "utf8")).toBe("g");
  });
});
