import * as stylex from "@stylexjs/stylex";
import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CommandName } from "../../../core/commands/index.ts";
import type { Job } from "../../../core/types.ts";
import { AppContext } from "../../lib/app.ts";
import { project } from "../../lib/data/client.ts";
import { onAnyEvent } from "../../lib/data/events.ts";
import { useCommand, useFetching, useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { problemText, quietLine, quietOf, subjectLabel } from "../../lib/jobs.ts";
import { useNow } from "../../lib/now.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Popover } from "../ui/Popover.tsx";
import { type } from "../ui/type.ts";
import { ActivityGroup, queuedJob } from "./ActivityGroup.tsx";
import { type ActivityItem, ActivityRow } from "./ActivityRow.tsx";

export { elapsed } from "./ActivityRow.tsx";

const styles = stylex.create({
  bar: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  notice: { display: "inline-flex", alignItems: "center", gap: space.s2, color: color.warning, whiteSpace: "nowrap" },
  list: { margin: 0, padding: 0 },
  foot: { display: "flex", alignItems: "center", gap: space.s3, flex: 1 },
  grow: { flex: 1 },
});

const isRunning = (j: unknown): j is Job => !!j && typeof j === "object" && (j as Job).status === "running";

// ponytail: the cache keeps each answer's unchanged parts as they were (structural sharing), so what is left of the jobs
// without their moving parts stays the same list while they only move
const stillOnly = (jobs: Job[]): Job[] =>
  Array.isArray(jobs)
    ? jobs.map(({ message: _m, progress: _p, steps: _s, processes: _x, lastEventAt: _l, stuck: _k, ...j }) => j)
    : jobs;

// ponytail: the running jobs of the open project, as the cache of jobs.list holds them (the event bridge reads it
// again on every start and end); a first read still in the air when a job ends is answered from before that end, so
// a job the stream said ended stays out
// quiet: which jobs run and what they are, not how far they are — a progress line, Claude's words or a step does not
// draw again what only needs the list (the shell, the lock)
export function useRunningJobs({ quiet = false }: { quiet?: boolean } = {}): Job[] {
  const list = useRead("jobs.list", { running: true }, { enabled: !!project(), select: quiet ? stillOnly : undefined });
  const [ended, setEnded] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(
    () =>
      onAnyEvent((e) => {
        if (e.type === "status" && e.job.status !== "running") setEnded((cur) => new Set(cur).add(e.jobId));
      }),
    [],
  );
  return useMemo(
    () => (Array.isArray(list.data) ? list.data.filter((j) => isRunning(j) && !ended.has(j.id)) : []),
    [list.data, ended],
  );
}

// ponytail: the jobs that failed while the page was open — they stay in the top bar until opened or dismissed, so a
// failure nobody was looking at is not lost; a parent's failure stands for its children's, and Claude looking at a
// failure (actions.triage) is not one more
export function useFailures(): { failed: Job[]; dismiss: (id?: string) => void } {
  const [failed, setFailed] = useState<Job[]>([]);
  useEffect(
    () =>
      onAnyEvent((e) => {
        if (e.type !== "status" || e.job.status !== "failed" || e.job.kind === "actions.triage") return;
        const job = e.job;
        setFailed((cur) => [job, ...cur.filter((j) => j.id !== job.id && j.parentId !== job.id)]);
      }),
    [],
  );
  const dismiss = useCallback((id?: string) => setFailed((cur) => (id ? cur.filter((j) => j.id !== id) : [])), []);
  return { failed, dismiss };
}

// ponytail: the last rate-limit notice the event bridge kept (« Jira asks to wait 30 s »)
function useNotice(): string {
  const q = useQuery<string>({ queryKey: ["notice"], queryFn: () => "", enabled: false, staleTime: Infinity });
  return q.data ?? "";
}

// ponytail: the activity indicator of the top bar — how many things run, and on click what they are, how far, since
// when, with Cancel; work the page itself waits on (a Jira tree, a Jira search) shows beside the jobs, and the jobs
// that failed under them, each opening in the job panel. Outside the data layer (a screen drawn alone) it shows nothing
const WAITED_LABEL: Partial<Record<CommandName, string>> = {
  "xray.folders": "Loading the Jira folders",
  "xray.search": "Searching Jira",
};
const WAITED = Object.keys(WAITED_LABEL) as CommandName[];

export function Activity() {
  return useContext(QueryClientContext) ? <LiveActivity /> : null;
}

function LiveActivity() {
  const jobs = useRunningJobs();
  const { failed, dismiss } = useFailures();
  const notice = useNotice();
  const local = useFetching(WAITED);
  const app = useContext(AppContext);
  const [open, setOpen] = useState(false);
  const now = useNow(1000, open);
  const cancel = useCommand("jobs.cancel", { invalidates: [["jobs.list"], ["jobs.show"]] });
  // ponytail: a job running inside another running one is counted under its parent's row, not listed on its own
  const ids = new Set(jobs.map((j) => j.id));
  const top = jobs.filter((j) => !j.parentId || !ids.has(j.parentId));
  const parents = new Set(jobs.flatMap((j) => (j.parentId && ids.has(j.parentId) ? [j.parentId] : [])));
  const every = useRead("jobs.list", {}, { enabled: open && parents.size > 0 && !!project() });
  const kidsOf = (id: string): Job[] => {
    const byId = new Map<string, Job>();
    for (const j of Array.isArray(every.data) ? every.data : []) if (j.parentId === id) byId.set(j.id, j);
    for (const j of jobs) if (j.parentId === id) byId.set(j.id, j);
    return [...byId.values()];
  };
  const itemOf = (j: Job): ActivityItem => {
    const q = quietOf(j, now);
    return {
      key: j.id,
      id: j.id,
      kind: j.kind,
      label: subjectLabel(j, new Map()) || j.kind,
      message: j.message,
      startedAt: j.startedAt,
      progress: j.progress,
      ...(q ? { quiet: { text: quietLine(q), stuck: q.stuck } } : {}),
    };
  };
  const items: (ActivityItem & { job?: Job })[] = [
    ...local.map((w) => ({ key: w.key, kind: "jira", label: WAITED_LABEL[w.name] ?? w.name, startedAt: w.startedAt })),
    ...[...top].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((j) => ({ ...itemOf(j), job: j })),
  ];
  const shown = failed.filter((j) => !jobs.some((r) => r.id === j.id));
  const count = jobs.length + local.length;
  const stop = (id: string) => (
    <Button
      variant="quiet"
      size="xs"
      iconOnly
      icon="stop"
      label="Cancel"
      onClick={() => cancel.mutate({ id }, { onError: (e) => errorToast(e, "Could not cancel the job") })}
    />
  );
  const all = count + shown.length;
  const openJob = (id: string) => () => {
    setOpen(false);
    dismiss(id);
    app?.openJob(id);
  };
  useEffect(() => {
    if (!all) setOpen(false);
  }, [all]);
  useEffect(() => {
    if (!open) return;
    const shut = () => setOpen(false);
    window.addEventListener("resize", shut);
    return () => window.removeEventListener("resize", shut);
  }, [open]);

  return (
    <span {...stylex.props(styles.bar)}>
      {notice && (
        <span role="status" {...stylex.props(type.small, styles.notice)}>
          <Icon name="clock" size="sm" />
          {notice}
        </span>
      )}
      {all > 0 && (
        <Popover
          title={count ? "Running" : "Failed"}
          count={count || shown.length}
          width="sm"
          flush
          foot={
            <span {...stylex.props(styles.foot)}>
              Esc or a click outside closes this
              <span {...stylex.props(styles.grow)} />
              {shown.length > 1 && (
                <Button variant="quiet" size="sm" label="Dismiss the failures" onClick={() => dismiss()} />
              )}
            </span>
          }
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button
              variant="quiet"
              icon={count ? "spinner" : "x-circle"}
              label={[count ? `${plural(count, "job")} running` : "", shown.length ? `${shown.length} failed` : ""]
                .filter(Boolean)
                .join(" · ")}
            />
          }
        >
          <ul {...stylex.props(styles.list)}>
            {items.map(({ job, ...item }) => {
              const kids = job && parents.has(job.id) ? kidsOf(job.id) : [];
              const inside = kids.filter((k) => k.status === "running" && !queuedJob(k));
              return (
                <ActivityRow
                  key={item.key}
                  item={item}
                  now={now}
                  onOpen={app && item.id ? openJob(item.id) : undefined}
                  action={item.id && stop(item.id)}
                >
                  {kids.length > 0 && (
                    <ActivityGroup kids={kids} running={inside.length}>
                      {inside.map((k) => (
                        <ActivityRow
                          key={k.id}
                          item={itemOf(k)}
                          now={now}
                          onOpen={app ? openJob(k.id) : undefined}
                          action={stop(k.id)}
                        />
                      ))}
                    </ActivityGroup>
                  )}
                </ActivityRow>
              );
            })}
            {shown.map((j) => (
              <ActivityRow
                key={j.id}
                item={{
                  key: j.id,
                  id: j.id,
                  kind: j.kind,
                  label: subjectLabel(j, new Map()) || j.kind,
                  startedAt: j.startedAt,
                  endedAt: j.endedAt ?? j.startedAt,
                  error: `Failed · ${problemText(j).what}`,
                }}
                now={now}
                onOpen={app ? openJob(j.id) : undefined}
                action={
                  <Button
                    variant="quiet"
                    size="xs"
                    iconOnly
                    icon="close"
                    label="Dismiss"
                    onClick={() => dismiss(j.id)}
                  />
                }
              />
            ))}
          </ul>
        </Popover>
      )}
    </span>
  );
}
