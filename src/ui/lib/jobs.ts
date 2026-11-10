import type { ClaudeEvent, Job, JobEvent, JobStep } from "../../core/types.ts";
import { toolLabel } from "../components/claude/ClaudeDock.tsx";
import { plural } from "./format.ts";
import { isLocalId } from "./labels.ts";

export const KIND: Record<string, string> = {
  generate: "Generate tests",
  fix: "Claude fix",
  check: "Check tests",
  columns: "Define the columns",
  claude: "Claude request",
  "actions.triage": "Claude looks at the problems",
  chat: "Ask the documents",
  "comment-draft": "Draft a Jira comment",
  pull: "Pull from Jira",
  push: "Push to Jira",
  status: "Check every test against Jira",
  "docs.add": "Add document",
  "docs.convert": "Convert document",
  "describe-figures": "Describe figures",
  "media.keep": "Key frame",
  "media.propose": "Transcript corrections",
  "media.lighten": "Lighter copy of a video",
  "media.measure": "Transcription measure",
  "rag-index": "Index documents",
  "rag-eval": "Measure search",
  pullModel: "Download model",
  "models-pull": "Download model",
  "models-usePack": "Use a search pack",
  "models-measure": "Measure a search pack",
  "models-dir": "Change the models folder",
  "models-verify": "Verify a model",
  "gen-bench": "Benchmark generation",
  "agents-test": "Test the PC's limits",
  "search-index": "Index the tests",
};

export const kindLabel = (k: string) => KIND[k] ?? k;

export function duration(job: Pick<Job, "startedAt" | "endedAt">, now = Date.now()): string {
  const end = job.endedAt ? Date.parse(job.endedAt) : now;
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour12: false });
};

export function resultLine(job: Job): string {
  if (job.status === "running") return "Running";
  if (job.interrupted) return "Interrupted";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "failed") return `Failed${job.error ? ` · ${job.error.split("\n")[0].slice(0, 80)}` : ""}`;
  const r = (job.result ?? {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : null);
  if (job.kind === "generate" && arr("tests")) return `Done · ${plural(arr("tests")?.length ?? 0, "test")} written`;
  if (job.kind === "check" && arr("tests")) {
    const t = arr("tests") as { errors?: number; warnings?: number }[];
    const n = t.filter((x) => (x.errors ?? 0) + (x.warnings ?? 0) > 0).length;
    return `Done · ${n} with findings`;
  }
  if (job.kind === "fix" && Array.isArray(r.changedSteps))
    return `Done · ${plural((r.changedSteps as unknown[]).length, "step")} changed`;
  if (job.kind === "pull" && arr("pulled")) return `Done · ${plural(arr("pulled")?.length ?? 0, "test")} pulled`;
  if (job.kind === "rag-index" && typeof r.chunks === "number") return `Done · ${r.chunks} passages`;
  if (job.kind === "push" && r.ok === false) return "Stopped on a Jira error";
  return "Done";
}

export type LogLine = { at: string; text: string; level: "info" | "warn" | "error" };

function claudeLine(e: ClaudeEvent): string | null {
  if (e.type === "tool") return toolLabel(e.name, e.input);
  if (e.type === "result") return e.ok ? "Claude finished" : `Claude stopped: ${e.text.slice(0, 160)}`;
  return null;
}

export function logLines(events: JobEvent[]): LogLine[] {
  const out: LogLine[] = [];
  for (const e of events) {
    if (e.type === "progress") {
      if (out[out.length - 1]?.text !== e.message) out.push({ at: e.at, text: e.message, level: "info" });
    } else if (e.type === "log") out.push({ at: e.at, text: e.message, level: e.level });
    else if (e.type === "claude") {
      const t = claudeLine(e.event);
      if (t) out.push({ at: e.at, text: t, level: "info" });
    } else if (e.type === "status" && e.job.status !== "running")
      out.push({
        at: e.at,
        text: resultLine(e.job),
        level: e.job.status === "failed" ? "error" : e.job.status === "cancelled" ? "warn" : "info",
      });
  }
  return out;
}

export const percent = (job: Job) =>
  job.progress && job.progress.total > 0 ? Math.round((job.progress.done / job.progress.total) * 100) : null;

export const isJobId = (s: string) => !isLocalId(s) && /^[a-z][\w.-]*-[0-9a-f]{8}$/.test(s);

const base = (p: string) => p.split(/[\\/]/).pop() || p;

// ponytail: the core names what a job works on when it starts (label: the test's summary, the document's title); an
// older job has only its subject, what the command was given (a path, an id, "index") — a row shows what it means,
// and never a local test's id
export function subjectLabel(job: Job, byId: Map<string, Job>): string {
  if (job.label?.trim()) return job.label.trim();
  const s = job.subject.trim();
  if (!s || s === "{}") return "";
  if (s === "index") return "All documents";
  const parts = s.split(/,\s*/);
  if (parts.every(isLocalId)) return parts.length === 1 ? "A local test" : `${parts.length} local tests`;
  if (isJobId(s)) {
    const o = byId.get(s);
    return o ? `${kindLabel(o.kind)}${subjectLabel(o, byId) ? ` · ${subjectLabel(o, byId)}` : ""}` : "A past job";
  }
  if (/^([a-z]:)?[\\/]/i.test(s) || s.includes("\\")) return base(s);
  return s;
}

export type JobNode = { job: Job; children: JobNode[]; after: JobNode[]; repeats: Job[] };

