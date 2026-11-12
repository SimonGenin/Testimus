import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { type Screen, useApp } from "../../lib/app.ts";
import { percent, quietOf, resultLine } from "../../lib/jobs.ts";
import { nameTests, useTestNames } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { askedOf } from "../claude/ClaudeActivity.tsx";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Progress } from "../ui/Progress.tsx";
import { type } from "../ui/type.ts";
import { JobClaude } from "./JobClaude.tsx";
import { JobDocStage } from "./JobDocStage.tsx";
import { JobFiles } from "./JobFiles.tsx";
import { FullLog } from "./JobFullLog.tsx";
import { JobHead } from "./JobHead.tsx";
import { JobProblem } from "./JobProblem.tsx";
import { JobSteps } from "./JobSteps.tsx";

const styles = stylex.create({
  view: { display: "flex", flexDirection: "column", gap: space.s6 },
  result: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3 },
  muted: { color: color.textMuted },
  now: { margin: 0, color: color.textMuted },
  sect: { display: "flex", flexDirection: "column", gap: space.s3 },
  h3: { margin: 0 },
});

type Result = Record<string, unknown>;
const ids = (v: unknown, key?: string): string[] =>
  Array.isArray(v)
    ? v.map((x) => (key ? (x as Record<string, unknown>)?.[key] : x)).filter((x) => typeof x === "string")
    : [];
const one = (v: unknown): string[] => (typeof v === "string" && v ? [v] : []);

// ponytail: the jobs about one document (their subject is its id): the panel says where that document is
const DOC_JOBS = new Set(["docs.convert", "media.keep", "media.propose", "media.measure", "media.lighten"]);

const DOC = { screen: "documents" as const, one: "Open the document", many: "Open the documents" };
const REVIEW = { screen: "review" as const, one: "Review this test", many: "Review these tests" };

// ponytail: where a finished job's result is, by kind — the tests it wrote, checked, fixed or pulled, the documents it
// added, converted or described; the first one opens
const RESULTS: Record<string, { screen: Screen; one: string; many: string; of: (r: Result, job: Job) => string[] }> = {
  generate: { ...REVIEW, of: (r) => ids(r.tests) },
  check: { ...REVIEW, of: (r) => ids(r.tests, "id") },
  fix: { ...REVIEW, of: (_r, j) => one(j.subject) },
  pull: { screen: "tests", one: "Open the test", many: "Open the tests", of: (r) => ids(r.pulled) },
  "docs.add": { ...DOC, of: (r) => [...one(r.id), ...ids(r.added, "id"), ...ids(r.started, "id")] },
  "docs.convert": { ...DOC, of: (r) => [...one(r.id), ...one(r.doc)] },
  "media.keep": { ...DOC, of: (r) => one(r.doc) },
  "media.propose": { ...DOC, of: (r) => one(r.doc) },
  "media.measure": { ...DOC, of: (r) => one(r.doc) },
  "describe-figures": { ...DOC, of: (r) => ids(r.docs, "docId") },
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

// ponytail: one job, said for a person — where it is, what it made (and the way to it), what went wrong and what to
// do, its steps, what Claude did, the files it changed; the raw log folded last
export function JobView({
  job,
  events,
  byId,
  diagnosis,
  now,
  onCancel,
  onAgain,
  onOpen,
  onGo,
}: {
  job: Job;
  events: JobEvent[];
  byId: Map<string, Job>;
  diagnosis?: Job;
  now: number;
  onCancel: () => void;
  onAgain?: () => void;
  onOpen(id: string): void;
  onGo(screen: Screen, id?: string): void;
}) {
  const app = useApp();
  const names = useTestNames();
  const [showLog, setShowLog] = useState(false);
  const link = job.status === "done" ? resultLink(job) : null;
  const claude =
    events.some((e) => e.type === "claude") || (job.processes ?? []).some((p) => p.label.startsWith("Claude"));
  const { model, effort } = askedOf(job, app.info?.project.claude);
  const running = job.status === "running";
  const pct = percent(job);
  const rest = resultLine(job).split(" · ").slice(1).join(" · ");
  const quiet = quietOf(job, now);
  return (
    <div {...stylex.props(styles.view)}>
      <JobHead
        job={job}
        byId={byId}
        now={now}
        onCancel={onCancel}
        onAgain={job.status === "failed" || job.interrupted ? undefined : onAgain}
        onOpen={onOpen}
      />

      {DOC_JOBS.has(job.kind) && <JobDocStage id={job.subject} />}

      {quiet?.stuck && (
        <Banner tone="warning" title="This job may be stuck">
          Nothing came from it for {quiet.minutes} min and no program of its is running. Cancel it if it does not move
          again.
        </Banner>
      )}

      {running && !job.steps?.length && (
        <div {...stylex.props(styles.sect)}>
          <Progress label="Progress" value={pct} />
          {job.message && <p {...stylex.props(type.compact, styles.now)}>{nameTests(job.message, names)}</p>}
        </div>
      )}

      {job.status === "done" && (link || rest) && (
        <div {...stylex.props(styles.result)}>
          {link && (
            <Button
              variant="primary"
              iconAfter="arrow-right"
              label={link.label}
              onClick={() => onGo(link.screen, link.ids[0])}
            />
          )}
          {rest && <span {...stylex.props(type.compact, styles.muted)}>{rest}</span>}
        </div>
      )}

      {(job.status === "failed" || job.interrupted) && (
        <JobProblem job={job} events={events} diagnosis={diagnosis} onRetry={onAgain} onOpen={onOpen} />
      )}

      {!!job.steps?.length && (
        <Section title="Steps">
          <JobSteps job={job} events={events} byId={byId} now={now} onOpen={onOpen} />
        </Section>
      )}

      {claude && <JobClaude job={job} events={events} now={now} model={model} effort={effort} />}

      <JobFiles events={events} onGo={onGo} />

      <Disclosure quiet summary="Show the full log" open={showLog} onOpenChange={setShowLog}>
        <FullLog job={job} events={events} />
      </Disclosure>
    </div>
  );
}
