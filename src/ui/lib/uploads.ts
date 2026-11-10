import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { ClaudeRun, DocRef, Job } from "../../core/types.ts";
import { ApiError, project, run } from "./data/client.ts";
import { invalidate } from "./data/query.ts";
import { baseName, pathOf } from "./desktop.ts";
import { message } from "./format.ts";
import { useNow } from "./now.ts";
import { useProjectJobs } from "./projectJobs.ts";
import { toast } from "./toast.ts";

export type Upload = {
  key: string;
  name: string;
  job: "add" | "convert" | "index";
  phase: "reading" | "adding" | "waiting" | "converting" | "indexing" | "done" | "failed" | "index-failed";
  pct: number | null;
  message: string;
  docId?: string;
  /** the job behind the row, once it has one (Cancel, « Show the job ») */
  jobId?: string;
  error?: unknown;
  /** a conversion that updates the index once done (the one run shared by the conversions asked for together) */
  index?: boolean;
};

type Local = Upload & { project: string | null /** when the page made the row (ms) */; at: number };

const SHOWN_DONE_MS = 4000;
const KIND: Record<string, Upload["job"]> = { "docs.add": "add", "docs.convert": "convert", "rag-index": "index" };
const NOW: Record<Upload["job"], string> = { add: "Adding", convert: "Converting", index: "Indexing" };

// ponytail: what the page shows of the project's adds, conversions and index runs is their jobs (jobs.list, kept live
// by the event stream); the page keeps only what has no job yet — a file it is still reading, a call refused before its
// job started — and which ended jobs the reader no longer wants to see: those ended before the screen opened, and those
// dismissed
const view = { local: [] as Local[], since: Date.now(), dismissed: new Set<string>(), version: 0 };
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  view.version++;
  for (const l of listeners) l();
};
const patchLocal = (key: string, p: Partial<Local>) => {
  view.local = view.local.map((u) => (u.key === key ? { ...u, ...p } : u));
  emit();
};
const dropLocal = (key: string) => {
  view.local = view.local.filter((u) => u.key !== key);
  emit();
};
const addLocal = (row: Omit<Local, "key" | "project" | "pct" | "at">): string => {
  const key = `local-${++seq}`;
  view.local = [...view.local, { ...row, key, project: project(), pct: null, at: Date.now() }];
  emit();
  return key;
};

export const settled = (u: Upload) => u.phase === "done" || u.phase === "failed" || u.phase === "index-failed";

export function dismissUpload(key: string): void {
  view.dismissed.add(key);
  view.local = view.local.filter((u) => u.key !== key);
  emit();
}

// ponytail: a finished or failed row is shown once — leaving the screen forgets it; the job keeps its log
export function forgetSettled(): void {
  view.since = Date.now();
  view.local = view.local.filter((u) => !settled(u));
  emit();
}

// ponytail: the list can show a document whose add has not returned its id yet — the file name ties them
export const owns = (u: Upload, d: DocRef) =>
  !settled(u) &&
  (u.docId ? u.docId === d.id : u.job === "add" && baseName(d.source.name).toLowerCase() === u.name.toLowerCase());

type Added = { added: { id: string }[]; rejected: { name: string; why: string; code: string }[] };

const percent = (j: Job) => (j.progress?.total ? Math.round(((j.progress.done ?? 0) / j.progress.total) * 100) : null);

function rowsOf(j: Job, now: number, converts: Set<string>): Upload[] {
  const kind = KIND[j.kind];
  const base = { key: j.id, jobId: j.id, job: kind, pct: percent(j), message: j.message ?? NOW[kind] };
  const docId = kind === "convert" ? j.subject : undefined;
  const name = kind === "index" ? "All documents" : j.subject;
  const row = { ...base, name, ...(docId ? { docId } : {}) };
  const recent = !!j.endedAt && now - Date.parse(j.endedAt) < SHOWN_DONE_MS;
  if (j.status === "running") {
    if (kind === "add" && converts.has(j.id) && j.steps?.some((s) => s.id === "convert" && s.status === "running"))
      return [];
    const now = j.steps?.find((s) => s.status === "running")?.id;
    if (kind === "convert" && now === "queue")
      return [
        { ...row, phase: "waiting", message: "Waiting to convert", index: j.steps?.some((s) => s.id === "index") },
      ];
    const indexing = kind === "index" || now === "index";
    const phase = kind === "add" ? "adding" : indexing ? "indexing" : "converting";
    return [{ ...row, phase, ...(kind === "convert" ? { index: j.steps?.some((s) => s.id === "index") } : {}) }];
  }
  if (j.status === "done") {
    if (kind === "add")
      return ((j.result as Added | undefined)?.rejected ?? [])
        .filter((x) => x.code === "failed")
        .map((x) => ({ ...base, key: `${j.id}:${x.name}`, name: x.name, phase: "failed", message: x.why }));
    const indexError = (j.result as { index?: { error?: string } } | undefined)?.index?.error;
    if (indexError) return [{ ...row, phase: "index-failed", message: indexError, pct: null }];
    if (!recent) return [];
    return [
      { ...row, phase: "done", pct: 100, message: kind === "index" ? "Index up to date" : "Converted and indexed" },
    ];
  }
  const why = j.error || (j.status === "cancelled" ? "Cancelled." : "The job failed.");
  return [
    {
      ...row,
      phase: kind === "index" ? "index-failed" : "failed",
      message: why,
      pct: null,
      error: new ApiError(why, j.fix, 0, j.code),
    },
  ];
}

