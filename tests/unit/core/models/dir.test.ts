import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { listJobs } from "../../../../src/core/jobs.ts";
import { registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { applySetDir, type DirDeps, planSetDir, sameDrive } from "../../../../src/core/lib/models-dir.ts";
import { installDeps } from "../../../../src/core/lib/models-install.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import type { ModelsRegistry } from "../../../../src/core/types.ts";

const SANDBOX = resolve("D:/Projects/Testimus/.sandbox/v2/e");
const SANDBOX_P2 = resolve("D:/Projects/Testimus/.sandbox/v2/p2");
const other = parse(tmpdir()).root.toLowerCase() !== parse(SANDBOX).root.toLowerCase() && existsSync("D:\\");
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
const signal = () => new AbortController().signal;

let base: string;
let old: string;
const made: string[] = [];

function seed(root: string): ModelsRegistry {
  const onnx = join(root, "Xenova", "bge-m3");
  mkdirSync(join(onnx, "onnx"), { recursive: true });
  writeFileSync(join(onnx, "config.json"), "{}");
  writeFileSync(join(onnx, "onnx", "model_quantized.onnx"), Buffer.alloc(200000, 7));
  const gguf = join(root, "Qwen", "Qwen3-Embedding-0.6B-GGUF", "q.gguf");
  mkdirSync(join(root, "Qwen", "Qwen3-Embedding-0.6B-GGUF"), { recursive: true });
  writeFileSync(gguf, Buffer.alloc(150000, 3));
  const shared = join(base, "share", "model.gguf");
  mkdirSync(join(base, "share"), { recursive: true });
  writeFileSync(shared, "x");
  const r: ModelsRegistry = {
    dir: root,
    installs: [
      { model: "bge-m3-q8", via: "download", runtime: "transformers", path: onnx, status: "installed" },
      { model: "qwen3-embedding-0.6b-q8", via: "download", runtime: "llamacpp", path: gguf, status: "verified" },
      { model: "qwen3-embedding-4b-q4", via: "path", runtime: "llamacpp", path: shared, status: "installed" },
    ],
  };
  writeRegistry(r);
  return r;
}

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  base = mkdtempSync(join(tmpdir(), "testimus-setdir-"));
  old = join(base, "old");
  seed(old);
});

afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("models.setDir — plan and refusals", () => {
  it("first choice: just sets the folder", async () => {
    rmSync(registryFile(), { force: true });
    const target = join(base, "first");
    const plan = planSetDir(input(target), deps());
    expect(plan).toMatchObject({ action: "set", previous: null, items: [] });
    await applySetDir(plan, { signal: signal(), onProgress: () => {} });
    expect(readRegistry().dir).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it("stops and asks when downloads exist and no choice is given", () => {
    expect(() => planSetDir(input(join(base, "new")), deps())).toThrow(/2 downloaded items .* Say what to do/);
    try {
      planSetDir(input(join(base, "new")), deps());
    } catch (e) {
      expect((e as { fix?: string }).fix).toMatch(/--move .*--keep .*--copy/);
    }
  });

  it("dry run: the plan, nothing created or changed", () => {
    const target = join(base, "dry");
    const before = readFileSync(registryFile(), "utf8");
    const plan = planSetDir(input(target, { move: true, dryRun: true }), deps());
    expect(plan.action).toBe("move");
    expect(plan.items.map((i) => i.what).sort()).toEqual(["bge-m3-q8", "qwen3-embedding-0.6b-q8"]);
    expect(plan.files).toBe(3);
    expect(plan.installedMB).toBe(0);
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(registryFile(), "utf8")).toBe(before);
  });

  it("refuses: no space, not writable, a job using the models, a project folder", () => {
    expect(() => planSetDir(input(join(base, "n"), { copy: true }), deps({ freeMB: () => 0 }))).toThrow(
      /Not enough space .*0\.0 GB free/,
    );
    const file = join(base, "afile");
    writeFileSync(file, "");
    expect(() => planSetDir(input(join(file, "sub"), { keep: true }), deps())).toThrow(/Cannot write/);
    expect(() => planSetDir(input(join(base, "n"), { move: true }), deps({ busy: () => ["rag-index index"] }))).toThrow(
      /A job is using the models \(rag-index index\)/,
    );
    const proj = join(base, "proj");
    mkdirSync(proj);
    writeFileSync(join(proj, "project.json"), "{}");
    expect(() => planSetDir(input(join(proj, "models"), { keep: true }), deps())).toThrow(/inside the project folder/);
    expect(() =>
      planSetDir(input(join(base, "p2", "m"), { keep: true }), deps({ projects: () => [join(base, "p2")] })),
    ).toThrow(/inside the project folder/);
    expect(() => planSetDir(input(join(base, "n"), { move: true, copy: true }), deps())).toThrow(/one of/);
    expect(() => planSetDir(input("relative\\dir", { keep: true }), deps())).toThrow(/absolute/);
  });

  it("a move on the same drive needs no free space", () => {
    expect(sameDrive(old, join(base, "n"))).toBe(true);
    expect(planSetDir(input(join(base, "n"), { move: true }), deps({ freeMB: () => 0 })).sameDrive).toBe(true);
  });
});

describe("models.setDir — move, keep, copy", () => {
  it("move on the same drive renames and updates every path", async () => {
    const target = join(base, "moved");
    const plan = planSetDir(input(target, { move: true }), deps());
    const r = await applySetDir(plan, { signal: signal(), onProgress: () => {} });
    expect(r.cancelled).toBe(false);
    const reg = readRegistry();
    expect(reg.dir).toBe(target);
    expect(reg.installs.find((i) => i.model === "bge-m3-q8")?.path).toBe(join(target, "Xenova", "bge-m3"));
    expect(reg.installs.find((i) => i.model === "qwen3-embedding-0.6b-q8")?.path).toBe(
      join(target, "Qwen", "Qwen3-Embedding-0.6B-GGUF", "q.gguf"),
    );
    expect(reg.installs.find((i) => i.model === "qwen3-embedding-4b-q4")?.path).toBe(join(base, "share", "model.gguf"));
    expect(existsSync(join(target, "Xenova", "bge-m3", "onnx", "model_quantized.onnx"))).toBe(true);
    expect(existsSync(join(old, "Xenova"))).toBe(false);
  });

  it("keep: nothing moves, the downloads stay registered by their path", async () => {
    const target = join(base, "kept");
    await applySetDir(planSetDir(input(target, { keep: true }), deps()), { signal: signal(), onProgress: () => {} });
    const reg = readRegistry();
    expect(reg.dir).toBe(target);
    expect(reg.installs.filter((i) => i.via === "path").map((i) => i.path?.startsWith(old) || i.model).length).toBe(3);
    expect(existsSync(join(old, "Xenova", "bge-m3", "config.json"))).toBe(true);
  });

  it("copy: the new folder gets verified copies, the old ones stay registered", async () => {
    const target = join(base, "copied");
    await applySetDir(planSetDir(input(target, { copy: true }), deps()), { signal: signal(), onProgress: () => {} });
    expect(readFileSync(join(target, "Qwen", "Qwen3-Embedding-0.6B-GGUF", "q.gguf")).length).toBe(150000);
    expect(existsSync(join(old, "Qwen", "Qwen3-Embedding-0.6B-GGUF", "q.gguf"))).toBe(true);
    const reg = readRegistry();
    expect(reg.dir).toBe(target);
    expect(reg.installs.find((i) => i.model === "bge-m3-q8")?.path).toBe(join(old, "Xenova", "bge-m3"));
  });

  it.runIf(other)("move to another drive: copy, SHA-256 check, then delete the old copy", async () => {
    mkdirSync(SANDBOX, { recursive: true });
    const target = mkdtempSync(join(SANDBOX, "move-"));
    made.push(target);
    const plan = planSetDir(input(target, { move: true }), deps());
    expect(plan.sameDrive).toBe(false);
    let progressed = 0;
    await applySetDir(plan, { signal: signal(), onProgress: (d) => (progressed = d) });
    expect(progressed).toBe(350002);
    expect(readFileSync(join(target, "Xenova", "bge-m3", "onnx", "model_quantized.onnx")).length).toBe(200000);
    expect(existsSync(join(old, "Xenova", "bge-m3"))).toBe(false);
    expect(readRegistry().installs.find((i) => i.model === "bge-m3-q8")?.path).toBe(join(target, "Xenova", "bge-m3"));
  });

  it.runIf(other)(
    "cancel during a move to another drive: old copy intact, registry unchanged, no leftovers",
    async () => {
      mkdirSync(SANDBOX, { recursive: true });
      const target = mkdtempSync(join(SANDBOX, "cancel-"));
      made.push(target);
      const before = readFileSync(registryFile(), "utf8");
      const ctrl = new AbortController();
      const plan = planSetDir(input(target, { move: true }), deps());
      const r = await applySetDir(plan, { signal: ctrl.signal, onProgress: () => ctrl.abort() });
      expect(r.cancelled).toBe(true);
      expect(readFileSync(registryFile(), "utf8")).toBe(before);
      expect(existsSync(join(old, "Xenova", "bge-m3", "onnx", "model_quantized.onnx"))).toBe(true);
      expect(existsSync(join(old, "Qwen", "Qwen3-Embedding-0.6B-GGUF", "q.gguf"))).toBe(true);
      expect(existsSync(join(target, "Xenova", "bge-m3", "onnx", "model_quantized.onnx"))).toBe(false);
      expect(existsSync(join(target, "Qwen", "Qwen3-Embedding-0.6B-GGUF", "q.gguf"))).toBe(false);
    },
  );

  it("cancel during a same-drive move puts back what was renamed", async () => {
    const target = join(base, "half");
    const ctrl = new AbortController();
    const before = readFileSync(registryFile(), "utf8");
    const r = await applySetDir(planSetDir(input(target, { move: true }), deps()), {
      signal: ctrl.signal,
      onProgress: () => ctrl.abort(),
    });
    expect(r.cancelled).toBe(true);
    expect(readFileSync(registryFile(), "utf8")).toBe(before);
    expect(existsSync(join(old, "Xenova", "bge-m3", "config.json"))).toBe(true);
    expect(existsSync(join(old, "Qwen", "Qwen3-Embedding-0.6B-GGUF", "q.gguf"))).toBe(true);
  });

  it("the command: the plan (models.planDir), keep, then a move job that can be awaited", async () => {
    const dry = (await invoke("models.planDir", { dir: join(base, "c1"), move: true }, { project: null })) as {
      action: string;
      files: number;
    };
    expect(dry).toMatchObject({ action: "move", files: 3 });
    expect(readRegistry().dir).not.toBe(join(base, "c1"));
    await expect(invoke("models.planDir", { dir: join(base, "c1") }, { project: null })).rejects.toThrow(
      /Say what to do/,
    );
    await expect(invoke("models.setDir", { dir: join(base, "c1") }, { project: null })).rejects.toThrow(
      /Say what to do/,
    );
    const moved = (await invoke("models.setDir", { dir: join(base, "c2"), move: true }, { project: null })) as {
      action: string;
      cancelled: boolean;
    };
    expect(moved).toMatchObject({ action: "move", cancelled: false });
    expect(
      listJobs(null).some(
        (j) => j.kind === "models-dir" && j.subject === `move to ${join(base, "c2")}` && j.status === "done",
      ),
    ).toBe(true);
    expect(readRegistry().dir).toBe(join(base, "c2"));
    const runtimes = (await invoke("models.setDir", { dir: join(base, "rt"), runtimes: true }, { project: null })) as {
      action: string;
    };
    expect(runtimes.action).toBe("set");
    expect(readRegistry().runtimesDir).toBe(join(base, "rt"));
  });
});

describe("two variants of one Hugging Face repo share a folder (#4)", () => {
  const SHARED = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"];
  const body = (f: string) => `{"${f}":1}`;
  let repo: string;

  function seedShared(root: string): void {
    repo = join(root, "Xenova", "bge-m3");
    mkdirSync(join(repo, "onnx"), { recursive: true });
    for (const f of SHARED) writeFileSync(join(repo, f), body(f));
    writeFileSync(join(repo, "onnx", "model_quantized.onnx"), Buffer.alloc(3000, 1));
    writeFileSync(join(repo, "onnx", "model_fp16.onnx"), Buffer.alloc(5000, 2));
    writeRegistry({
      dir: root,
      installs: [
        { model: "bge-m3-q8", via: "download", runtime: "transformers", path: repo, dtype: "q8", status: "verified" },
        {
          model: "bge-m3-fp16",
          via: "download",
          runtime: "transformers",
          path: repo,
          dtype: "fp16",
          status: "verified",
        },
      ],
    });
  }

  const saved = { ...installDeps };
  beforeEach(() => {
    rmSync(registryFile(), { force: true });
    seedShared(old);
  });
  afterEach(() => {
    Object.assign(installDeps, saved);
  });

  it("remove deletes only the variant's own weights; the other stays installed and verifiable", async () => {
    installDeps.probe = async () => ({ dims: 1024, maxTokens: 8192 });
    const r = (await invoke("models.remove", { model: "bge-m3-q8" }, { project: null })) as { removed: string };
    expect(r.removed).toBe("files");
    expect(existsSync(join(repo, "onnx", "model_quantized.onnx"))).toBe(false);
    for (const f of [...SHARED, "onnx/model_fp16.onnx"]) expect(existsSync(join(repo, f)), f).toBe(true);
    expect(readRegistry().installs.map((i) => i.model)).toEqual(["bge-m3-fp16"]);
    const v = (await invoke("models.verify", { model: "bge-m3-fp16" }, { project: null })) as { ok: boolean };
    expect(v.ok).toBe(true);
    const rows = (await invoke("models.list", {}, { project: null })) as { model: string; state: string }[];
    expect(rows.find((x) => x.model === "bge-m3-fp16")?.state).not.toBe("broken");
    await invoke("models.remove", { model: "bge-m3-fp16" }, { project: null });
    expect(existsSync(join(old, "Xenova"))).toBe(false);
    expect(readRegistry().installs).toEqual([]);
  });

  it("the size of each variant counts its own files, not the whole shared folder", async () => {
    writeFileSync(join(repo, "onnx", "model_fp16.onnx"), Buffer.alloc(3 * 1024 * 1024, 2));
    const rows = (await invoke("models.list", {}, { project: null })) as { model: string; sizeMB: number }[];
    expect(rows.find((x) => x.model === "bge-m3-q8")?.sizeMB).toBe(0);
    expect(rows.find((x) => x.model === "bge-m3-fp16")?.sizeMB).toBe(3);
  });

  it("setDir --move: the shared folder is one item, moved once, and every installation follows", async () => {
    const target = join(base, "m2");
    const plan = planSetDir(input(target, { move: true }), deps());
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].models).toEqual(["bge-m3-q8", "bge-m3-fp16"]);
    expect(plan.files).toBe(6);
    expect(plan.items[0].bytes).toBe(8000 + SHARED.reduce((a, f) => a + body(f).length, 0));
    expect((await applySetDir(plan, { signal: signal(), onProgress: () => {} })).cancelled).toBe(false);
    const moved = join(target, "Xenova", "bge-m3");
    expect(readRegistry().installs.map((i) => i.path)).toEqual([moved, moved]);
    expect(existsSync(join(moved, "onnx", "model_fp16.onnx"))).toBe(true);
    expect(existsSync(join(old, "Xenova"))).toBe(false);
  });

  it("setDir --copy: copied once, the old installations stay", async () => {
    const target = join(base, "c2");
    const plan = planSetDir(input(target, { copy: true }), deps());
    expect(plan.items).toHaveLength(1);
    await applySetDir(plan, { signal: signal(), onProgress: () => {} });
    expect(readFileSync(join(target, "Xenova", "bge-m3", "onnx", "model_quantized.onnx")).length).toBe(3000);
    expect(readRegistry().installs.map((i) => i.path)).toEqual([repo, repo]);
  });

  it("a folder already at the target: identical files (SHA-256) are reused, the rest moves", async () => {
    const target = join(base, "m3");
    const there = join(target, "Xenova", "bge-m3");
    mkdirSync(join(there, "onnx"), { recursive: true });
    writeFileSync(join(there, "config.json"), body("config.json"));
    writeFileSync(join(there, "onnx", "model_fp16.onnx"), Buffer.alloc(5000, 2));
    const plan = planSetDir(input(target, { move: true }), deps());
    expect(plan.items[0]).toMatchObject({ present: 2, presentBytes: 5000 + body("config.json").length });
    let last = 0;
    await applySetDir(plan, { signal: signal(), onProgress: (d) => (last = d) });
    expect(last).toBe(plan.items[0].bytes);
    expect(readRegistry().installs.map((i) => i.path)).toEqual([there, there]);
    expect(readFileSync(join(there, "onnx", "model_quantized.onnx")).length).toBe(3000);
    expect(existsSync(join(old, "Xenova"))).toBe(false);
  });

  it("a different file at the target is refused with the reason, and nothing changes", async () => {
    const target = join(base, "m4");
    const there = join(target, "Xenova", "bge-m3", "onnx");
    mkdirSync(there, { recursive: true });
    writeFileSync(join(there, "model_fp16.onnx"), Buffer.alloc(4000, 9));
    expect(() => planSetDir(input(target, { move: true }), deps())).toThrow(
      /model_fp16\.onnx already exists and differs .*4000 bytes instead of 5000/,
    );
    writeFileSync(join(there, "model_fp16.onnx"), Buffer.alloc(5000, 9));
    const before = readFileSync(registryFile(), "utf8");
    const plan = planSetDir(input(target, { move: true }), deps());
    await expect(applySetDir(plan, { signal: signal(), onProgress: () => {} })).rejects.toThrow(
      /model_fp16\.onnx already exists and differs .*\(SHA-256\): nothing was changed/,
    );
    expect(readFileSync(registryFile(), "utf8")).toBe(before);
    for (const f of [...SHARED, "onnx/model_quantized.onnx", "onnx/model_fp16.onnx"])
      expect(existsSync(join(repo, f)), f).toBe(true);
    expect(existsSync(join(target, "Xenova", "bge-m3", "config.json"))).toBe(false);
  });

  it.runIf(other)("move to another drive with an identical copy already there", async () => {
    mkdirSync(SANDBOX_P2, { recursive: true });
    const target = mkdtempSync(join(SANDBOX_P2, "move-"));
    made.push(target);
    const there = join(target, "Xenova", "bge-m3", "onnx");
    mkdirSync(there, { recursive: true });
    writeFileSync(join(there, "model_quantized.onnx"), Buffer.alloc(3000, 1));
    const plan = planSetDir(input(target, { move: true }), deps());
    expect(plan.sameDrive).toBe(false);
    await applySetDir(plan, { signal: signal(), onProgress: () => {} });
    expect(readFileSync(join(target, "Xenova", "bge-m3", "onnx", "model_fp16.onnx")).length).toBe(5000);
    expect(existsSync(join(old, "Xenova"))).toBe(false);
    expect(readRegistry().installs.every((i) => i.path === join(target, "Xenova", "bge-m3"))).toBe(true);
  });
});