// ponytail: a job sits under its parent (parentId: part of its work) or under the job it followed (cause: after a
// failure, a follow-up, a retry); one whose parent or origin is not listed is a root. Roots keep the list's order
// (newest first), what sits under a job is in the order it ran
export function jobTree(jobs: Job[]): JobNode[] {
  const nodes = new Map(jobs.map((j) => [j.id, { job: j, children: [], after: [], repeats: [] } as JobNode]));
  const roots: JobNode[] = [];
  for (const j of jobs) {
    const n = nodes.get(j.id) as JobNode;
    const parent = j.parentId ? nodes.get(j.parentId) : undefined;
    const origin = !parent && j.cause ? nodes.get(j.cause.jobId) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else if (origin && origin !== n) origin.after.push(n);
    else roots.push(n);
  }
  const oldest = (a: JobNode, b: JobNode) => a.job.startedAt.localeCompare(b.job.startedAt);
  for (const n of nodes.values()) {
    n.children.sort(oldest);
    n.after.sort(oldest);
  }
  return roots;
}

export const subtree = (n: JobNode): Job[] => [n.job, ...n.children.flatMap(subtree), ...n.after.flatMap(subtree)];

export const isRunning = (n: JobNode) => subtree(n).some((j) => j.status === "running");

// ponytail: the same job run again and again (a check after each edit) is one row: same kind and subject, one
// after another, none running, nothing under it; the newest stands for the group
export function groupRepeats(roots: JobNode[]): JobNode[] {
  const out: JobNode[] = [];
  for (const n of roots) {
    const prev = out[out.length - 1];
    const plain = (x: JobNode) => !x.children.length && !x.after.length && x.job.status !== "running";
    if (prev && plain(prev) && plain(n) && prev.job.kind === n.job.kind && prev.job.subject === n.job.subject)
      out[out.length - 1] = { ...prev, repeats: [...prev.repeats, n.job] };
    else out.push(n);
  }
  return out;
}

export function dayLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function sections(roots: JobNode[], now = Date.now()): { title: string; nodes: JobNode[] }[] {
  const out: { title: string; nodes: JobNode[] }[] = [];
  const add = (title: string, n: JobNode) => {
    const s = out.find((x) => x.title === title);
    if (s) s.nodes.push(n);
    else out.push({ title, nodes: [n] });
  };
  for (const n of roots) if (isRunning(n)) add("Running", n);
  for (const n of roots) if (!isRunning(n)) add(dayLabel(n.job.startedAt, now), n);
  return out;
}

// ponytail: what a parent says about the jobs under it — "3 of 5 done · 1 failed"
export function childSummary(n: JobNode): string {
  const c = n.children.map((x) => x.job);
  if (!c.length) return "";
  const done = c.filter((j) => j.status === "done").length;
  const failed = c.filter((j) => j.status === "failed").length;
  return `${done} of ${c.length} done${failed ? ` · ${failed} failed` : ""}`;
}

export function processLabel(label: string): string {
  return label
    .replace(/^Claude · generate \d+\/\d+$/, "Claude · write a test")
    .replace(/^Claude · generate$/, "Claude · read and write");
}

export type JobProblemText = { what: string; why?: string; detail: string; repeated: number };

const KNOWN: { test: RegExp; what: string; why: string }[] = [
  {
    test: /Cannot find module .*onnxruntime|onnxruntime_binding/i,
    what: "The search runtime is missing on this machine",
    why: "The embedding runtime (onnxruntime) has no build loaded for this system, so no passage could be turned into a vector. The system check says what this machine needs.",
  },
  {
    test: /not (logged|signed) in|please run \/login|invalid api key/i,
    what: "Claude is not signed in",
    why: "The Claude program answered that no account is signed in on this machine. Sign in once, then run the job again.",
  },
  {
    test: /ENOENT|no such file/i,
    what: "A file the job needed was missing",
    why: "A file was moved or deleted while the job ran, or was never there.",
  },
  {
    test: /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|fetch failed|socket hang up/i,
    what: "A server did not answer",
    why: "The job could not reach a server it needed. Check the network or the proxy, then run it again.",
  },
];

// ponytail: an error is said three ways — what in plain words, why when the message is known, the raw text last;
// the same error logged several times is counted, not repeated
export function problemText(job: Job, events: JobEvent[] = []): JobProblemText {
  const detail = (job.error ?? "The job failed.").trim();
  const first = detail.split("\n")[0].replace(/^(Error|TypeError|RangeError):\s*/, "");
  const repeated = Math.max(
    1,
    events.filter((e) => e.type === "log" && e.level === "error" && e.message.trim() === first).length,
  );
  if (job.interrupted)
    return {
      what: "The app stopped while this job ran",
      why: "Testimus was closed, or stopped, before the job could finish. What its finished steps wrote is kept.",
      detail,
      repeated,
    };
  const k = KNOWN.find((x) => x.test.test(detail));
  return k ? { what: k.what, why: k.why, detail, repeated } : { what: first || "The job failed", detail, repeated };
}

export const failedStep = (job: Job): JobStep | undefined =>
  job.steps?.find((s) => s.status === "failed") ?? job.steps?.find((s) => s.status === "running");

// ponytail: the full log cut by step — a line belongs to the step its event names; lines before any step, or of a
// job without steps, come under one untitled part
export function logByStep(events: JobEvent[], steps: JobStep[] = []): { step?: JobStep; lines: LogLine[] }[] {
  const parts: { step?: JobStep; lines: LogLine[] }[] = [];
  let at: { step?: JobStep; lines: LogLine[] } | undefined;
  for (const e of events) {
    const id = "step" in e ? e.step : undefined;
    const lines = logLines([e]);
    if (!lines.length) continue;
    const step = id ? steps.find((s) => s.id === id) : at?.step;
    if (!at || at.step?.id !== step?.id) {
      at = { step, lines: [] };
      parts.push(at);
    }
    if (at.lines[at.lines.length - 1]?.text !== lines[0].text) at.lines.push(...lines);
  }
  return parts;
}