// ponytail: the rows of the jobs, oldest first, then what has no job yet; a row ended before `since` or dismissed is not
// shown, a done conversion or index run says so for a few seconds. A conversion started by a folder import is its own
// row (the import's row goes once its documents are copied and their conversions started — a single add that converts
// in its own job keeps its row); an index run under a conversion is the list's bar
export function uploadsOf(
  jobs: Job[],
  local: Local[],
  o: { since: number; dismissed: Set<string>; now: number; project: string | null },
): Upload[] {
  const known = new Set(jobs.map((j) => j.id));
  const converts = new Set(
    jobs.filter((j) => KIND[j.kind] === "convert" && j.parentId).map((j) => j.parentId as string),
  );
  const fromJobs = [...jobs]
    .filter((j) => KIND[j.kind] && (!j.parentId || KIND[j.kind] === "convert"))
    .filter((j) => !(j.endedAt && Date.parse(j.endedAt) < o.since))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .flatMap((j) => rowsOf(j, o.now, converts));
  const claimed = new Set(local.map((u) => u.jobId));
  const startedFor = (u: Local) =>
    jobs.find(
      (j) =>
        KIND[j.kind] === u.job &&
        !claimed.has(j.id) &&
        Date.parse(j.startedAt) >= u.at &&
        (u.job === "index" || j.subject === (u.job === "convert" ? u.docId : u.name)),
    );
  const waiting = local.filter((u) => {
    if (u.project !== o.project || (u.jobId && known.has(u.jobId))) return false;
    if (u.jobId || settled(u) || u.phase === "reading") return true;
    // ponytail: the job's row can come by the event stream before the call that started it returns its id — that job
    // is this row's (same kind and subject, started after the row was made), so the row gives way and is never a second
    const j = startedFor(u);
    if (j) claimed.add(j.id);
    return !j;
  });
  return [...fromJobs, ...waiting.map(({ project: _p, jobId: _j, at: _a, ...u }) => u)].filter(
    (u) => !o.dismissed.has(u.key),
  );
}

export function useUploads(): Upload[] {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => view.version,
    () => view.version,
  );
  const list = useProjectJobs(view.local.map((u) => u.jobId));
  const fresh = list.some((j) => KIND[j.kind] && j.endedAt && Date.now() - Date.parse(j.endedAt) < SHOWN_DONE_MS);
  const now = useNow(1000, fresh);
  return uploadsOf(list, view.local, {
    since: view.since,
    dismissed: view.dismissed,
    now: Math.max(now, Date.now()),
    project: project(),
  });
}

export const readBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("The file could not be read."));
    r.readAsDataURL(file);
  });

// ponytail: the model and effort picked on the Documents screen stay for every add and reindex until the app is
// closed; unpicked, the core keeps its defaults (project model / low for figures, haiku / low for headers)
let claude: ClaudeRun = {};
export const importClaude = () => claude;
export const setImportClaude = (next: ClaudeRun) => {
  claude = next;
};

// ponytail: a local row stands for a job until the list shows it; a failure before the job started stays on it, a
// failure after is the job's own row
export async function tracked<T>(
  row: Omit<Local, "key" | "project" | "pct" | "at">,
  start: (onStart: (jobId: string) => void) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const key = addLocal(row);
  let started = false;
  try {
    const value = await start((jobId) => {
      started = true;
      patchLocal(key, { jobId });
    });
    dropLocal(key);
    return { ok: true, value };
  } catch (e) {
    if (started) dropLocal(key);
    else patchLocal(key, { phase: row.job === "index" ? "index-failed" : "failed", message: message(e), error: e });
    return { ok: false };
  }
}

// ponytail: the page that asked is told only while it still shows the project it asked in
export const sameProject = (p: string | null, fn: () => void) => {
  if (project() === p) fn();
};

export type JobContext = { note?: string; contexts?: string[] };

