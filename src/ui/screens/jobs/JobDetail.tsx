import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { askedOf, ClaudeActivity } from "../../components/claude/ClaudeActivity.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { type JobNode, kindLabel, percent, resultLine, subjectLabel } from "../../lib/jobs.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { JobCards } from "./JobCard.tsx";
import { FullLog } from "./JobFullLog.tsx";
import { JobHead } from "./JobHead.tsx";
import { JobProblem } from "./JobProblem.tsx";
import { JobProcesses, JobSteps } from "./JobSteps.tsx";
import { useJobDetail } from "./useJobDetail.ts";

const styles = stylex.create({
  pane: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    padding: space.s6,
    borderInlineStartWidth: border.width,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: color.border,
    backgroundColor: color.surface,
  },
  result: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  muted: { color: color.textMuted },
  now: { margin: 0, color: color.textMuted },
  sect: { display: "flex", flexDirection: "column", gap: space.s3 },
  h3: { margin: 0 },
  files: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  file: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  fileIcon: { flex: "none", display: "inline-flex", color: color.textSubtle },
  how: { flex: "none", color: color.textSubtle },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.text },
  start: { alignSelf: "flex-start" },
  cli: {
    color: color.textMuted,
    paddingTop: space.s4,
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderTopColor: color.border,
  },
});

const CLI: Record<string, string> = {
  generate: "testimus gen tests",
  fix: "testimus review fix",
  check: "testimus check run",
  pull: "testimus xray pull",
  push: "testimus xray push",
  "docs.add": "testimus docs add",
  "docs.convert": "testimus docs convert",
  "rag-index": "testimus rag index",
  "rag-eval": "testimus rag eval",
  pullModel: "testimus system pull-model",
  claude: "testimus claude run",
  chat: "testimus chat ask",
  "describe-figures": "testimus docs describe-figures",
  "actions.triage": "testimus actions triage",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} {...stylex.props(styles.sect)}>
      <h3 {...stylex.props(type.caption, styles.h3)}>{title}</h3>
      {children}
    </section>
  );
}

export function JobDetail({
  node,
  byId,
  now,
  onOpen,
}: {
  node: JobNode;
  byId: Map<string, Job>;
  now: number;
  onOpen(id: string): void;
}) {
  const app = useApp();
  const { job, events, cancel, again } = useJobDetail(node.job, onOpen);
  const [showLog, setShowLog] = useState(false);
  const r = (job.result ?? {}) as { tests?: string[] };
  const claude =
    events.some((e) => e.type === "claude") || (job.processes ?? []).some((p) => p.label.startsWith("Claude"));
  const changed = [...new Set(events.flatMap((e) => (e.type === "changed" ? e.paths : [])))];
  const how = new Map<string, "added" | "deleted">();
  for (const e of events)
    if (e.type === "changed") {
      for (const p of e.added ?? []) how.set(p, "added");
      for (const p of e.removed ?? []) how.set(p, "deleted");
    }
  const { model, effort } = askedOf(job, app.info?.project.claude);
  const carried = new Set((job.steps ?? []).map((s) => s.jobId).filter(Boolean));
  const inside = node.children.filter((n) => !carried.has(n.job.id)).map((n) => n.job);
  const loose = (job.processes ?? []).filter((p) => !p.step || !job.steps?.some((s) => s.id === p.step));
  const diagnosis = node.after.find((n) => n.job.kind === "actions.triage")?.job;
  const label = kindLabel(job.kind);
  const running = job.status === "running";
  const pct = percent(job);
  return (
    <aside aria-label={`${label} job`} {...stylex.props(styles.pane)}>
      <JobHead
        job={job}
        subject={subjectLabel(job, byId)}
        byId={byId}
        now={now}
        onCancel={() => void cancel()}
        onAgain={again}
        onOpen={onOpen}
      />

      {running && !job.steps?.length && (
        <div {...stylex.props(styles.sect)}>
          <Progress label={`${label} progress`} value={pct} />
          {job.message && <p {...stylex.props(type.compact, styles.now)}>{job.message}</p>}
        </div>
      )}

      {job.status === "done" && job.kind === "generate" && !!r.tests?.length && (
        <div {...stylex.props(styles.result)}>
          <Button
            variant="primary"
            iconAfter="arrow-right"
            label="Review these tests"
            onClick={() => app.navigate("review", r.tests?.[0])}
          />
          <span {...stylex.props(type.compact, styles.muted)}>{plural(r.tests.length, "test")} written</span>
        </div>
      )}
      {job.status === "done" && job.kind !== "generate" && resultLine(job).includes(" · ") && (
        <div {...stylex.props(styles.result)}>
          <span {...stylex.props(type.compact, styles.muted)}>{resultLine(job).split(" · ").slice(1).join(" · ")}</span>
        </div>
      )}

      {(job.status === "failed" || job.interrupted) && (
        <JobProblem job={job} events={events} diagnosis={diagnosis} onRetry={again} onOpen={onOpen} />
      )}

      {!!job.steps?.length && (
        <Section title="Steps">
          <JobSteps job={job} events={events} byId={byId} now={now} onOpen={onOpen} />
        </Section>
      )}

      {inside.length > 0 && (
        <Section title={`Jobs inside · ${inside.length}`}>
          <JobCards label="Jobs inside" jobs={inside} byId={byId} now={now} onOpen={onOpen} />
        </Section>
      )}

      {loose.length > 0 && (
        <Section title={`Processes · ${loose.length}`}>
          <JobProcesses list={loose} now={now} />
        </Section>
      )}

      {node.after.length > 0 && (
        <Section
          title={`${job.status === "failed" ? "After this failure" : "Started after it"} · ${node.after.length}`}
        >
          <JobCards
            label={job.status === "failed" ? "After this failure" : "Started after it"}
            jobs={node.after.map((n) => n.job)}
            byId={byId}
            now={now}
            onOpen={onOpen}
          />
        </Section>
      )}

      {claude && <ClaudeActivity events={events} running={running} now={now} model={model} effort={effort} />}

      {changed.length > 0 && (
        <Section title={`Files changed · ${changed.length}`}>
          <ul {...stylex.props(styles.files)}>
            {changed.map((p) => (
              <li key={p} {...stylex.props(styles.file)}>
                <span {...stylex.props(styles.fileIcon)}>
                  <Icon
                    name={how.get(p) === "added" ? "plus" : how.get(p) === "deleted" ? "trash" : "file"}
                    size="sm"
                  />
                </span>
                <span title={p} {...stylex.props(type.code, styles.path)}>
                  {p}
                </span>
                <span {...stylex.props(type.small, styles.how)}>{how.get(p) ?? "modified"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {claude && !showLog ? (
        <span {...stylex.props(styles.start)}>
          <Button
            variant="quiet"
            size="sm"
            icon="chevron-right"
            label="Show the full log"
            onClick={() => setShowLog(true)}
          />
        </span>
      ) : (
        <FullLog job={job} events={events} />
      )}

      {CLI[job.kind] && (
        <span {...stylex.props(type.small, styles.cli)}>
          Same as <span {...stylex.props(type.code)}>{CLI[job.kind]}</span> · log kept in the project folder
        </span>
      )}
    </aside>
  );
}
