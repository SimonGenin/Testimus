import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { Job } from "../../../core/types.ts";
import { call, events } from "../../api.ts";
import { Button, Confirm, DragEdge, Icon, Segmented, Skeleton } from "../../components/legacy/index.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import {
  applyEvent,
  groupRepeats,
  isRunning,
  type JobNode,
  jobTree,
  kindLabel,
  sections,
  subjectLabel,
  subtree,
} from "../../lib/jobs.ts";
import { useSideWidth } from "../../lib/sideWidth.ts";
import { errorToast } from "../../lib/toast.ts";
import { JobDetail } from "./JobDetail.tsx";
import { JobRows, type RowCtx } from "./JobRows.tsx";

export { JobState } from "./JobState.tsx";

type StatusFilter = "all" | "running" | "failed" | "done" | "stopped";

const TYPES: { id: string; label: string; kinds: (k: string) => boolean }[] = [
  { id: "documents", label: "Documents", kinds: (k) => k.startsWith("docs.") || k === "describe-figures" },
  { id: "index", label: "Index", kinds: (k) => k === "rag-index" || k === "search-index" },
  { id: "generate", label: "Generate", kinds: (k) => k === "generate" },
  { id: "check", label: "Check", kinds: (k) => k === "check" },
  {
    id: "claude",
    label: "Claude runs",
    kinds: (k) => ["claude", "actions.triage", "fix", "chat", "columns"].includes(k),
  },
  { id: "xray", label: "Jira and Xray", kinds: (k) => k === "pull" || k === "push" },
  {
    id: "models",
    label: "Models",
    kinds: (k) => k.startsWith("models-") || ["pullModel", "rag-eval", "gen-bench", "agents-test"].includes(k),
  },
];

const statusOf = (j: Job): Exclude<StatusFilter, "all"> =>
  j.status === "running"
    ? "running"
    : j.status === "done"
      ? "done"
      : j.status === "failed" && !j.interrupted
        ? "failed"
        : "stopped";

const leaf = (job: Job): JobNode => ({ job, children: [], after: [], repeats: [] });

function findNode(nodes: JobNode[], id: string): JobNode | null {
  for (const n of nodes) {
    if (n.job.id === id) return n;
    const r = n.repeats.find((j) => j.id === id);
    if (r) return leaf(r);
    const deeper = findNode([...n.children, ...n.after], id);
    if (deeper) return deeper;
  }
  return null;
}

function readGroup(): boolean {
  try {
    return localStorage.getItem("testimus.jobsGroup") !== "0";
  } catch {
    return true;
  }
}