// ponytail: one job converts, has Claude look at the warnings (when Claude is there) and updates the index once the
// other conversions are done; the row follows its steps
export async function convertDoc(
  id: string,
  name: string,
  job: JobContext & { describeFigures?: boolean; study?: boolean },
  onDone: () => void,
  onStarted?: (jobId: string) => void,
): Promise<void> {
  const p = project();
  const extra = { ...(job.note?.trim() ? { note: job.note.trim() } : {}), contexts: job.contexts ?? [] };
  const input = {
    id,
    ...claude,
    ...extra,
    ...(job.describeFigures !== undefined && { describeFigures: job.describeFigures }),
    ...(job.study ? { study: true } : { triage: true }),
    index: true,
  };
  await tracked({ name, job: "convert", docId: id, phase: "converting", message: "Converting" }, (onStart) =>
    run("docs.convert", input, undefined, (jobId) => {
      onStart(jobId);
      onStarted?.(jobId);
    }),
  );
  sameProject(p, onDone);
}

export type Picked = { name: string; path: string; file?: File };
/** images picked together: one document (with its title) or one each */
export type ImagesChoice = { images: "together" | "each"; title?: string };

export const pickedOfFiles = (files: File[]): Picked[] =>
  files.map((f) => ({ name: f.name, path: pathOf(f), file: f }));
export const pickedOfPaths = (paths: string[]): Picked[] => paths.map((p) => ({ name: baseName(p), path: p }));
export const addDocFiles = (files: File[], onDone: (docId?: string) => void, choice?: ImagesChoice) =>
  addDocs(pickedOfFiles(files), onDone, choice);
export const addDocPaths = (paths: string[], onDone: (docId?: string) => void, choice?: ImagesChoice) =>
  addDocs(pickedOfPaths(paths), onDone, choice);

export async function sourceOf(p: Picked): Promise<{ path: string } | { name: string; dataBase64: string }> {
  if (p.path) return { path: p.path };
  if (!p.file) throw new Error(`${p.name} could not be read.`);
  return { name: p.name, dataBase64: await readBase64(p.file) };
}

// ponytail: adding only copies the files — the core pairs a .docx with its .pdf, makes images picked together one
// document (or one each, as chosen) and refuses what is not a document; the team sets status, amends and context,
// then converts each on purpose
export async function addDocs(
  picked: Picked[],
  onDone: (docId?: string) => void,
  choice?: ImagesChoice,
): Promise<void> {
  const p = project();
  const files: Awaited<ReturnType<typeof sourceOf>>[] = [];
  const names: string[] = [];
  for (const f of picked) {
    const key = f.path ? "" : addLocal({ name: f.name, job: "add", phase: "reading", message: "Reading the file" });
    try {
      files.push(await sourceOf(f));
      names.push(f.name);
      if (key) dropLocal(key);
    } catch (e) {
      patchLocal(key, { phase: "failed", message: message(e), error: e });
    }
  }
  if (!files.length) return;
  const name = names.length === 1 ? names[0] : `${names.length} files`;
  const r = await tracked({ name, job: "add", phase: "adding", message: "Adding" }, (onStart) =>
    run<Added>("docs.addFiles", { files, ...choice }, undefined, onStart),
  );
  if (!r.ok) return sameProject(p, onDone);
  const refused = r.value.rejected.filter((x) => x.code === "not-a-document");
  if (refused.length)
    toast({
      tone: "danger",
      title: "Only Word, PDF, text, image and video files can be added",
      detail: refused.map((x) => x.name).join(", "),
    });
  sameProject(p, () => {
    for (const d of r.value.added) onDone(d.id);
    if (!r.value.added.length) onDone();
  });
}

// ponytail: the core waits for the conversions under way and for an index run already started (rag.index)
export async function reindexAll(onDone: () => void): Promise<void> {
  const p = project();
  await tracked({ name: "All documents", job: "index", phase: "indexing", message: "Indexing" }, (onStart) =>
    run("rag.index", claude, undefined, onStart),
  );
  sameProject(p, onDone);
}

// ponytail: the one Reindex of the page (Documents, Generate, Settings): a tracked row, its failure (shown under the
// list, or above Generate's form), and what the index changes read again when it ends
export function useReindex(): { reindex: () => void; indexing: boolean; failure: Upload | undefined } {
  const client = useQueryClient();
  const runs = useUploads().filter((u) => u.job === "index");
  return {
    indexing: runs.some((u) => !settled(u)),
    failure: runs.findLast((u) => u.phase === "index-failed"),
    reindex: () =>
      void reindexAll(() => void invalidate(client, [["docs.list"], ["rag.status"], ["rag.spaces"], ["gen.preview"]])),
  };
}

// ponytail: several conversions under way — how many go at once, how many wait their turn, and the one index run that
// follows them; nothing for a single conversion
export function conversionsLine(rows: Upload[]): string | null {
  const going = rows.filter((u) => u.job === "convert" && (u.phase === "converting" || u.phase === "waiting"));
  const waiting = going.filter((u) => u.phase === "waiting").length;
  const now = going.length - waiting;
  if (!waiting && now < 2) return null;
  const index = going.some((u) => u.index) ? "then one index run" : "";
  return [`Converting ${now} at a time`, waiting ? `${waiting} waiting` : "", index].filter(Boolean).join(" · ");
}
