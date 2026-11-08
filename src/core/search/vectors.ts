import { statSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../command.ts";
import { sha256 } from "../lib/hash.ts";
import { readJson, writeJson } from "../lib/project.ts";
import { activeModels } from "../rag/activation.ts";
import { spaceId } from "../rag/db.ts";
import { embedWith } from "../rag/embed.ts";
import { fingerprintOf } from "../rag/fingerprint.ts";
import type { ResolvedModel, SearchUse, Test } from "../types.ts";
import { type TestDoc, testsCorpus } from "./tests.ts";

// ponytail: the tests' vectors, kept in index/tests-vectors.json with the active embedding — a test's words are read from
// its file at search time, never indexed
export const TESTS_INDEX: SearchUse = {
  id: "tests-index",
  who: "The vectors of the tests",
  when: "After tests change (a few at search time, the rest in a job)",
  words: "no",
  embedding: "builds",
  reranker: "no",
  why: "ranking happens at search time",
};

type Store = { space: string; model: string; tests: Record<string, { hash: string; v: string }> };

const BATCH = 16;
const MAX_CHARS = 2000;
// ponytail: a handful of edited tests are embedded during the search itself; more waits for search.index
export const INLINE = 24;

export const vectorsFile = (project: string) => join(project, "index", "tests-vectors.json");

export function embedText(t: Test): string {
  const steps = t.steps.map((s, i) =>
    [`${i + 1}.`, s.fields.Action, s.fields["Expected Result"]].filter((x) => x?.trim()).join(" "),
  );
  return [t.summary, t.description, ...steps]
    .filter((x) => x.trim())
    .join("\n")
    .slice(0, MAX_CHARS);
}

const toB64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
const fromB64 = (s: string) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

const decoded = new Map<string, Map<string, Float32Array>>();

function vectorOf(store: Store, id: string): Float32Array {
  const byKey = decoded.get(store.space) ?? new Map<string, Float32Array>();
  decoded.set(store.space, byKey);
  const e = store.tests[id];
  const k = `${id}@${e.hash}`;
  let v = byKey.get(k);
  if (!v) {
    v = fromB64(e.v);
    byKey.set(k, v);
  }
  return v;
}

const stores = new Map<string, { at: number; store: Store | null }>();

function readStore(project: string, space: string, model: string): Store {
  const file = vectorsFile(project);
  let at = 0;
  try {
    at = statSync(file).mtimeMs;
  } catch {}
  let hit = stores.get(file);
  if (!hit || hit.at !== at) {
    hit = { at, store: at ? readJson<Store | null>(file, null) : null };
    stores.set(file, hit);
  }
  const s = hit.store;
  return s && s.space === space ? s : { space, model, tests: {} };
}

type Embedder = { model: ResolvedModel; space: string } | { degraded: string };

async function embedder(project: string): Promise<Embedder> {
  try {
    const m = (await activeModels(project)).embedding;
    if (!m) return { degraded: "No embedding model on this PC: tests are found by their words only." };
    return { model: m, space: spaceId(fingerprintOf(m)) };
  } catch (e) {
    return { degraded: `The embedding model is not usable (${e instanceof Error ? e.message : String(e)}).` };
  }
}

function stale(store: Store, docs: TestDoc[]): { doc: TestDoc; text: string; hash: string }[] {
  return docs
    .map((doc) => {
      const text = embedText(doc.test);
      return { doc, text, hash: sha256(text) };
    })
    .filter((x) => x.text && store.tests[x.doc.id]?.hash !== x.hash);
}

type EmbedReport = { model: string; embedded: number; total: number; degraded?: string };

export async function embedTests(project: string, ctx?: Ctx, limit = Number.POSITIVE_INFINITY): Promise<EmbedReport> {
  const e = await embedder(project);
  const docs = testsCorpus(project).docs;
  if ("degraded" in e) return { model: "", embedded: 0, total: docs.length, degraded: e.degraded };
  const read = readStore(project, e.space, e.model.entry.id);
  const store: Store = { ...read, tests: { ...read.tests } };
  const ids = new Set(docs.map((d) => d.id));
  let changed = false;
  for (const id of Object.keys(store.tests))
    if (!ids.has(id)) {
      delete store.tests[id];
      changed = true;
    }
  const todo = stale(store, docs);
  if (todo.length > limit) {
    if (changed) writeJson(vectorsFile(project), store);
    return { model: e.model.entry.id, embedded: 0, total: docs.length };
  }
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (ctx?.signal.aborted) break;
    const batch = todo.slice(i, i + BATCH);
    ctx?.progress({ message: `Embedding tests ${i + 1}–${i + batch.length}`, done: i, total: todo.length });
    const vs = await embedWith(
      e.model,
      batch.map((b) => b.text),
      "doc",
    );
    batch.forEach((b, j) => {
      store.tests[b.doc.id] = { hash: b.hash, v: toB64(vs[j]) };
    });
    done += batch.length;
    writeJson(vectorsFile(project), store);
  }
  if (!todo.length && changed) writeJson(vectorsFile(project), store);
  ctx?.progress({ message: `${done} tests embedded`, done, total: todo.length });
  return { model: e.model.entry.id, embedded: done, total: docs.length };
}

const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

type Nearest = { ranked: [string, number][]; unembedded: number; degraded?: string };

// ponytail: only the tests that already have a vector take part — the others wait for search.index (unembedded
// says how many), a few freshly edited ones are embedded on the way
export async function nearestTests(project: string, query: string, docs: TestDoc[]): Promise<Nearest> {
  const e = await embedder(project);
  if ("degraded" in e) return { ranked: [], unembedded: 0, degraded: e.degraded };
  let store = readStore(project, e.space, e.model.entry.id);
  let todo = stale(store, testsCorpus(project).docs);
  if (todo.length && todo.length <= INLINE) {
    await embedTests(project, undefined, INLINE);
    store = readStore(project, e.space, e.model.entry.id);
    todo = stale(store, testsCorpus(project).docs);
  }
  const [q] = await embedWith(e.model, [query], "query");
  const ranked = docs
    .filter((d) => store.tests[d.id])
    .map((d): [string, number] => [d.id, cosine(q, vectorOf(store, d.id))])
    .sort((a, b) => b[1] - a[1]);
  return { ranked, unembedded: todo.length };
}
