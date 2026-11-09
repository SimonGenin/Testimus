import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Job } from "../../../core/types.ts";
import { useClaudeTab } from "../../components/claude/ClaudeTab.tsx";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { List } from "../../components/ui/List.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Pane } from "../../components/ui/Pane.tsx";
import { Workspace } from "../../components/ui/workspace/Workspace.tsx";
import { useApp } from "../../lib/app.ts";
import { key, useCommand } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { column, layoutOf, section } from "../../lib/workspace/layout.ts";
import { useWorkspace } from "../../lib/workspace/useWorkspace.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { useCancel } from "../settings/jobs.ts";
import { JobDetail, JobDetailSkeleton } from "./JobDetail.tsx";
import { JobList, type ListCtx, openByDefault } from "./JobList.tsx";
import { JobsActions, JobsTools } from "./JobsToolbar.tsx";
import { findNode } from "./kinds.ts";
import { NO_FILTER, useJobs } from "./useJobs.ts";

export { JobState } from "./JobState.tsx";

const styles = stylex.create({
  screen: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" },
  list: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", containerType: "inline-size" },
  notice: { padding: space.s4 },
  none: { flex: 1, display: "flex", padding: space.s7 },
});

// ponytail: the jobs on the left, the one open in the middle, Claude folded on the right
const LAYOUT = layoutOf(
  column(null, section(["jobs"])),
  column(600, section(["job"])),
  column(380, section(["claude"], true)),
);

export function JobsScreen() {
  const app = useApp();
  const stop = useCancel();
  const j = useJobs();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [clearing, setClearing] = useState(false);
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
    cancel: stop,
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

  const listTab = (
    <div {...stylex.props(styles.list)}>
      <Pane
        label="Job list"
        fill
        tools={<JobsTools filters={j.filters} onFilters={j.setFilters} count={j.count} present={j.present} />}
        actions={
          <JobsActions group={j.group} onGroup={j.setGroup} finished={j.finished} onClear={() => setClearing(true)} />
        }
      >
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
          <List
            label="Jobs"
            items={[]}
            getKey={() => ""}
            renderItem={() => ({ title: "" })}
            loading={5}
            reading="jobs.list"
          />
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
                  actions={j.filtered && <Button label="Clear the filters" onClick={() => j.setFilters(NO_FILTER)} />}
                />
              )
            }
          />
        )}
      </Pane>
    </div>
  );
  const claude = useClaudeTab();
  const ws = useWorkspace({
    pref: "layoutJobs",
    label: "Jobs",
    defaults: LAYOUT,
    tabs: [
      { id: "jobs", label: "Jobs", icon: "jobs", count: j.jobs?.length, content: listTab },
      {
        id: "job",
        label: active ? "Job" : "Job",
        icon: "info",
        main: true,
        content: active ? (
          <JobDetail node={active} byId={j.byId} now={j.now} onOpen={ctx.pick} />
        ) : !j.jobs && !j.failed ? (
          <JobDetailSkeleton />
        ) : (
          <div {...stylex.props(styles.none)}>
            <EmptyState
              icon="info"
              title="No job open"
              text="Pick a job in the list to see its steps, its log and what it made."
            />
          </div>
        ),
      },
      claude,
    ],
  });

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader title="Jobs" />
      <Workspace ws={ws} />
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
