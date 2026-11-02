import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { OllamaStatus } from "../rag/runtimes/ollama.ts";
import type {
  CatalogEntry,
  Dtype,
  Installation,
  InstallState,
  LlamaRuntime,
  MachineProfile,
  ModelsRegistry,
  ResolvedModel,
} from "../types.ts";
import { catalog, catalogEntry, pack } from "./models-catalog.ts";
import { applySetDir, copyTree, inside, norm, planSetDir, pruneEmpty } from "./models-dir.ts";
import {
  checkFile,
  downloadDeps,
  filesFor,
  filesPresent,
  hashFile,
  installPath,
  pullFiles,
} from "./models-download.ts";
import { fitOf } from "./models-fit.ts";
import { machineProfile } from "./models-hardware.ts";
import { opSignal, perfStats, speedLine } from "./models-perf.ts";
import { ollamaMode, putInstall, readRegistry, updateRegistry } from "./models-registry.ts";
import { deviceOf, isGguf, resolveInstalled } from "./models-resolve.ts";
import { isComplete } from "./models-store.ts";
import { readSettings } from "./project.ts";

const MB = 1024 * 1024;

export const installDeps = {
  probe: async (m: ResolvedModel): Promise<{ dims: number; maxTokens: number }> => {
    const servers = await import("../rag/runtimes/llama-server.ts");
    const before = new Set(servers.liveServers());
    try {
      return await (await import("../rag/embed.ts")).probeWith(m);
    } finally {
      for (const s of servers.liveServers()) if (!before.has(s)) await servers.stopServer(s).catch(() => {});
    }
  },
  ollama: async (): Promise<OllamaStatus | null> => {
    if (ollamaMode() === "never" || !readRegistry().ollama.enabled) return null;
    try {
      return await (await import("../rag/runtimes/ollama.ts")).ollamaStatus();
    } catch {
      return null;
    }
  },
  ollamaPull: async (
    tag: string,
    onProgress: (p: { status: string; completed?: number; total?: number }) => void,
    signal: AbortSignal,
  ) => (await import("../rag/runtimes/ollama.ts")).ollamaPull(tag, onProgress, signal),
  ollamaDelete: async (tag: string) => (await import("../rag/runtimes/ollama.ts")).ollamaDelete(tag),
  findLlamaBuild: async (dir: string): Promise<LlamaRuntime | null> =>
    (await import("../rag/runtimes/llamacpp.ts")).findLlamaBuild(dir),
};

export function needEntry(id: string): CatalogEntry {
  const e = catalogEntry(id);
  if (!e) throw new UserError(`Unknown model ${id}.`, "testimus models catalog lists the catalog ids.");
  return e;
}

function sizeOf(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (s.isFile()) return s.size;
  return readdirSync(path, { withFileTypes: true }).reduce(
    (a, d) => a + (d.isDirectory() ? sizeOf(join(path, d.name)) : statSync(join(path, d.name)).size),
    0,
  );
}

function asResolved(entry: CatalogEntry, install: Installation): ResolvedModel {
  const device = install.device ?? "cpu";
  const dtype = install.dtype ?? entry.dtypeByDevice?.[device] ?? entry.dtypeByDevice?.cpu;
  return {
    entry,
    install,
    runtime: install.runtime,
    device,
    ...(dtype ? { dtype } : {}),
    queryTask: "Given a question, retrieve the passages that answer it",
  };
}