export function JobsScreen() {
  const app = useApp();
  const [sideW, sideEdge] = useSideWidth("testimus.jobsSideWidth", 360, 820, "after");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState("all");
  const [group, setGroup] = useState(readGroup);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [clearing, setClearing] = useState(false);
  const routeId = app.route.screen === "jobs" ? (app.route.arg ?? "") : "";

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
    return events((e) => setJobs((cur) => (cur ? applyEvent(cur, e) : cur)));
  }, [load, app.info?.dir]);

  const anyRunning = !!jobs?.some((j) => j.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const byId = useMemo(() => new Map((jobs ?? []).map((j) => [j.id, j])), [jobs]);
  const tree = useMemo(() => jobTree(jobs ?? []), [jobs]);
  const kinds = TYPES.find((t) => t.id === type)?.kinds;
  const needle = text.trim().toLowerCase();
  const shown = useMemo(() => {
    const keep = (n: JobNode) =>
      subtree(n).some(
        (j) =>
          (status === "all" || statusOf(j) === status) &&
          (!kinds || kinds(j.kind)) &&
          (!needle ||
            `${kindLabel(j.kind)} ${subjectLabel(j, byId)} ${j.subject} ${j.id}`.toLowerCase().includes(needle)),
      );
    const roots = tree.filter(keep);
    return group ? groupRepeats(roots) : roots;
  }, [tree, status, kinds, needle, group, byId]);

  const activeId = routeId || shown[0]?.job.id || "";
  const active = activeId ? findNode(tree, activeId) : null;
  const counts = (s: StatusFilter) => (jobs ?? []).filter((j) => s === "all" || statusOf(j) === s).length;
  const finished = (jobs ?? []).filter((j) => j.status !== "running").length;
  const running = counts("running");
  const present = TYPES.filter((t) => (jobs ?? []).some((j) => t.kinds(j.kind)));

  const ctx: RowCtx = {
    byId,
    activeId,
    now,
    isOpen: (n) =>
      open[n.job.id] ??
      (isRunning(n) ||
        (n.job.status === "failed" && n.after.length > 0) ||
        (activeId !== n.job.id && subtree(n).some((j) => j.id === activeId))),
    toggle: (id, v) => setOpen((o) => ({ ...o, [id]: v })),
    pick: (id) => app.navigate("jobs", id),
  };

  const clear = () =>
    call<{ cleared: number }>("jobs.clear", {})
      .then(() => {
        setClearing(false);
        setJobs((cur) => cur?.filter((j) => j.status === "running") ?? cur);
        if (routeId && byId.get(routeId)?.status !== "running") app.navigate("jobs");
      })
      .catch((e) => {
        setClearing(false);
        errorToast(e, "Could not clear the jobs");
      });

  const filtered = status !== "all" || type !== "all" || !!needle;

  return (
    <div className="screen">
      <ScreenHeader
        title="Jobs"
        meta={`${running ? `${running} running · ` : ""}long work runs here, you can keep working meanwhile`}
      />
      <div className="split" style={sideW ? ({ "--side-size": `${sideW}px` } as CSSProperties) : undefined}>
        <section className="split-main jt" aria-label="Job list">
          <div className="jt-bar">
            <label className="jt-search">
              <Icon name="search" size={14} />
              <input
                aria-label="Filter jobs"
                placeholder="Filter by job, document or test"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <Segmented<StatusFilter>
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All", count: counts("all") },
                { value: "running", label: "Running", count: counts("running") },
                { value: "failed", label: "Failed", count: counts("failed") },
                { value: "done", label: "Done", count: counts("done") },
                { value: "stopped", label: "Stopped", count: counts("stopped") },
              ]}
            />
            {present.length > 1 && (
              <label className="jt-type">
                Type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="all">All types</option>
                  {present.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="spacer" />
            <label className="jt-group">
              <input
                type="checkbox"
                checked={group}
                onChange={(e) => {
                  setGroup(e.target.checked);
                  try {
                    localStorage.setItem("testimus.jobsGroup", e.target.checked ? "1" : "0");
                  } catch {}
                }}
              />
              Group repeats
            </label>
            <Button size="sm" tone="quiet" icon="trash" disabled={!finished} onClick={() => setClearing(true)}>
              Clear finished
            </Button>
          </div>
          <div className="scroll">
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
                        <Skeleton w={110} h={14} />
                      </td>
                      <td>
                        <Skeleton w={120} h={6} />
                      </td>
                      <td>
                        <Skeleton w={36} h={12} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !jobs.length ? (
              <div className="empty">
                <Icon name="jobs" size={40} />
                <h2 className="h">No job yet</h2>
                <p>
                  Adding, converting or indexing a document, generating or checking tests, pulling or pushing: long work
                  runs here, with its steps, the jobs it starts and the processes it uses.
                </p>
              </div>
            ) : !shown.length ? (
              <div className="empty">
                <h2 className="h">No job matches</h2>
                {filtered && (
                  <Button
                    onClick={() => {
                      setText("");
                      setStatus("all");
                      setType("all");
                    }}
                  >
                    Clear the filters
                  </Button>
                )}
              </div>
            ) : (
              <table className="tbl jt-tbl" aria-label="Jobs">
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col" className="jt-col-status">
                      Status
                    </th>
                    <th scope="col" className="jt-col-prog">
                      Progress
                    </th>
                    <th scope="col" className="jt-col-time">
                      Time
                    </th>
                  </tr>
                </thead>
                {sections(shown, now).map((s) => (
                  <tbody key={s.title}>
                    <tr className="jt-section">
                      <th colSpan={4} scope="colgroup" className={s.title === "Running" ? "t-run" : undefined}>
                        {s.title} · {s.nodes.length}
                      </th>
                    </tr>
                    {s.nodes.map((n) => (
                      <JobRows key={n.job.id} node={n} depth={0} c={ctx} />
                    ))}
                  </tbody>
                ))}
              </table>
            )}
          </div>
        </section>
        {active && <DragEdge className="side-edge" label="Resize the job details" {...sideEdge} />}
        {active && <JobDetail node={active} byId={byId} now={now} onOpen={ctx.pick} />}
      </div>
      {clearing && (
        <Confirm
          title={`Clear ${plural(finished, "finished job")}?`}
          confirm="Clear"
          danger
          onConfirm={() => void clear()}
          onClose={() => setClearing(false)}
        >
          <p>
            Done, failed and cancelled jobs leave the list and their logs are deleted from the project folder. Running
            jobs stay. Tests, documents and the index are not touched.
          </p>
        </Confirm>
      )}
    </div>
  );
}
