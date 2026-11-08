import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { CatalogEntry, Installation, InstallState } from "../types.ts";
import { deviceOf, isGguf } from "./fit/placement.ts";
import { machineProfile } from "./machine/profile.ts";
import { catalog, needEntry } from "./models-catalog.ts";
import { copyTree } from "./models-dir.ts";
import { filesFor, filesPresent, hashFile, installPath } from "./models-download.ts";
import { installDeps, NO_DIR, NO_DIR_CODE, probeInstall, sizeOf } from "./models-install.ts";
import { putInstall, readRegistry, updateRegistry } from "./models-registry.ts";
import { isComplete } from "./models-store.ts";

const MB = 1024 * 1024;

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
  if (!isAbsolute(input.path))
    throw new UserError(`${input.path} is not an absolute path.`, "Give the full path, e.g. D:\\models\\bge-m3.");
  const path = resolve(input.path);
  if (!existsSync(path))
    throw new UserError(`${path} does not exist.`, "Check the path; a share must be reachable from this PC.");
  const isFile = statSync(path).isFile();
  if (!isFile && existsSync(join(path, "llama-server.exe"))) {
    const build = await installDeps.findLlamaBuild(path);
    if (!build)
      throw new UserError(
        `${path} holds llama-server.exe but its build could not be read.`,
        "Give the folder of an official llama.cpp release, or let Testimus download one: testimus models pullRuntime.",
      );
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
      if (!dir) throw new UserError(NO_DIR, "Or register it in place, without --copy.", NO_DIR_CODE);
      where = installPath(dir, entry);
      if (existsSync(where)) throw new UserError(`${where} already exists.`, "Register that folder instead.");
      await copyInto(path, where, ctx);
    }
    if (!isFile && !filesPresent(where, filesFor(entry)) && !isComplete(where, entry.dtypeByDevice?.cpu))
      throw new UserError(`${where} lacks files of ${entry.label}.`, "Copy the whole model folder, then add it again.");
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
  if (!out) throw new UserError(`${path} matches no catalog entry.`, "Name it with --model <catalog id>.");
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
