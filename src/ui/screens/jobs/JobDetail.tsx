import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { askedOf, ClaudeActivity } from "../../components/claude/ClaudeActivity.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { type Screen, useApp } from "../../lib/app.ts";
import { type JobNode, kindLabel, percent, resultLine, subjectLabel } from "../../lib/jobs.ts";
import { nameTests, useTestNames } from "../../lib/labels.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { JobCards } from "./JobCard.tsx";
import { JobFiles } from "./JobFiles.tsx";
import { FullLog } from "./JobFullLog.tsx";
import { JobHead } from "./JobHead.tsx";
import { JobProblem } from "./JobProblem.tsx";
import { JobProcesses, JobSteps } from "./JobSteps.tsx";
import { JobTechnical } from "./JobTechnical.tsx";
import { useJobDetail } from "./useJobDetail.ts";

const styles = stylex.create({
  pane: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    paddingTop: space.s6,
    paddingInline: space.s6,
    paddingBottom: space.s9,
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
  "media.keep": "testimus media keep",
  "media.propose": "testimus media propose",
  "media.glossary": "testimus media suggestGlossary",
  "media.lighten": "testimus media lighten",
  "media.measure": "testimus media measure",
  "rag-index": "testimus rag index",
  "rag-eval": "testimus rag eval",
  pullModel: "testimus system pull-model",
  claude: "testimus claude run",
  chat: "testimus chat ask",
  "describe-figures": "testimus docs describe-figures",
  "actions.triage": "testimus actions triage",
};

type Result = Record<string, unknown>;
const ids = (v: unknown, key?: string): string[] =>
  Array.isArray(v)
    ? v.map((x) => (key ? (x as Record<string, unknown>)?.[key] : x)).filter((x) => typeof x === "string")
    : [];
const one = (v: unknown): string[] => (typeof v === "string" && v ? [v] : []);

// ponytail: where a finished job's result is, by kind — the tests it wrote, checked, fixed or pulled, the documents it
// added, converted or described; the first one opens
const RESULTS: Record<string, { screen: Screen; one: string; many: string; of: (r: Result, job: Job) => string[] }> = {
  generate: { screen: "review", one: "Review this test", many: "Review these tests", of: (r) => ids(r.tests) },
  check: { screen: "review", one: "Review this test", many: "Review these tests", of: (r) => ids(r.tests, "id") },
  fix: { screen: "review", one: "Review this test", many: "Review these tests", of: (_r, j) => one(j.subject) },
  pull: { screen: "tests", one: "Open the test", many: "Open the tests", of: (r) => ids(r.pulled) },
  "docs.add": {
    screen: "documents",
    one: "Open the document",
    many: "Open the documents",
    of: (r) => [...one(r.id), ...ids(r.added, "id")],
  },
  "docs.convert": {
    screen: "documents",
    one: "Open the document",
    many: "Open the documents",
    of: (r) => [...one(r.id), ...one(r.doc)],
  },
  "media.keep": { screen: "documents", one: "Open the document", many: "Open the documents", of: (r) => one(r.doc) },
  "media.propose": { screen: "documents", one: "Open the document", many: "Open the documents", of: (r) => one(r.doc) },
  "media.measure": { screen: "documents", one: "Open the document", many: "Open the documents", of: (r) => one(r.doc) },
  "describe-figures": {
    screen: "documents",
    one: "Open the document",
    many: "Open the documents",
    of: (r) => ids(r.docs, "docId"),
  },
};

function resultLink(job: Job): { label: string; screen: Screen; ids: string[] } | null {
  const k = RESULTS[job.kind];
  const list = k ? k.of((job.result ?? {}) as Result, job) : [];
  return k && list.length ? { label: list.length === 1 ? k.one : k.many, screen: k.screen, ids: list } : null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} {...stylex.props(styles.sect)}>
      <h3 {...stylex.props(type.caption, styles.h3)}>{title}</h3>
      {children}
    </section>
  );
}

// ponytail: the detail pane while the jobs are read — its title, its meta line and a block, where they will be
export function JobDetailSkeleton() {
  return (
    <aside aria-label="Job details" aria-busy="true" {...stylex.props(styles.pane)}>
      <Skeleton kind="title" width="50%" />
      <Skeleton width="70%" />
      <Skeleton kind="block" />
      <Loading read="jobs.list" />
    </aside>
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
  const names = useTestNames();
  const { job, events, cancel, again } = useJobDetail(node.job, onOpen);
  const [showLog, setShowLog] = useState(false);
  const link = job.status === "done" ? resultLink(job) : null;
  const claude =
    events.some((e) => e.type === "claude") || (job.processes ?? []).some((p) => p.label.startsWith("Claude"));
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
          {job.message && <p {...stylex.props(type.compact, styles.now)}>{nameTests(job.message, names)}</p>}
        </div>
      )}

      {job.status === "done" && (link || resultLine(job).includes(" · ")) && (
        <div {...stylex.props(styles.result)}>
          {link && (
            <Button
              variant="primary"
              iconAfter="arrow-right"
              label={link.label}
              onClick={() => app.navigate(link.screen, link.ids[0])}
            />
          )}
          {resultLine(job).includes(" · ") && (
            <span {...stylex.props(type.compact, styles.muted)}>
              {resultLine(job).split(" · ").slice(1).join(" · ")}
            </span>
          )}
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

      <JobFiles events={events} onGo={app.navigate} />

      {claude ? (
        <Disclosure quiet summary="Show the full log" open={showLog} onOpenChange={setShowLog}>
          <FullLog job={job} events={events} />
        </Disclosure>
      ) : (
        <FullLog job={job} events={events} />
      )}

      <JobTechnical job={job} />

      {CLI[job.kind] && (
        <span {...stylex.props(type.small, styles.cli)}>
          Same as <span {...stylex.props(type.code)}>{CLI[job.kind]}</span> · log kept in the project folder
        </span>
      )}
    </aside>
  );
}
