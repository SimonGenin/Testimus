import { type CSSProperties, useCallback, useEffect, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { ApiError, call, events } from "../../api.ts";
import { ClaudeActivity } from "../../components/claude/ClaudeActivity.tsx";
import { JobLog, useJob } from "../../components/shell/JobLog.tsx";
import { ProblemPanel } from "../../components/shell/ProblemPanel.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Button, DragEdge, Icon, Severity, Skeleton } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { cx, plural } from "../../lib/format.ts";
import { duration, kindLabel, percent, resultLine } from "../../lib/jobs.ts";
import { useSideWidth } from "../../lib/sideWidth.ts";
import { errorToast } from "../../lib/toast.ts";

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
};

export function JobState({ job, now }: { job: Job; now: number }) {
  const text = resultLine(job);
  if (job.status === "running")
    return (
      <span className="sev s-run">
        <span className="dot run-dot" />
        Running · {duration(job, now)}
      </span>
    );
  if (job.status === "done") return <Severity tone="ok">{text}</Severity>;
  if (job.status === "cancelled")
    return (
      <span className="sev s-stop">
        <Icon name="stop" />
        {text}
      </span>
    );
  return <Severity tone="error">{text}</Severity>;
}

function Progress({ job, label }: { job: Job; label: string }) {
  const pct = percent(job);
  if (job.status !== "running")
    return <span className="muted">{job.progress ? `${job.progress.done} of ${job.progress.total}` : "—"}</span>;
  return (
    <div className="jobprog">
      <div
        className="prog"
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <span style={{ width: pct === null ? "35%" : `${pct}%` }} className={pct === null ? "prog-busy" : undefined} />
      </div>
      {(job.message || job.progress) && (
        <span className="muted tbl-sub">{job.message || `${job.progress?.done} of ${job.progress?.total}`}</span>
      )}
    </div>
  );
}

export function JobsScreen() {
  const app = useApp();
  const [sideW, sideEdge] = useSideWidth("testimus.jobsSideWidth", 320, 800, "after");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const routeId = app.route.screen === "jobs" ? (app.route.arg ?? "") : "";
  const activeId = routeId || jobs?.[0]?.id || "";

  const load = useCallback(() => {
    call<Job[]>("jobs.list", {})
      .then((r) => setJobs(Array.isArray(r) ? r : []))
      .catch((e) => {
        setJobs([]);
        errorToast(e, "Could not list the jobs");
      });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a project switch lists its own jobs
  useEffect(() => {
    load();
    return events((e) => {
      if (e.type === "status")
        setJobs((cur) => {
          if (!cur) return cur;
          const i = cur.findIndex((j) => j.id === e.job.id);
          return i < 0 ? [e.job, ...cur] : cur.map((j) => (j.id === e.job.id ? e.job : j));
        });
      else if (e.type === "progress")
        setJobs(
          (cur) =>
            cur?.map((j) =>
              j.id === e.jobId
                ? {
                    ...j,
                    message: e.message,
                    progress: e.total !== undefined ? { done: e.done ?? 0, total: e.total } : j.progress,
                  }
                : j,
            ) ?? cur,
        );
    });
  }, [load, app.info?.dir]);

  const anyRunning = !!jobs?.some((j) => j.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const running = jobs?.filter((j) => j.status === "running").length ?? 0;
  const active = jobs?.find((j) => j.id === activeId) ?? null;

  return (
    <div className="screen">
      <ScreenHeader
        title="Jobs"
        meta={`${running ? `${running} running · ` : ""}long work runs here, you can keep working meanwhile`}
      />
      <div className="split" style={sideW ? ({ "--side-size": `${sideW}px` } as CSSProperties) : undefined}>
        <section className="split-main scroll" aria-label="Job list">
          {!jobs ? (
            <table className="tbl" aria-busy="true">
              <tbody>
                {[0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td>
                      <Skeleton w={120} h={13} />
                      <Skeleton w={180} h={10} />
                    </td>
                    <td>
                      <Skeleton w={140} h={6} />
                    </td>
                    <td>
                      <Skeleton w={36} h={12} />
                    </td>
                    <td>
                      <Skeleton w={110} h={14} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !jobs.length ? (
            <div className="empty">
              <Icon name="jobs" size={40} />
              <h2 className="h">No job yet</h2>
              <p>Adding a document, generating tests, checking them, pulling or pushing: long work shows up here.</p>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.id}
                    className={cx(j.id === activeId && "row-on")}
                    aria-selected={j.id === activeId}
                    tabIndex={0}
                    onClick={() => app.navigate("jobs", j.id)}
                    onKeyDown={(e) => e.key === "Enter" && app.navigate("jobs", j.id)}
                  >
                    <td>
                      <div>{kindLabel(j.kind)}</div>
                      <div className="muted tbl-sub">{j.subject}</div>
                    </td>
                    <td>
                      <Progress job={j} label={kindLabel(j.kind)} />
                    </td>
                    <td className="mono">{duration(j, now)}</td>
                    <td>
                      <JobState job={j} now={now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {active && <DragEdge className="side-edge" label="Resize the job details" {...sideEdge} />}
        {active && <JobDetail job={active} now={now} />}
      </div>
    </div>
  );
}

function JobDetail({ job: listed, now }: { job: Job; now: number }) {
  const app = useApp();
  const { job: live, events: list } = useJob(listed.id);
  const job = live && (live.status !== "running" || listed.status === "running") ? { ...listed, ...live } : listed;
  const cancel = () => call("jobs.cancel", { id: job.id }).catch((e) => errorToast(e, "Could not cancel the job"));
  const r = (job.result ?? {}) as { tests?: string[] };
  const pct = percent(job);
  return (
    <aside className="split-side jobdetail" aria-label={`${kindLabel(job.kind)} job`}>
      <div className="jobdetail-head">
        <h2 className="h jobdetail-title">{kindLabel(job.kind)}</h2>
        <JobState job={job} now={now} />
        <span className="spacer" />
        {job.status === "running" && (
          <Button size="sm" icon="stop" onClick={() => void cancel()}>
            Cancel
          </Button>
        )}
      </div>
      <p className="muted">{job.subject}</p>
      {job.status === "running" && (
        <>
          <div
            className="prog"
            role="progressbar"
            aria-label={`${kindLabel(job.kind)} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            <span
              style={{ width: pct === null ? "35%" : `${pct}%` }}
              className={pct === null ? "prog-busy" : undefined}
            />
          </div>
          {job.message && <p>{job.message}</p>}
        </>
      )}
      {job.status === "failed" && (
        <ProblemPanel error={new ApiError(job.error ?? "The job failed.")} doing={kindLabel(job.kind)} />
      )}
      {job.kind === "generate" && job.status === "done" && !!r.tests?.length && (
        <div className="jobdetail-actions">
          <Button tone="primary" icon="right" onClick={() => app.navigate("review", r.tests?.[0])}>
            Review these tests
          </Button>
          <span className="muted">{plural(r.tests.length, "test")} written</span>
        </div>
      )}
      {list.some((e) => e.type === "claude") ? (
        <ClaudeActivity events={list} running={job.status === "running"} now={now} />
      ) : (
        <JobLog events={list} />
      )}
      {CLI[job.kind] && (
        <span className="muted jobdetail-cli">
          Same as <span className="mono">{CLI[job.kind]}</span> · log kept in the project folder
        </span>
      )}
    </aside>
  );
}
