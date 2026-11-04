import * as stylex from "@stylexjs/stylex";
import type { PlanOp } from "../../../../core/types.ts";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { Progress } from "../../../components/ui/Progress.tsx";
import { fontFamily, fontSize, space } from "../../../styles/tokens.stylex.ts";
import type { Failure, PushResult } from "../PushDialog.tsx";
import { type OpState, OpsTable } from "./OpsTable.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
});

// the push at work, op by op; stopped, it says where and why and resumes from that operation
export function PushProgress({
  name,
  summary,
  ops,
  running,
  done,
  from,
  result,
  failure,
  onClose,
  onResume,
}: {
  name: string;
  summary?: string;
  ops: PlanOp[];
  running: boolean;
  done: number;
  from: number;
  result: PushResult | null;
  failure: Failure | null;
  onClose: () => void;
  onResume: (at: number) => void;
}) {
  const failedAt = result?.failedAt ?? (running ? -1 : done);
  const state = (i: number): OpState => {
    const r = result?.ops[i];
    if (r && (!running || r.status !== "not-started")) return r.status;
    if (i < done) return "done";
    if (running && i === done) return "running";
    if (!running && i === failedAt) return "failed";
    return "not-started";
  };
  const counts = ops.reduce(
    (c, _, i) => {
      const s = state(i);
      if (s === "done") c.done++;
      else if (s === "failed") c.failed++;
      else c.left++;
      return c;
    },
    { done: 0, failed: 0, left: 0 },
  );
  const detail = `${counts.done} done${counts.failed ? ` · ${counts.failed} failed` : ""} · ${counts.left} not started${
    from > 0 && running ? ` · resumed at ${from + 1}` : ""
  }`;
  // ponytail: Jira's refusal sits under the operation it stopped at; with no operation to hold it, it heads the body
  const placed = !running && !!failure && failedAt >= 0 && failedAt < ops.length;
  return (
    <Modal
      title={running ? `Pushing ${name} to Jira` : `Push stopped at operation ${failedAt + 1} of ${ops.length}`}
      subtitle={
        summary || name ? (
          <>
            {summary}
            {summary && name ? " · " : ""}
            <span {...stylex.props(styles.mono)}>{name}</span>
          </>
        ) : undefined
      }
      icon={running ? "push" : "alert-circle"}
      busy={running}
      actions={
        running ? (
          <Button variant="primary" icon="push" label="Push to Jira" loading />
        ) : (
          <>
            <Button label="Close" onClick={onClose} />
            <Button
              variant="primary"
              icon="play"
              label={`Resume from operation ${failedAt + 1}`}
              onClick={() => onResume(Math.max(failedAt, 0))}
            />
          </>
        )
      }
      onClose={onClose}
    >
      <div {...stylex.props(styles.body)}>
        <Progress
          label={`${counts.done} of ${ops.length} operations done`}
          value={ops.length ? (counts.done / ops.length) * 100 : 0}
          detail={detail}
        />
        {!running && failure && !placed && (
          <Banner tone="danger" compact>
            {failure.message}
          </Banner>
        )}
        <OpsTable ops={ops} state={state} error={(i) => (placed && i === failedAt ? failure?.message : undefined)} />
        {!running && failure && (
          <Banner tone="warning" title="What to do">
            {failure.fix ?? "Fix what Jira refused, then resume. What is already in Jira stays there."}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
