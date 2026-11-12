import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { copyDirAtomic, writeAtomic } from "../lib/atomic.ts";
import { catalog, pack } from "../lib/models-catalog.ts";
import { DEFAULT_QUERY_TASK, resolveChoice } from "../lib/models-resolve.ts";
import type { PackMeasure, PackVariant, RagChoice } from "../types.ts";
import { type EvalReport, runEval } from "./eval.ts";
import type { RetrievalOverride } from "./search/hybrid.ts";

export const REFDOC = {
  id: "syntec",
  title: "Convention collective Syntec",
  articles: 90,
  questions: 100,
  source: "MTEB-French SyntecRetrieval (lyon-nlp, Apache-2.0)",
};

export function refdocSource(): string {
  const dev = fileURLToPath(new URL("../../../templates/reference/", import.meta.url));
  if (existsSync(dev)) return join(dev, REFDOC.id);
  return join(dirname(process.argv[1] ?? "."), "templates", "reference", REFDOC.id);
}

// ponytail: the shipped folder is read-only next to the app; it is measured in a copy on this PC, whose index and
// reports stay between measures (an unchanged document is not embedded again)
export function refdocDir(): string {
  return join(env.localDir(), "reference", REFDOC.id);
}

async function syncRefdoc(): Promise<string> {
  const src = refdocSource();
  if (!existsSync(join(src, "eval", "behaviors.jsonl")))
    throw new UserError(`The reference document is missing from ${src}.`, "Reinstall Testimus.");
  const dir = refdocDir();
  writeAtomic(join(dir, "project.json"), readFileSync(join(src, "project.json")));
  for (const part of ["docs", "eval"]) {
    rmSync(join(dir, part), { recursive: true, force: true });
    await copyDirAtomic(join(src, part), join(dir, part));
  }
  return dir;
}

export async function measureRefdoc(ctx: Ctx, choice: RagChoice): Promise<EvalReport> {
  const r = await resolveChoice(choice, DEFAULT_QUERY_TASK);
  if (!r.variant)
    throw new UserError(
      "pack" in choice ? `The ${choice.pack} pack has no variant this PC can run.` : "These models cannot run here.",
      r.aside.map((a) => `${a.models}: ${a.reason}`).join("; ") || "See Settings › Models.",
    );
  return measureVariant(ctx, r.variant, "pack" in choice ? pack(choice.pack)?.retrieval : undefined);
}

export async function measureVariant(ctx: Ctx, v: PackVariant, retrieval?: RetrievalOverride): Promise<EvalReport> {
  const dir = await syncRefdoc();
  return runEval(
    dir,
    { ...ctx, project: dir },
    { embedding: v.embedding, reranker: v.reranker, ...(retrieval ? { packRetrieval: retrieval } : {}) },
  );
}

export function publishedMeasure(packId: string, embedding: string, reranker: string | null): PackMeasure | null {
  return (
    catalog()
      .packs.find((p) => p.id === packId)
      ?.measured?.find((m) => m.embedding === embedding && m.reranker === reranker) ?? null
  );
}
