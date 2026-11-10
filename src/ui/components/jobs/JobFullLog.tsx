import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { clock, logByStep } from "../../lib/jobs.ts";
import { nameTests, useTestNames } from "../../lib/labels.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { Raw, type RawLine } from "../ui/Raw.tsx";
import { Switch } from "../ui/Switch.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s3 },
  head: { display: "flex", alignItems: "center", gap: space.s3 },
  title: { flex: 1, margin: 0 },
});

// ponytail: the whole log of a job, cut by step (a step's number and name on a line of its own, red when it failed);
// it follows the end until it is scrolled up
export function FullLog({ job, events }: { job: Job; events: JobEvent[] }) {
  const [only, setOnly] = useState(false);
  const names = useTestNames();
  const lines: RawLine[] = logByStep(events, job.steps).flatMap((p) => {
    const kept = only ? p.lines.filter((l) => l.level !== "info") : p.lines;
    if (!kept.length) return [];
    const head: RawLine[] = p.step
      ? [
          {
            text: `${(job.steps?.indexOf(p.step) ?? -1) + 1} · ${p.step.label}`,
            level: p.step.status === "failed" ? "error" : "info",
            head: true,
          },
        ]
      : [];
    return [...head, ...kept.map((l) => ({ text: nameTests(l.text, names), level: l.level, at: clock(l.at) }))];
  });
  return (
    <section aria-label="Log" {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.head)}>
        <h3 {...stylex.props(type.caption, styles.title)}>Log</h3>
        <Switch label="Warnings and errors only" on={only} onChange={setOnly} />
      </div>
      <Raw
        lines={lines}
        follow
        maxLines={24}
        label="Live log"
        empty={only ? "No warning or error." : "Nothing logged yet."}
      />
    </section>
  );
}
