import type { Job, JobStep, StepStatus } from "../../../core/types.ts";
import { Icon, type IconName } from "../../components/legacy/index.ts";
import { cx } from "../../lib/format.ts";
import { duration, resultLine } from "../../lib/jobs.ts";

export type Tone = "run" | "ok" | "err" | "warn" | "stop" | "wait";

export function toneOf(job: Pick<Job, "status" | "interrupted">): Tone {
  if (job.interrupted) return "warn";
  return job.status === "running" ? "run" : job.status === "done" ? "ok" : job.status === "failed" ? "err" : "stop";
}

export function stepTone(s: StepStatus, interrupted?: boolean): Tone {
  if (s === "failed" && interrupted) return "warn";
  return s === "running" ? "run" : s === "done" ? "ok" : s === "failed" ? "err" : s === "cancelled" ? "stop" : "wait";
}

const ICON: Record<Tone, IconName> = {
  run: "clock",
  ok: "check",
  err: "error",
  warn: "warning",
  stop: "stop",
  wait: "dot",
};

export function StateIcon({ tone }: { tone: Tone }) {
  if (tone === "run") return <span className="jt-spin" aria-hidden="true" />;
  if (tone === "wait") return <span className="jt-wait" aria-hidden="true" />;
  return <Icon name={ICON[tone]} className={`jt-ic t-${tone}`} />;
}

export function JobState({ job, now }: { job: Job; now: number }) {
  const tone = toneOf(job);
  const text = job.status === "running" ? `Running · ${duration(job, now)}` : resultLine(job);
  return (
    <span className={cx("jt-state", `t-${tone}`)}>
      <StateIcon tone={tone} />
      {text}
    </span>
  );
}

export function StepState({ step, interrupted }: { step: JobStep; interrupted?: boolean }) {
  return <StateIcon tone={stepTone(step.status, interrupted)} />;
}

export function kindIcon(kind: string): IconName {
  if (kind.startsWith("docs.") || kind === "describe-figures") return "documents";
  if (kind === "generate") return "generate";
  if (kind === "check") return "review";
  if (kind === "rag-index" || kind === "search-index" || kind === "rag-eval") return "search";
  if (kind === "push") return "push";
  if (kind === "pull" || kind.startsWith("models-") || kind === "pullModel") return "pull";
  if (["claude", "actions.triage", "fix", "chat", "columns"].includes(kind)) return "claude";
  return "jobs";
}

export function KindTile({ kind, small }: { kind: string; small?: boolean }) {
  const claude = kindIcon(kind) === "claude";
  return (
    <span className={cx("jt-tile", small && "jt-tile-sm", claude && "jt-tile-claude")} aria-hidden="true">
      <Icon name={kindIcon(kind)} size={small ? 13 : 16} />
    </span>
  );
}
