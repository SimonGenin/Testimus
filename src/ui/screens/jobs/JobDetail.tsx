import { useState } from "react";
import type { Job } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { ClaudeActivity } from "../../components/claude/ClaudeActivity.tsx";
import { useJob } from "../../components/shell/JobLog.tsx";
import { Button, Icon } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { cx, plural } from "../../lib/format.ts";
import { clock, duration, type JobNode, kindLabel, percent, resultLine, subjectLabel } from "../../lib/jobs.ts";
import { errorToast } from "../../lib/toast.ts";
import { JobCard } from "./JobCard.tsx";
import { FullLog } from "./JobFullLog.tsx";
import { JobProblem } from "./JobProblem.tsx";
import { JobState, KindTile, toneOf } from "./JobState.tsx";
import { JobProcesses, JobSteps } from "./JobSteps.tsx";

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

const WHY: Record<string, string> = {
  "after-failure": "After the failure of",
  "follow-up": "Follow-up of",
  retry: "Run again from",
};

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
  const listed = node.job;
  const { job: live, events: list } = useJob(listed.id);
  const job: Job =
    live && (live.status !== "running" || listed.status === "running")
      ? { ...listed, ...live, steps: listed.steps ?? live.steps, processes: listed.processes ?? live.processes }
      : listed;
  const [showLog, setShowLog] = useState(false);
  const cancel = () => call("jobs.cancel", { id: job.id }).catch((e) => errorToast(e, "Could not cancel the job"));
  const rerun = job.rerun;
  const again = rerun
    ? () =>
        call<{ jobId?: string }>(rerun.name, rerun.input, undefined, { jobId: job.id, why: "retry" })
          .then((r) => r?.jobId && onOpen(r.jobId))
          .catch((e) => errorToast(e, "Could not run the job again"))
    : undefined;
  const r = (job.result ?? {}) as { tests?: string[] };
  const claude = list.some((e) => e.type === "claude");
  const changed = [...new Set(list.flatMap((e) => (e.type === "changed" ? e.paths : [])))];
  const carried = new Set((job.steps ?? []).map((s) => s.jobId).filter(Boolean));
  const inside = node.children.filter((n) => !carried.has(n.job.id));
  const loose = (job.processes ?? []).filter((p) => !p.step || !job.steps?.some((s) => s.id === p.step));
  const origin = job.cause ? byId.get(job.cause.jobId) : undefined;
  const diagnosis = node.after.find((n) => n.job.kind === "actions.triage")?.job;
  const label = kindLabel(job.kind);
  const subject = subjectLabel(job, byId);
  const tone = toneOf(job);
  return (
    <aside className="split-side jd" aria-label={`${label} job`}>
      <div className="jd-head">
        <KindTile kind={job.kind} />
        <div className="jd-titles">
          <h2 className="h jd-title">{label}</h2>
          {subject && <div className="jd-subject">{subject}</div>}
        </div>
        {job.status === "running" ? (
          <Button size="sm" icon="stop" onClick={() => void cancel()}>
            Cancel
          </Button>
        ) : (
          again && (
            <Button size="sm" icon="revert" onClick={() => void again()}>
              Run again
            </Button>
          )
        )}
      </div>
      <div className="jd-meta">
        <span className={cx("jd-pill", `t-${tone}`)}>
          {job.status === "running"
            ? `Running · ${duration(job, now)}`
            : `${resultLine(job).split(" · ")[0]} · ${duration(job, now)}`}
        </span>
        <span>
          {clock(job.startedAt)}
          {job.endedAt ? ` → ${clock(job.endedAt)}` : ""}
        </span>
        {origin && job.cause && (
          <span>
            {WHY[job.cause.why]}{" "}
            <button type="button" className="jd-link" onClick={() => onOpen(origin.id)}>
              {kindLabel(origin.kind)}
            </button>
          </span>
        )}
        {job.parentId && byId.get(job.parentId) && (
          <span>
            Inside{" "}
            <button type="button" className="jd-link" onClick={() => onOpen(job.parentId as string)}>
              {kindLabel((byId.get(job.parentId) as Job).kind)}
            </button>
          </span>
        )}
        <button
          type="button"
          className="jd-id"
          title="Copy the job id"
          onClick={() => void navigator.clipboard?.writeText(job.id).catch(() => {})}
        >
          {job.id}
          <Icon name="clone" size={12} />
        </button>
      </div>

      {job.status === "running" && !job.steps?.length && (
        <div className="jd-run">
          <div
            className="prog"
            role="progressbar"
            aria-label={`${label} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent(job) ?? undefined}
          >
            <span
              style={{ width: percent(job) === null ? "35%" : `${percent(job)}%` }}
              className={percent(job) === null ? "prog-busy" : "jt-fill"}
            />
          </div>
          {job.message && <p className="jd-now">{job.message}</p>}
        </div>
      )}

      {job.status === "done" && job.kind === "generate" && !!r.tests?.length && (
        <div className="jd-result">
          <Button tone="primary" icon="right" onClick={() => app.navigate("review", r.tests?.[0])}>
            Review these tests
          </Button>
          <span className="muted">{plural(r.tests.length, "test")} written</span>
        </div>
      )}
      {job.status === "done" && job.kind !== "generate" && resultLine(job).includes(" · ") && (
        <div className="jd-result">
          <JobState job={job} now={now} />
        </div>
      )}

      {(job.status === "failed" || job.interrupted) && (
        <JobProblem job={job} events={list} diagnosis={diagnosis} onRetry={again} onOpen={onOpen} />
      )}

      {!!job.steps?.length && (
        <section className="jd-sect">
          <h3 className="jd-h3">Steps</h3>
          <JobSteps job={job} events={list} byId={byId} now={now} onOpen={onOpen} />
        </section>
      )}

      {inside.length > 0 && (
        <section className="jd-sect">
          <h3 className="jd-h3">Jobs inside · {inside.length}</h3>
          <ul className="jd-cards">
            {inside.map((n) => (
              <li key={n.job.id}>
                <JobCard job={n.job} byId={byId} now={now} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {loose.length > 0 && (
        <section className="jd-sect">
          <h3 className="jd-h3">Processes · {loose.length}</h3>
          <JobProcesses list={loose} now={now} />
        </section>
      )}

      {node.after.length > 0 && (
        <section className="jd-sect">
          <h3 className="jd-h3">
            {job.status === "failed" ? "After this failure" : "Started after it"} · {node.after.length}
          </h3>
          <ul className="jd-cards">
            {node.after.map((n) => (
              <li key={n.job.id}>
                <JobCard job={n.job} byId={byId} now={now} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {claude && <ClaudeActivity events={list} running={job.status === "running"} now={now} />}

      {changed.length > 0 && (
        <section className="jd-sect">
          <h3 className="jd-h3">Files changed · {changed.length}</h3>
          <ul className="jd-files">
            {changed.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {claude && !showLog ? (
        <Button size="sm" tone="quiet" className="jd-showlog" onClick={() => setShowLog(true)}>
          Show the full log
        </Button>
      ) : (
        <FullLog job={job} events={list} />
      )}

      {CLI[job.kind] && (
        <span className="muted jd-cli">
          Same as <span className="mono">{CLI[job.kind]}</span> · log kept in the project folder
        </span>
      )}
    </aside>
  );
}