async function probeInstall(
  entry: CatalogEntry,
  install: Installation,
): Promise<{ dims: number; ms: number; ok: boolean; message: string }> {
  const t0 = Date.now();
  try {
    const p = await installDeps.probe(asResolved(entry, install));
    const ms = Date.now() - t0;
    const want = entry.kind === "embedding" ? entry.dims : p.dims;
    const ok = entry.kind !== "embedding" || p.dims === want || !!entry.dimsOptions?.includes(p.dims);
    return {
      dims: p.dims,
      ms,
      ok,
      message: ok
        ? `${entry.label} answered in ${ms} ms (${p.dims} dimensions).`
        : `${entry.label} gives ${p.dims} dimensions, the catalog says ${entry.dims}.`,
    };
  } catch (e) {
    if (opSignal()?.aborted) throw e;
    return { dims: entry.dims, ms: Date.now() - t0, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// --- Path A

function guessTransformers(dir: string, model?: string): CatalogEntry[] {
  if (model) return [needEntry(model)];
  const name = basename(dir).toLowerCase();
  const all = catalog().entries.filter((e) => e.runtimes.includes("transformers") && e.source.hf);
  const exact = all.filter((e) => filesPresent(dir, filesFor(e)));
  if (exact.length) return exact;
  return all.filter(
    (e) =>
      e.source.hf?.repo.split("/").pop()?.toLowerCase() === name &&
      isComplete(dir, e.dtypeByDevice?.dml ?? e.dtypeByDevice?.cpu),
  );
}

export type AddResult = { model: string; via: "path"; path: string; dims: number; state: InstallState };

export async function addPath(input: { path: string; model?: string; copy: boolean }, ctx?: Ctx): Promise<AddResult> {
  if (!isAbsolute(input.path)) throw new UserError(`${input.path} is not an absolute path.`);
  const path = resolve(input.path);
  if (!existsSync(path)) throw new UserError(`${path} does not exist.`);
  const isFile = statSync(path).isFile();
  if (!isFile && existsSync(join(path, "llama-server.exe"))) {
    const build = await installDeps.findLlamaBuild(path);
    if (!build) throw new UserError(`${path} holds llama-server.exe but its build could not be read.`);
    updateRegistry((r) => {
      r.llamacpp = { ...build, via: "path" };
    });
    return { model: "llama.cpp", via: "path", path: build.exe, dims: 0, state: "installed" };
  }
  let entries: CatalogEntry[];
  if (isFile) {
    if (!/\.gguf$/i.test(path))
      throw new UserError(`${path} is not a .gguf file.`, "Give a .gguf file, a model folder or a llama.cpp folder.");
    const size = statSync(path).size;
    entries = input.model
      ? [needEntry(input.model)]
      : catalog().entries.filter((e) => e.source.file && e.source.file.size === size);
    if (!entries.length)
      throw new UserError(
        `${basename(path)} is not a file of the catalog (no entry has its size).`,
        "Name it with --model.",
      );
    ctx?.progress({ message: `Checking ${basename(path)} (SHA-256)` });
    const got = await hashFile(path);
    const hit = entries.find((e) => e.source.file?.sha256 === got.sha256);
    if (!hit)
      throw new UserError(
        `${basename(path)} does not match ${entries.map((e) => e.label).join(" or ")} (SHA-256 ${got.sha256.slice(0, 12)}…).`,
        "Download it again, or let Testimus download it: testimus models pull <id>.",
      );
    entries = [hit];
  } else {
    if (!existsSync(join(path, "config.json")) || !existsSync(join(path, "tokenizer.json")))
      throw new UserError(
        `${path} is not a Hugging Face model folder (config.json, tokenizer.json, onnx/*.onnx) nor a llama.cpp folder.`,
      );
    entries = guessTransformers(path, input.model);
    if (!entries.length) throw new UserError(`${path} matches no catalog entry.`, "Name it with --model <catalog id>.");
  }
  let out: AddResult | null = null;
  for (const entry of entries) {
    let where = path;
    if (input.copy) {
      const dir = readRegistry().dir;
      if (!dir) throw new UserError("Choose where models are stored first: testimus models setDir <folder>.");
      where = installPath(dir, entry);
      if (existsSync(where)) throw new UserError(`${where} already exists.`, "Register that folder instead.");
      await copyInto(path, where, ctx);
    }
    if (!isFile && !filesPresent(where, filesFor(entry)) && !isComplete(where, entry.dtypeByDevice?.cpu))
      throw new UserError(`${where} lacks files of ${entry.label}.`);
    const gguf = isGguf(entry);
    const machine = await machineProfile().catch(() => null);
    const install: Installation = {
      model: entry.id,
      via: "path",
      runtime: gguf ? "llamacpp" : "transformers",
      path: where,
      ...(entry.source.hf ? { revision: entry.source.hf.revision } : {}),
      ...(gguf && entry.source.file ? { sha256: entry.source.file.sha256 } : {}),
      ...(gguf ? {} : { dtype: entry.dtypeByDevice?.[deviceOf(entry, machine)] ?? entry.dtypeByDevice?.cpu }),
      device: deviceOf(entry, machine),
      status: "installed",
    };
    const probe = await probeInstall(entry, install);
    if (probe.ok) {
      install.status = "verified";
      install.verifiedAt = env.now().toISOString();
      install.dims = probe.dims;
    } else ctx?.log("warn", `${entry.label} registered but not verified: ${probe.message}`);
    putInstall(install);
    out ??= { model: entry.id, via: "path", path: where, dims: probe.dims, state: install.status };
  }
  if (!out) throw new UserError(`${path} matches no catalog entry.`);
  return out;
}

async function copyInto(from: string, to: string, ctx?: Ctx): Promise<void> {
  const total = sizeOf(from);
  let done = 0;
  const signal = ctx?.signal ?? new AbortController().signal;
  await copyTree(from, to, signal, (n) => {
    done += n;
    ctx?.progress({ message: `Copying ${basename(from)}`, done: Math.round(done / MB), total: Math.round(total / MB) });
  });
}

// --- Path B and C

export type PullInput = { model: string; via: "auto" | "download" | "ollama"; dir?: string; dtype?: string };
export type PullResult = { model: string; via: string; where: string; sizeMB: number; state: InstallState };

export const NO_DIR = "Choose where models are stored: `testimus models setDir <folder>`";

export async function pull(ctx: Ctx, input: PullInput): Promise<PullResult> {
  const entry = needEntry(input.model);
  const tag = entry.source.ollama;
  if (input.via !== "download" && tag && entry.runtimes.includes("ollama") && ollamaMode() !== "never") {
    const s = await installDeps.ollama();
    const held = s?.state === "running" ? s.models.find((m) => m.name === tag || m.catalogId === entry.id) : undefined;
    if (held || (input.via === "ollama" && s?.state === "running")) {
      const digest = held
        ? held.digest
        : (
            await installDeps.ollamaPull(
              tag,
              (p) => ctx.progress({ message: `Ollama ${tag}: ${p.status}`, done: p.completed, total: p.total }),
              ctx.signal,
            )
          ).digest;
      putInstall({ model: entry.id, via: "ollama", runtime: "ollama", ollama: tag, digest, status: "installed" });
      return {
        model: entry.id,
        via: "ollama",
        where: `Ollama ${tag}`,
        sizeMB: held?.sizeMB ?? entry.size.downloadMB,
        state: "installed",
      };
    }
    if (input.via === "ollama")
      throw new UserError(
        `Ollama is not running on this PC (${s?.state ?? "absent"}).`,
        s?.message ?? "Use --via download.",
      );
  }
  if (input.via === "ollama") throw new UserError(`${entry.label} is not served by Ollama.`, "Use --via download.");
  const have = resolveInstalled(entry.id);
  if (have && have.install.via !== "ollama" && have.install.path)
    return {
      model: entry.id,
      via: have.install.via,
      where: have.install.path,
      sizeMB: Math.round(bytesOf(entry, have.install) / MB),
      state: have.install.status,
    };
  const r = readRegistry();
  if (!r.allowRemote)
    throw new UserError(
      `${entry.label} is not on this PC and downloads are off (allowRemote = false).`,
      "Copy it from the team share and register it: testimus models add <folder>.",
    );
  if (!entry.source.hf) throw new UserError(`${entry.label} has no Hugging Face source.`);
  let dir = r.dir;
  if (input.dir) {
    const plan = planSetDir({
      dir: input.dir,
      runtimes: false,
      move: false,
      keep: !!r.dir,
      copy: false,
      dryRun: false,
    });
    if (!r.dir) await applySetDir(plan, { signal: ctx.signal, onProgress: () => {} });
    dir = plan.dir;
  }
  if (!dir) throw new UserError(NO_DIR, "Or give --dir <folder> on this command.");
  const machine = await machineProfile().catch(() => null);
  const device = deviceOf(entry, machine);
  const dtype = (input.dtype as Dtype | undefined) ?? entry.dtypeByDevice?.[device] ?? entry.dtypeByDevice?.cpu;
  const gguf = isGguf(entry);
  let lastPct = -1;
  const res = await pullFiles(
    entry,
    dir,
    {
      dtype,
      signal: ctx.signal,
      onProgress: (done, total, file) => {
        const pct = total ? Math.floor((done / total) * 100) : 0;
        if (pct === lastPct) return;
        lastPct = pct;
        ctx.progress({
          message: `${entry.label}: ${file}`,
          done: Math.round(done / MB),
          total: Math.round(total / MB),
        });
      },
    },
    downloadDeps,
  );
  putInstall({
    model: entry.id,
    via: "download",
    runtime: gguf ? "llamacpp" : "transformers",
    path: res.path,
    revision: entry.source.hf.revision,
    ...(gguf && entry.source.file ? { sha256: entry.source.file.sha256 } : {}),
    ...(!gguf && dtype ? { dtype } : {}),
    device,
    status: "installed",
  });
  return { model: entry.id, via: "download", where: res.path, sizeMB: Math.round(res.bytes / MB), state: "installed" };
}

// --- verify, remove, list

export async function verify(
  model: string,
): Promise<{ model: string; ok: boolean; dims: number; ms: number; message: string }> {
  const entry = needEntry(model);
  const m = resolveInstalled(entry.id);
  if (!m) return { model: entry.id, ok: false, dims: 0, ms: 0, message: `${entry.label} is not installed on this PC.` };
  if (m.install.path && entry.source.file && isGguf(entry)) {
    const ok = await checkFile(m.install.path, { path: entry.source.hf?.path ?? "", ...entry.source.file });
    if (!ok) {
      markInstall(entry.id, m.install, "broken");
      return {
        model: entry.id,
        ok: false,
        dims: 0,
        ms: 0,
        message: `${m.install.path} is missing or changed (SHA-256).`,
      };
    }
  }
  const p = await probeInstall(entry, m.install);
  markInstall(entry.id, m.install, p.ok ? "verified" : m.install.status, p.ok ? p.dims : undefined);
  return { model: entry.id, ...p };
}

function markInstall(model: string, install: Installation, status: InstallState, dims?: number): void {
  const r = readRegistry();
  const known = r.installs.some((i) => i.model === model && i.via === install.via);
  if (!known && status === install.status) return;
  putInstall({
    ...install,
    status,
    ...(status === "verified" ? { verifiedAt: env.now().toISOString() } : {}),
    ...(dims ? { dims } : {}),
  });
}

// ponytail: two variants of one Hugging Face repo share its folder; a removal deletes only the files no other installation uses
function deleteDownload(entry: CatalogEntry, inst: Installation, r: ModelsRegistry): number {
  const path = inst.path;
  if (!path || !existsSync(path)) return 0;
  const root = r.dir && inside(path, r.dir) ? r.dir : dirname(path);
  const others = r.installs.filter((i) => i !== inst && i.via !== "ollama" && i.path && norm(i.path) === norm(path));
  const drop = (p: string): number => {
    let n = 0;
    for (const x of [p, `${p}.part`])
      if (existsSync(x)) {
        n += sizeOf(x);
        rmSync(x, { recursive: true, force: true });
      }
    pruneEmpty(dirname(p), root);
    return n;
  };
  const own = statSync(path).isFile() ? [] : filesFor(entry, inst.dtype);
  if (!own.length) return others.length ? 0 : drop(path);
  const unknown = others.some((i) => !catalogEntry(i.model));
  const keep = new Set(
    others.flatMap((i) => {
      const e = catalogEntry(i.model);
      return e ? filesFor(e, i.dtype).map((f) => f.path) : [];
    }),
  );
  let freed = 0;
  for (const f of own)
    if (!keep.has(f.path) && (!unknown || f.path.startsWith("onnx/"))) freed += drop(join(path, ...f.path.split("/")));
  return freed;
}

function bytesOf(entry: CatalogEntry, i: Installation): number {
  const path = i.path;
  if (!path || !existsSync(path)) return 0;
  const own = statSync(path).isFile() ? [] : filesFor(entry, i.dtype);
  if (!own.length) return sizeOf(path);
  return own.reduce((a, f) => a + sizeOf(join(path, ...f.path.split("/"))), 0);
}

export async function remove(
  model: string,
  confirm: boolean,
): Promise<{ model: string; removed: "files" | "registration" | "ollama"; freedMB: number }> {
  const entry = needEntry(model);
  const r = readRegistry();
  const mine = r.installs.filter((i) => i.model === entry.id);
  const order = ["download", "path", "ollama"] as const;
  const inst = order.map((v) => mine.find((i) => i.via === v)).find(Boolean);
  if (!inst) throw new UserError(`${entry.label} is not registered on this PC.`, "testimus models list shows what is.");
  if (inst.via === "download") {
    const freed = deleteDownload(entry, inst, r);
    updateRegistry((reg) => {
      reg.installs = reg.installs.filter((i) => !(i.model === entry.id && i.via === "download"));
    });
    return { model: entry.id, removed: "files", freedMB: Math.round(freed / MB) };
  }
  if (inst.via === "path") {
    updateRegistry((reg) => {
      reg.installs = reg.installs.filter((i) => !(i.model === entry.id && i.via === "path"));
    });
    return { model: entry.id, removed: "registration", freedMB: 0 };
  }
  if (!confirm)
    throw new UserError(
      `${entry.label} is Ollama's (${inst.ollama}): Ollama will delete its files.`,
      "Confirm with --confirm.",
    );
  if (inst.ollama) await installDeps.ollamaDelete(inst.ollama);
  updateRegistry((reg) => {
    reg.installs = reg.installs.filter((i) => !(i.model === entry.id && i.via === "ollama"));
  });
  return { model: entry.id, removed: "ollama", freedMB: entry.size.downloadMB };
}

export function usedBy(model: string): string[] {
  const out: string[] = [];
  for (const [project, choice] of Object.entries(readSettings().rag?.byProject ?? {})) {
    const v = choice.variant ?? ("embedding" in choice ? choice : null);
    const variants = v ? [v] : "pack" in choice ? (pack(choice.pack)?.variants ?? []) : [];
    if (variants.some((x) => x.embedding === model || x.reranker === model)) out.push(project);
  }
  return out;
}

export type ListRow = {
  model: string;
  label: string;
  via: "path" | "download" | "ollama";
  runtime: string;
  where: string;
  sizeMB: number;
  state: InstallState;
  usedBy: string[];
  perf?: string;
};

export async function list(ollama?: OllamaStatus | null): Promise<ListRow[]> {
  const stats = perfStats({ last: 50 });
  const rows: ListRow[] = [];
  const seen = new Set<string>();
  const add = (entry: CatalogEntry, install: Installation, sizeMB: number) => {
    const key = `${entry.id}|${install.via}`;
    if (seen.has(key)) return;
    seen.add(key);
    const users = usedBy(entry.id);
    const perf = speedLine(entry.id, stats);
    rows.push({
      model: entry.id,
      label: entry.label,
      via: install.via,
      runtime: install.runtime,
      where: install.path ?? (install.ollama ? `Ollama ${install.ollama}` : ""),
      sizeMB,
      state: install.status === "broken" ? "broken" : users.length ? "active" : install.status,
      usedBy: users,
      ...(perf ? { perf } : {}),
    });
  };
  for (const i of readRegistry().installs) {
    const entry = catalogEntry(i.model);
    if (!entry) continue;
    const gone = i.via !== "ollama" && (!i.path || !existsSync(i.path));
    add(
      entry,
      gone ? { ...i, status: "broken" } : i,
      i.path ? Math.round(bytesOf(entry, i) / MB) : entry.size.downloadMB,
    );
  }
  for (const entry of catalog().entries) {
    const m = resolveInstalled(entry.id);
    if (m?.install.path && m.install.via === "path") add(entry, m.install, Math.round(bytesOf(entry, m.install) / MB));
  }
  const s = ollama === undefined ? await installDeps.ollama() : ollama;
  if (s?.state === "running")
    for (const m of s.models) {
      const entry = catalog().entries.find((e) => e.source.ollama === m.name);
      if (entry)
        add(
          entry,
          { model: entry.id, via: "ollama", runtime: "ollama", ollama: m.name, digest: m.digest, status: "installed" },
          m.sizeMB,
        );
    }
  return rows;
}

export async function catalogView(kind?: "embedding" | "reranker", machine?: MachineProfile) {
  const m = machine ?? (await machineProfile());
  const installed = await list(null);
  const { budgets } = await import("./models-registry.ts");
  const headroom = budgets().headroom;
  return catalog()
    .entries.filter((e) => !kind || e.kind === kind)
    .map((e) => {
      const rows = installed.filter((r) => r.model === e.id);
      const state: InstallState = rows.find((r) => r.state === "active")
        ? "active"
        : rows.find((r) => r.state === "verified")
          ? "verified"
          : rows.find((r) => r.state === "installed")
            ? "installed"
            : rows.length
              ? rows[0].state
              : "available";
      return {
        id: e.id,
        kind: e.kind,
        label: e.label,
        tier: e.tier,
        runtimes: e.runtimes,
        quantization: e.quantization,
        dims: e.dims,
        sizeMB: e.size.downloadMB,
        state,
        fit: fitOf([e], m, { headroom }),
      };
    });
}
