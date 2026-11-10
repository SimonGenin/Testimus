import type { Job, JobStep } from "../../../core/types.ts";
import type { BadgeTone } from "../../components/ui/Badge.tsx";
import type { IconName } from "../../components/ui/Icon.tsx";
import type { TimelineState } from "../../components/ui/Timeline.tsx";
import type { JobNode } from "../../lib/jobs.ts";

export type StatusFilter = "all" | "running" | "failed" | "done" | "stopped";

const isDocs = (k: string) => k.startsWith("docs.") || k.startsWith("media.") || k === "describe-figures";

export const KINDS: { id: string; label: string; kinds: (k: string) => boolean }[] = [
  { id: "documents", label: "Documents", kinds: isDocs },
  { id: "index", label: "Index", kinds: (k) => k === "rag-index" || k === "search-index" },
  { id: "generate", label: "Generate", kinds: (k) => k === "generate" },
  { id: "check", label: "Check", kinds: (k) => k === "check" },
  {
    id: "claude",
    label: "Claude runs",
    kinds: (k) => ["claude", "actions.triage", "fix", "chat", "columns"].includes(k),
  },
  { id: "xray", label: "Jira and Xray", kinds: (k) => k === "pull" || k === "push" },
  {
    id: "models",
    label: "Models",
    kinds: (k) => k.startsWith("models-") || ["pullModel", "rag-eval", "gen-bench", "agents-test"].includes(k),
  },
];

export const statusOf = (j: Job): Exclude<StatusFilter, "all"> =>
  j.status === "running"
    ? "running"
    : j.status === "done"
      ? "done"
      : j.status === "failed" && !j.interrupted
        ? "failed"
        : "stopped";

const leaf = (job: Job): JobNode => ({ job, children: [], after: [], repeats: [] });

export function findNode(nodes: JobNode[], id: string): JobNode | null {
  for (const n of nodes) {
    if (n.job.id === id) return n;
    const r = n.repeats.find((j) => j.id === id);
    if (r) return leaf(r);
    const deeper = findNode([...n.children, ...n.after], id);
    if (deeper) return deeper;
  }
  return null;
}

export const CLAUDE_KINDS = ["claude", "actions.triage", "fix", "chat", "columns"];

export function kindIcon(kind: string): IconName {
  if (isDocs(kind)) return "documents";
  if (kind === "generate") return "generate";
  if (kind === "check") return "check-circle";
  if (kind === "rag-index" || kind === "search-index") return "layers";
  if (kind === "rag-eval") return "search";
  if (kind === "push") return "push";
  if (kind === "pull") return "download";
  if (kind === "models-measure") return "cpu";
  if (kind.startsWith("models-") || kind === "pullModel") return "drive";
  if (kind === "process") return "terminal";
  if (CLAUDE_KINDS.includes(kind)) return "claude";
  return "jobs";
}

export function toneOf(job: Pick<Job, "status" | "interrupted">): BadgeTone {
  if (job.interrupted) return "warning";
  return job.status === "running"
    ? "info"
    : job.status === "done"
      ? "success"
      : job.status === "failed"
        ? "danger"
        : "neutral";
}

export function iconOf(job: Pick<Job, "status" | "interrupted">): IconName {
  if (job.interrupted) return "alert-triangle";
  return job.status === "done" ? "check-circle" : job.status === "failed" ? "x-circle" : "stop";
}

export function stepState(s: JobStep["status"]): TimelineState {
  return s === "cancelled" ? "skipped" : s;
}
