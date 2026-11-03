import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type {
  CatalogEntry,
  Installation,
  InstallState,
  LlamaRuntime,
  MachineProfile,
  ModelsRegistry,
  ResolvedModel,
} from "../types.ts";
import { catalog, catalogEntry, pack } from "./models-catalog.ts";
import { inside, norm, pruneEmpty } from "./models-dir.ts";
import { checkFile, filesFor } from "./models-download.ts";
import { fitOf } from "./models-fit.ts";
import { machineProfile } from "./models-hardware.ts";
import { opSignal, perfStats, speedLine } from "./models-perf.ts";
import { budgets, putInstall, readRegistry, updateRegistry } from "./models-registry.ts";
import { isGguf, resolveInstalled } from "./models-resolve.ts";
import { readSettings } from "./project.ts";

const MB = 1024 * 1024;

// ponytail: a seam env does not have — loading a model to try it (seconds, real weights) and reading a llama.cpp
// build; --mock answers the probe like a load on this machine, the tests make it fail
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
  findLlamaBuild: async (dir: string): Promise<LlamaRuntime | null> =>
    (await import("../rag/runtimes/llamacpp.ts")).findLlamaBuild(dir),
};

export function needEntry(id: string): CatalogEntry {
  const e = catalogEntry(id);
  if (!e) throw new UserError(`Unknown model ${id}.`, "testimus models catalog lists the catalog ids.");
  return e;
}

export function sizeOf(path: string): number {
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

export async function probeInstall(
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

// ponytail: the page recognises « no models folder yet » by this code and opens the folder dialog
export const NO_DIR = "Choose where models are stored: `testimus models setDir <folder>`";
export const NO_DIR_CODE = "models-dir-unset";

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
  const others = r.installs.filter((i) => i !== inst && i.path && norm(i.path) === norm(path));
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

export function bytesOf(entry: CatalogEntry, i: Installation): number {
  const path = i.path;
  if (!path || !existsSync(path)) return 0;
  const own = statSync(path).isFile() ? [] : filesFor(entry, i.dtype);
  if (!own.length) return sizeOf(path);
  return own.reduce((a, f) => a + sizeOf(join(path, ...f.path.split("/"))), 0);
}

export async function remove(
  model: string,
): Promise<{ model: string; removed: "files" | "registration"; freedMB: number }> {
  const entry = needEntry(model);
  const r = readRegistry();
  const mine = r.installs.filter((i) => i.model === entry.id);
  const order = ["download", "path"] as const;
  const inst = order.map((v) => mine.find((i) => i.via === v)).find(Boolean);
  if (!inst) throw new UserError(`${entry.label} is not registered on this PC.`, "testimus models list shows what is.");
  if (inst.via === "download") {
    const freed = deleteDownload(entry, inst, r);
    updateRegistry((reg) => {
      reg.installs = reg.installs.filter((i) => !(i.model === entry.id && i.via === "download"));
    });
    return { model: entry.id, removed: "files", freedMB: Math.round(freed / MB) };
  }
  updateRegistry((reg) => {
    reg.installs = reg.installs.filter((i) => !(i.model === entry.id && i.via === "path"));
  });
  return { model: entry.id, removed: "registration", freedMB: 0 };
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
  via: "path" | "download";
  runtime: string;
  where: string;
  sizeMB: number;
  state: InstallState;
  usedBy: string[];
  perf?: string;
};

export function list(): ListRow[] {
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
      where: install.path ?? "",
      sizeMB,
      state: install.status === "broken" ? "broken" : users.length ? "active" : install.status,
      usedBy: users,
      ...(perf ? { perf } : {}),
    });
  };
  for (const i of readRegistry().installs) {
    const entry = catalogEntry(i.model);
    if (!entry) continue;
    const gone = !i.path || !existsSync(i.path);
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
  return rows;
}

export async function catalogView(kind?: "embedding" | "reranker", machine?: MachineProfile) {
  const m = machine ?? (await machineProfile());
  const installed = list();
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
