import type { Job } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Tile } from "../../components/ui/Tile.tsx";
import { duration, resultLine } from "../../lib/jobs.ts";
import { CLAUDE_KINDS, iconOf, kindIcon, toneOf } from "./kinds.ts";

// ponytail: the state of a job as one badge — running with its time, else the first words of its result
export function JobState({
  job,
  now,
  size: s = "sm",
  timed = true,
}: {
  job: Job;
  now: number;
  size?: "sm" | "md";
  /** the running time in the badge (false where a column shows it) */
  timed?: boolean;
}) {
  if (job.status === "running")
    return <Badge label={timed ? `Running · ${duration(job, now)}` : "Running"} tone="info" busy size={s} />;
  return <Badge label={resultLine(job).split(" · ")[0]} tone={toneOf(job)} icon={iconOf(job)} size={s} />;
}

export function KindTile({ kind, size = "md" }: { kind: string; size?: "sm" | "md" | "lg" }) {
  const claude = CLAUDE_KINDS.includes(kind) || kind === "claude-process";
  return (
    <Tile
      icon={kind === "claude-process" ? "claude" : kindIcon(kind)}
      tone={claude ? "claude" : "neutral"}
      size={size}
    />
  );
}
