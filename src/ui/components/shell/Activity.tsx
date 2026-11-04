import * as stylex from "@stylexjs/stylex";
import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useMemo, useState } from "react";
import type { CommandName } from "../../../core/commands/index.ts";
import type { Job } from "../../../core/types.ts";
import { AppContext } from "../../lib/app.ts";
import { project } from "../../lib/data/client.ts";
import { onAnyEvent } from "../../lib/data/events.ts";
import { useCommand, useFetching, useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Popover } from "../ui/Popover.tsx";
import { type } from "../ui/type.ts";
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

// ponytail: the running jobs of the open project, as the cache of jobs.list holds them (the event bridge reads it
// again on every start and end); a first read still in the air when a job ends is answered from before that end, so
// a job the stream said ended stays out
export function useRunningJobs(): Job[] {
  const list = useRead("jobs.list", { running: true }, { enabled: !!project() });
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

// ponytail: the last rate-limit notice the event bridge kept (« Jira asks to wait 30 s »)
function useNotice(): string {
  const q = useQuery<string>({ queryKey: ["notice"], queryFn: () => "", enabled: false, staleTime: Infinity });
  return q.data ?? "";
}

// ponytail: the activity indicator of the top bar — how many things run, and on click what they are, how far, since
// when, with Cancel; work the page itself waits on (a Jira tree, a Jira search) shows beside the jobs. Outside the data
// layer (a screen drawn alone) it shows nothing
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
  const notice = useNotice();
  const local = useFetching(WAITED);
  const app = useContext(AppContext);
  const [open, setOpen] = useState(false);
  const now = useNow(1000, open);
  const cancel = useCommand("jobs.cancel", { invalidates: [["jobs.list"], ["jobs.show"]] });
  const items: ActivityItem[] = [
    ...local.map((w) => ({ key: w.key, kind: "jira", label: WAITED_LABEL[w.name] ?? w.name, startedAt: w.startedAt })),
    ...[...jobs]
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((j) => ({
        key: j.id,
        id: j.id,
        kind: j.kind,
        label: j.subject || j.kind,
        message: j.message,
        startedAt: j.startedAt,
        progress: j.progress,
      })),
  ];
  const count = items.length;
  const openJob = (id: string) => () => {
    setOpen(false);
    app?.navigate("jobs", id);
  };
  useEffect(() => {
    if (!count) setOpen(false);
  }, [count]);
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
      {count > 0 && (
        <Popover
          title="Running"
          count={count}
          width="sm"
          flush
          foot={
            <span {...stylex.props(styles.foot)}>
              Esc or a click outside closes this
              <span {...stylex.props(styles.grow)} />
              {app && (
                <Button
                  variant="quiet"
                  size="sm"
                  label="Open Jobs"
                  onClick={() => {
                    setOpen(false);
                    app.navigate("jobs");
                  }}
                />
              )}
            </span>
          }
          open={open}
          onOpenChange={setOpen}
          trigger={<Button variant="quiet" icon="spinner" label={`${plural(count, "job")} running`} />}
        >
          <ul {...stylex.props(styles.list)}>
            {items.map((item) => (
              <ActivityRow
                key={item.key}
                item={item}
                now={now}
                onOpen={app && item.id ? openJob(item.id) : undefined}
                action={
                  item.id && (
                    <Button
                      variant="quiet"
                      size="xs"
                      iconOnly
                      icon="stop"
                      label="Cancel"
                      onClick={() =>
                        cancel.mutate(
                          { id: item.id as string },
                          { onError: (e) => errorToast(e, "Could not cancel the job") },
                        )
                      }
                    />
                  )
                }
              />
            ))}
          </ul>
        </Popover>
      )}
    </span>
  );
}
