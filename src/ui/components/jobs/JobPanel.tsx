import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Screen } from "../../lib/app.ts";
import { kindLabel, subjectLabel } from "../../lib/jobs.ts";
import { useNow } from "../../lib/now.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Loading } from "../ui/Loading.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Pane } from "../ui/Pane.tsx";
import { type } from "../ui/type.ts";
import { JobView } from "./JobView.tsx";
import { kindIcon } from "./kinds.ts";
import { useJobDetail } from "./useJobDetail.ts";

const styles = stylex.create({
  tab: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", backgroundColor: color.surface },
  tabBody: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingBlock: space.s5,
    paddingInline: space.s6,
  },
  subject: { margin: 0, color: color.textMuted },
});

// ponytail: one job, wherever it was opened from (a toast, the activity of the top bar, a screen that started it) — in
// the screen's Job tab (frame "tab"), or a dialog where a screen has no sections; a job it links to (its origin, a
// step's own job, the diagnosis) opens in its place; going to what it made closes it
export function JobPanel({
  id: first,
  frame = "modal",
  onClose,
  onGo,
}: {
  id: string;
  frame?: "modal" | "tab";
  onClose: () => void;
  onGo: (screen: Screen, id?: string) => void;
}) {
  const [id, setId] = useState(first);
  const d = useJobDetail(id, setId);
  const now = useNow(1000, d.job?.status === "running");
  const go = (screen: Screen, to?: string) => {
    onClose();
    onGo(screen, to);
  };
  const title = d.job ? kindLabel(d.job.kind) : "Job";
  const subject = d.job ? subjectLabel(d.job, d.byId) || undefined : undefined;
  const body = d.job ? (
    <JobView
      job={d.job}
      events={d.events}
      byId={d.byId}
      diagnosis={d.diagnosis}
      now={now}
      onCancel={d.cancel}
      onAgain={d.again}
      onOpen={setId}
      onGo={go}
    />
  ) : d.failed ? (
    <EmptyState icon="info" title="This job is gone" text="Its log was deleted: a finished job is kept 30 days." />
  ) : (
    <Loading read="jobs.show" />
  );
  if (frame === "tab")
    return (
      <div {...stylex.props(styles.tab)}>
        <Pane
          as="aside"
          title={title}
          fill
          actions={<Button size="sm" variant="quiet" iconOnly icon="close" label="Close the job" onClick={onClose} />}
        >
          <div {...stylex.props(styles.tabBody)}>
            {subject && <p {...stylex.props(type.body, styles.subject)}>{subject}</p>}
            {body}
          </div>
        </Pane>
      </div>
    );
  return (
    <Modal
      title={title}
      subtitle={subject}
      icon={d.job ? kindIcon(d.job.kind) : "jobs"}
      drawer="right"
      onClose={onClose}
    >
      {body}
    </Modal>
  );
}
