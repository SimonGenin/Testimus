import type { ClaudeEvent, Job, JobEvent } from "../../core/types.ts";
import { toolLabel } from "../components/claude/ClaudeDock.tsx";
import { plural } from "./format.ts";

export const KIND: Record<string, string> = {
  generate: "Generate tests",
  fix: "Claude fix",
  check: "Check tests",
  claude: "Claude request",
  chat: "Ask the documents",
  traces: "Find ids to track",
  pull: "Pull from Jira",
  push: "Push to Jira",
  "docs.add": "Add document",
  "docs.convert": "Convert document",
  "describe-figures": "Describe figures",
  "rag-index": "Index documents",
  "rag-eval": "Measure search",
  pullModel: "Download model",
  "models-pull": "Download model",
  "models-usePack": "Use a search pack",
  "models-move": "Move the models",
  "models-copy": "Copy the models",
  "gen-bench": "Benchmark generation",
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
