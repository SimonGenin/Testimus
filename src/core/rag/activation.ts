import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../env.ts";
import { catalogEntry, pack as packOf } from "../lib/models-catalog.ts";
import { DEFAULT_QUERY_TASK, resolveChoice, resolveInstalled } from "../lib/models-resolve.ts";
import { readProject, readSettings, writeSettings } from "../lib/project.ts";
import type { ActiveChoice, Pack, PackVariant, RagChoice, ResolvedModel, RetrievalSettings } from "../types.ts";

export type ActivationSource = "machine" | "reference" | "project" | "light" | "none";
export type ActiveModels = {
  embedding: ResolvedModel | null;
  reranker: ResolvedModel | null;
  choice: ActiveChoice | null;
  source: ActivationSource;
  pack?: Pack;
  retrieval?: Partial<RetrievalSettings>;
  missing: string[];
};

export function projectKey(project: string): string {
  let p = resolve(project);
  try {
    p = realpathSync.native(p);
  } catch {}
  return process.platform === "win32" ? p.toLowerCase() : p;
}

export function activeChoice(project: string): ActiveChoice | null {
  return readSettings().rag?.byProject?.[projectKey(project)] ?? null;
}

export function setActiveChoice(project: string, choice: ActiveChoice | RagChoice | null): void {
  const s = readSettings();
  const byProject = { ...s.rag?.byProject };
  if (choice) byProject[projectKey(project)] = choice;
  else delete byProject[projectKey(project)];
  writeSettings({ ...s, rag: { ...s.rag, byProject } });
}

export function queryTaskOf(project: string): string {
  return readProject(project).rag.queryTask?.trim() || DEFAULT_QUERY_TASK;
}

// ponytail: under --mock every catalog model is "installed" and served by the mock runtime
function mockResolved(id: string, queryTask: string): ResolvedModel | null {
  const entry = catalogEntry(id);
  if (!entry) return null;
  const dtype = entry.dtypeByDevice?.cpu;
  return {
    entry,
    install: { model: entry.id, via: "path", runtime: "mock", dtype, device: "cpu", status: "installed" },
    runtime: "mock",
    device: "cpu",
    dtype,
    queryTask,
  };
}

export function resolveModel(id: string, queryTask = DEFAULT_QUERY_TASK): ResolvedModel | null {
  return env.mock ? mockResolved(id, queryTask) : resolveInstalled(id, queryTask);
}

type Resolved = { embedding: ResolvedModel | null; reranker: ResolvedModel | null; variant: PackVariant | null };

function resolvePair(v: PackVariant, queryTask: string): Resolved {
  return {
    embedding: resolveModel(v.embedding, queryTask),
    reranker: v.reranker ? resolveModel(v.reranker, queryTask) : null,
    variant: v,
  };
}

async function resolveAny(choice: RagChoice, queryTask: string): Promise<Resolved> {
  const variants = "pack" in choice ? (packOf(choice.pack)?.variants ?? []) : [choice];
  if (!env.mock) {
    const r = await resolveChoice(choice, queryTask);
    if (r.embedding || r.variant) return { embedding: r.embedding, reranker: r.reranker, variant: r.variant };
  }
  for (const v of variants) {
    const r = resolvePair(v, queryTask);
    if (r.embedding) return r;
  }
  return { embedding: null, reranker: null, variant: null };
}

export async function activeModels(project: string): Promise<ActiveModels> {
  const rag = readProject(project).rag;
  const queryTask = queryTaskOf(project);
  const steps: [ActivationSource, RagChoice | null][] = [
    ["machine", activeChoice(project)],
    ["reference", rag.reference ?? null],
    ["project", rag.embedding ? { embedding: rag.embedding, reranker: rag.reranker ?? null } : null],
    ["light", { pack: "light" }],
  ];
  const missing: string[] = [];
  for (const [source, choice] of steps) {
    if (!choice) continue;
    const r = await resolveAny(choice, queryTask);
    if (!r.embedding) {
      missing.push("pack" in choice ? `pack ${choice.pack}` : choice.embedding);
      continue;
    }
    const wanted = r.variant?.reranker ?? null;
    const reranker = r.reranker;
    if (wanted && !reranker) missing.push(wanted);
    const pack = "pack" in choice ? packOf(choice.pack) : undefined;
    return {
      embedding: r.embedding,
      reranker,
      choice: r.variant && "pack" in choice ? { ...choice, variant: r.variant } : choice,
      source,
      ...(pack ? { pack } : {}),
      ...(pack?.retrieval ? { retrieval: pack.retrieval } : {}),
      missing,
    };
  }
  return { embedding: null, reranker: null, choice: null, source: "none", missing };
}
