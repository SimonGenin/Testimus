import { useSyncExternalStore } from "react";
import type { ClaudeRun, DocRef, JobEvent } from "../../core/types.ts";
import { run } from "../api.ts";
import { triageWhenClaude } from "./actions.ts";
import { baseName, pathOf } from "./desktop.ts";
import { message } from "./format.ts";
import { toast } from "./toast.ts";

export type Upload = {
  key: number;
  name: string;
  job: "add" | "convert" | "index";
  phase: "reading" | "adding" | "converting" | "indexing" | "done" | "failed" | "index-failed";
  pct: number | null;
  message: string;
  at: number;
  docId?: string;
  error?: unknown;
};

let items: Upload[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const patch = (key: number, p: Partial<Upload>) => {
  items = items.map((u) => (u.key === key ? { ...u, ...p } : u));
  emit();
};

export function useUploads(): Upload[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => items,
    () => items,
  );
}

export function dismissUpload(key: number): void {
  items = items.filter((u) => u.key !== key);
  emit();
}

export const settled = (u: Upload) => u.phase === "done" || u.phase === "failed" || u.phase === "index-failed";

// ponytail: the list can show a document whose add has not returned its id yet — the file name ties them
export const owns = (u: Upload, d: DocRef) =>
  !settled(u) &&
  (u.docId
    ? u.docId === d.id
    : u.job === "add" && baseName(d.source.path.replace(/^upload: /, "")).toLowerCase() === u.name.toLowerCase());

// ponytail: a finished or failed row is shown once — leaving the screen forgets it; the job stays in Jobs
export function forgetSettled(): void {
  if (!items.some(settled)) return;
  items = items.filter((u) => !settled(u));
  emit();
}

export const readBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("The file could not be read."));
    r.readAsDataURL(file);
  });

const stem = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();

const progressOf = (key: number, phase: Upload["phase"]) => (e: JobEvent) => {
  if (e.type !== "progress") return;
  const pct = e.total ? Math.round(((e.done ?? 0) / e.total) * 100) : null;
  patch(key, { phase, message: e.message, pct });
};

// ponytail: the model and effort picked on the Documents screen stay for every add and reindex until the app is
// closed; unpicked, the core keeps its defaults (project model / low for figures, haiku / low for headers)
let claude: ClaudeRun = {};
export const importClaude = () => claude;
export const setImportClaude = (next: ClaudeRun) => {
  claude = next;
};

const conversions = new Set<Promise<unknown>>();
let indexing: Promise<unknown> | null = null;
let waiting: { keys: number[]; done: Promise<unknown> } | null = null;

function startIndex(keys: number[], note?: string, after?: string): Promise<unknown> {
  const onEvent = (e: JobEvent) => {
    for (const k of keys) progressOf(k, "indexing")(e);
  };
  const cause = after ? { jobId: after, why: "follow-up" as const } : undefined;
  indexing = run("rag.index", { ...claude, ...(note ? { note } : {}) }, onEvent, undefined, cause).finally(() => {
    indexing = null;
  });
  return indexing;
}

// ponytail: an index run reads every document when it starts, so it never starts while a conversion is still
// writing one, nor joins a run that read it too early: it waits for both, and the requests made meanwhile share it
async function reindex(key: number, note?: string, after?: string): Promise<void> {
  const ready = !indexing && !conversions.size;
  patch(key, {
    phase: "indexing",
    pct: null,
    message: ready ? "Indexing" : conversions.size ? "Waiting for the other conversions" : "Waiting for the index run",
  });
  if (waiting) {
    waiting.keys.push(key);
    await waiting.done;
    return;
  }
  if (ready) {
    await startIndex([key], note, after);
    return;
  }
  const keys = [key];
  const done = (async () => {
    while (indexing || conversions.size) await Promise.allSettled([indexing, ...conversions]);
    waiting = null;
    return startIndex(keys, note, after);
  })();
  waiting = { keys, done };
  await done;
}

// ponytail: adding only copies the file — the team sets status, amends and context, then converts it on purpose
async function addOne(key: number, input: Record<string, unknown>, onDone: (docId?: string) => void) {
  try {
    patch(key, { phase: "adding", message: "Adding", pct: null });
    const doc = await run<{ id: string }>("docs.add", { ...input, convert: false }, progressOf(key, "adding"));
    dismissUpload(key);
    onDone(doc?.id);
  } catch (e) {
    patch(key, { phase: "failed", message: message(e), error: e });
    onDone();
  }
}

export type JobContext = { note?: string; contexts?: string[] };

