import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Job } from "../../../core/types.ts";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { List } from "../../components/ui/List.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { useApp } from "../../lib/app.ts";
import { key, useCommand } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { usePaneWidth } from "../../lib/panes.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { JobDetail } from "./JobDetail.tsx";
import { JobList, type ListCtx, openByDefault } from "./JobList.tsx";
import { JobsToolbar } from "./JobsToolbar.tsx";
import { findNode } from "./kinds.ts";
import { NO_FILTER, useJobs } from "./useJobs.ts";

export { JobState } from "./JobState.tsx";

const styles = stylex.create({
  screen: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" },
  split: { flex: 1, minHeight: 0, display: "flex" },
  list: {
    flex: "1 1 0",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    containerType: "inline-size",
    backgroundColor: color.surface,
  },
  scroll: { boxSizing: "border-box", flex: 1, minHeight: 0, overflowY: "auto", padding: space.s2 },
  notice: { padding: space.s4 },
  side: { flexShrink: 0, minHeight: 0, maxWidth: "55%", display: "flex" },
});

const SIDE = { min: 360, max: 820, initial: 600 };

export function JobsScreen() {
  const app = useApp();
  const j = useJobs();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [clearing, setClearing] = useState(false);
  const side = usePaneWidth("jobsSideWidth", SIDE);
  const routeId = app.route.screen === "jobs" ? (app.route.arg ?? "") : "";
  const clear = useCommand("jobs.clear", {
    invalidates: [["jobs.list"]],
    optimistic: (c) => {
      const k = key("jobs.list", {});
      const before = c.getQueryData<Job[]>(k);
      c.setQueryData<Job[]>(k, (cur) => cur?.filter((x) => x.status === "running"));
      return () => c.setQueryData(k, before);
    },
  });

  const activeId = routeId || j.shown[0]?.job.id || "";
  const active = activeId ? findNode(j.tree, activeId) : null;
  const ctx: ListCtx = {
    byId: j.byId,
    activeId,
    now: j.now,
    isOpen: (n) => open[n.job.id] ?? openByDefault(n, activeId),
    toggle: (id, v) => setOpen((o) => ({ ...o, [id]: v })),
    pick: (id) => app.navigate("jobs", id),
  };

  const doClear = async () => {
    try {
      await clear.mutateAsync({});
      if (routeId && j.byId.get(routeId)?.status !== "running") app.navigate("jobs");
    } catch (e) {
      errorToast(e, "Could not clear the jobs");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader title="Jobs" />
      <div {...stylex.props(styles.split)}>
        <section aria-label="Job list" {...stylex.props(styles.list)}>
          <JobsToolbar
            filters={j.filters}
            onFilters={j.setFilters}
            count={j.count}
            present={j.present}
            group={j.group}
            onGroup={j.setGroup}
            finished={j.finished}
            onClear={() => setClearing(true)}
          />
          <div {...stylex.props(styles.scroll)}>
            {j.failed ? (
              <div {...stylex.props(styles.notice)}>
                <Banner
                  tone="danger"
                  title="Could not list the jobs"
                  actions={<Button size="sm" label="Retry" onClick={j.retry} />}
                >
                  The jobs of this project could not be read. No job yet is shown until they are.
                </Banner>
              </div>
            ) : !j.jobs ? (
              <List label="Jobs" items={[]} getKey={() => ""} renderItem={() => ({ title: "" })} loading={5} divided />
            ) : (
              <JobList
                shown={j.shown}
                c={ctx}
                empty={
                  !j.jobs.length ? (
                    <EmptyState
                      icon="jobs"
                      title="No job yet"
                      text="Adding, converting or indexing a document, generating or checking tests, pulling or pushing: long work runs here, with its steps, the jobs it starts and the processes it uses."
                    />
                  ) : (
                    <EmptyState
                      icon="filter"
                      title="No job matches"
                      compact
                      actions={
                        j.filtered && <Button label="Clear the filters" onClick={() => j.setFilters(NO_FILTER)} />
                      }
                    />
                  )
                }
              />
            )}
          </div>
        </section>
        {active && (
          <>
            <ResizeHandle label="Resize the job details" side="left" {...side.handle} />
            <div {...stylex.props(styles.side)} style={{ width: side.width }}>
              <JobDetail node={active} byId={j.byId} now={j.now} onOpen={ctx.pick} />
            </div>
          </>
        )}
      </div>
      {clearing && (
        <Modal
          title={`Clear ${plural(j.finished, "finished job")}?`}
          size="sm"
          busy={clear.isPending}
          confirm={{ verb: "Clear", danger: true, onConfirm: doClear }}
          onClose={() => setClearing(false)}
        >
          Done, failed and cancelled jobs leave the list and their logs are deleted from the project folder. Running
          jobs stay. Tests, documents and the index are not touched.
        </Modal>
      )}
    </div>
  );
}
