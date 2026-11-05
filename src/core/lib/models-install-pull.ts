import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import type { CatalogEntry, Dtype, InstallState } from "../types.ts";
import { deviceOf, isGguf } from "./fit/placement.ts";
import { machineProfile } from "./machine/profile.ts";
import { applySetDir, planSetDir } from "./models-dir.ts";
import { downloadDeps, pullFiles } from "./models-download.ts";
import { bytesOf, NO_DIR, NO_DIR_CODE, needEntry } from "./models-install.ts";
import { downloadsAllowed, putInstall, readRegistry } from "./models-registry.ts";
import { resolveInstalled } from "./models-resolve.ts";

const MB = 1024 * 1024;

export type PullInput = { model: string; dir?: string; dtype?: string };
export type PullResult = { model: string; via: string; where: string; sizeMB: number; state: InstallState };

const pulling = new Map<string, Promise<PullResult>>();

export async function pull(ctx: Ctx, input: PullInput): Promise<PullResult> {
  const entry = needEntry(input.model);
  for (let prev = pulling.get(entry.id); prev; prev = pulling.get(entry.id)) {
    ctx.signal.throwIfAborted();
    ctx.progress({ message: `${entry.label}: waiting for the download already running` });
    await Promise.race([
      prev.catch(() => {}),
      new Promise((_, no) => ctx.signal.addEventListener("abort", () => no(ctx.signal.reason), { once: true })),
    ]);
  }
  const p = pullOnce(ctx, input, entry);
  pulling.set(entry.id, p);
  try {
    return await p;
  } finally {
    if (pulling.get(entry.id) === p) pulling.delete(entry.id);
  }
}

async function pullOnce(ctx: Ctx, input: PullInput, entry: CatalogEntry): Promise<PullResult> {
  const have = resolveInstalled(entry.id);
  if (have?.install.path)
    return {
      model: entry.id,
      via: have.install.via,
      where: have.install.path,
      sizeMB: Math.round(bytesOf(entry, have.install) / MB),
      state: have.install.status,
    };
  const r = readRegistry();
  if (!downloadsAllowed())
    throw new UserError(
      `${entry.label} is not on this PC and downloads are off (allowRemote = false).`,
      "Copy it from the team share and register it: testimus models add <folder>.",
    );
  if (!entry.source.hf)
    throw new UserError(
      `${entry.label} has no Hugging Face source.`,
      "Register a copy you have: testimus models add <path>.",
    );
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
  if (!dir) throw new UserError(NO_DIR, "Or give --dir <folder> on this command.", NO_DIR_CODE);
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