export async function convertDoc(
  id: string,
  name: string,
  job: JobContext & { describeFigures?: boolean; study?: boolean },
  onDone: () => void,
): Promise<void> {
  const key = ++seq;
  items = [
    ...items,
    { key, name, job: "convert", docId: id, at: Date.now(), phase: "converting", pct: null, message: "Converting" },
  ];
  emit();
  const extra = { ...(job.note?.trim() ? { note: job.note.trim() } : {}), contexts: job.contexts ?? [] };
  let jobId = "";
  try {
    const converting: Promise<{ id: string; warnings?: string[] }> = run<{ id: string; warnings?: string[] }>(
      "docs.convert",
      {
        id,
        ...claude,
        ...extra,
        ...(job.describeFigures !== undefined && { describeFigures: job.describeFigures }),
        ...(job.study && { study: true }),
      },
      progressOf(key, "converting"),
      (started) => {
        jobId = started;
      },
    ).finally(() => conversions.delete(converting));
    conversions.add(converting);
    const doc = await converting;
    if (doc?.warnings?.length && !job.study) triageWhenClaude({ docId: id, ...claude, ...extra }, jobId);
  } catch (e) {
    patch(key, { phase: "failed", message: message(e), error: e });
    onDone();
    return;
  }
  onDone();
  try {
    await reindex(key, extra.note, jobId);
    patch(key, { phase: "done", message: "Converted and indexed", pct: 100 });
    setTimeout(() => dismissUpload(key), 4000);
  } catch (e) {
    patch(key, { phase: "index-failed", message: message(e), error: e });
  }
  onDone();
}

type Picked = { name: string; path: string; file?: File };

export const addDocFiles = (files: File[], onDone: (docId?: string) => void) =>
  addDocs(
    files.map((f) => ({ name: f.name, path: pathOf(f), file: f })),
    onDone,
  );

export const addDocPaths = (paths: string[], onDone: (docId?: string) => void) =>
  addDocs(
    paths.map((p) => ({ name: baseName(p), path: p })),
    onDone,
  );

async function sourceOf(p: Picked, path: string, name: string, data: string): Promise<Record<string, string>> {
  if (p.path) return { [path]: p.path };
  if (!p.file) throw new Error(`${p.name} could not be read.`);
  return { [name]: p.name, [data]: await readBase64(p.file) };
}

async function addDocs(picked: Picked[], onDone: (docId?: string) => void): Promise<void> {
  const docs = picked.filter((f) => /\.(docx|pdf)$/i.test(f.name));
  const rejected = picked.filter((f) => !docs.includes(f));
  if (rejected.length)
    toast({
      kind: "error",
      title: "Only Word (.docx) and PDF files can be added",
      detail: rejected.map((f) => f.name).join(", "),
    });
  const words = docs.filter((f) => /\.docx$/i.test(f.name));
  const pdfs = docs.filter((f) => /\.pdf$/i.test(f.name));
  const paired = new Set<Picked>();
  const jobs: Promise<void>[] = [];
  for (const f of [...words, ...pdfs]) {
    if (paired.has(f)) continue;
    const key = ++seq;
    items = [
      ...items,
      f.path
        ? { key, name: f.name, job: "add", at: Date.now(), phase: "adding", pct: null, message: "Adding" }
        : { key, name: f.name, job: "add", at: Date.now(), phase: "reading", pct: null, message: "Reading the file" },
    ];
    emit();
    const pdf = /\.docx$/i.test(f.name) ? pdfs.find((p) => stem(p.name) === stem(f.name)) : undefined;
    if (pdf) paired.add(pdf);
    jobs.push(
      (async () => {
        try {
          const input: Record<string, unknown> = await sourceOf(f, "file", "name", "dataBase64");
          if (pdf) Object.assign(input, await sourceOf(pdf, "pdf", "pdfName", "pdfBase64"));
          await addOne(key, input, onDone);
        } catch (e) {
          patch(key, { phase: "failed", message: message(e), error: e });
        }
      })(),
    );
  }
  await Promise.all(jobs);
}

export async function addDocPath(path: string, onDone: (docId?: string) => void): Promise<void> {
  const key = ++seq;
  const name = path.split(/[\\/]/).pop() || path;
  items = [...items, { key, name, job: "add", at: Date.now(), phase: "adding", pct: null, message: "Adding" }];
  emit();
  await addOne(key, { file: path }, onDone);
}

export async function reindexAll(onDone: () => void): Promise<void> {
  const key = ++seq;
  items = [
    ...items,
    { key, name: "All documents", job: "index", at: Date.now(), phase: "indexing", pct: null, message: "Indexing" },
  ];
  emit();
  try {
    await reindex(key);
    patch(key, { phase: "done", message: "Index up to date", pct: 100 });
    setTimeout(() => dismissUpload(key), 4000);
  } catch (e) {
    patch(key, { phase: "index-failed", message: message(e), error: e });
  } finally {
    onDone();
  }
}
