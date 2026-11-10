import type { Job, JobStep } from "../../../core/types.ts";
import type { BadgeTone } from "../ui/Badge.tsx";
import type { IconName } from "../ui/Icon.tsx";
import type { TimelineState } from "../ui/Timeline.tsx";

const isDocs = (k: string) => k.startsWith("docs.") || k.startsWith("media.") || k === "describe-figures";

export const CLAUDE_KINDS = ["claude", "actions.triage", "fix", "chat", "columns", "analyze"];

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
