import * as stylex from "@stylexjs/stylex";
import type { Job } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { duration, resultLine } from "../../lib/jobs.ts";
import { color, radius, size } from "../../styles/tokens.stylex.ts";
import { CLAUDE_KINDS, iconOf, kindIcon, toneOf } from "./kinds.ts";

const styles = stylex.create({
  tile: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlMd,
    height: size.controlMd,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
  small: { width: size.controlXs, height: size.controlXs },
  large: { width: size.controlLg, height: size.controlLg },
  claude: { backgroundColor: color.claudeSubtle, color: color.claudeText },
});

// ponytail: the state of a job as one badge — running with its time, else the first words of its result
export function JobState({ job, now, size: s = "sm" }: { job: Job; now: number; size?: "sm" | "md" }) {
  if (job.status === "running") return <Badge label={`Running · ${duration(job, now)}`} tone="info" busy size={s} />;
  return <Badge label={resultLine(job).split(" · ")[0]} tone={toneOf(job)} icon={iconOf(job)} size={s} />;
}

export function KindTile({ kind, size: s = "md" }: { kind: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      {...stylex.props(
        styles.tile,
        s === "sm" && styles.small,
        s === "lg" && styles.large,
        (CLAUDE_KINDS.includes(kind) || kind === "claude-process") && styles.claude,
      )}
    >
      <Icon name={kind === "claude-process" ? "claude" : kindIcon(kind)} size={s === "lg" ? "lg" : "md"} />
    </span>
  );
}
