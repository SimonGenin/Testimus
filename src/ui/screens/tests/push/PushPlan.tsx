import * as stylex from "@stylexjs/stylex";
import type { Review } from "../../../../core/types.ts";
import { REVIEW } from "../../../components/ui/Badge.tsx";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { Skeleton } from "../../../components/ui/Skeleton.tsx";
import { plural } from "../../../lib/format.ts";
import { color, fontFamily, fontSize, fontWeight, lineHeight, space } from "../../../styles/tokens.stylex.ts";
import type { Failure, Plan } from "../PushDialog.tsx";
import { OpsTable } from "./OpsTable.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  what: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
  mono: { fontFamily: fontFamily.mono },
  text: { margin: 0 },
});

// the plan of a push, before anything is written: what will happen in Jira, what to know first, and the same as a command
export function PushPlan({
  testId,
  testKey,
  summary,
  review,
  plan,
  error,
  onCompare,
  onClose,
  onConfirm,
}: {
  testId: string;
  testKey?: string;
  summary: string;
  review: Review;
  plan: Plan | null;
  error: Failure | null;
  onCompare?: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ops = plan?.ops ?? [];
  const notValidated = review !== "validated";
  const warnings = (plan?.warnings ?? []).filter((w) => !(notValidated && /validat/i.test(w)));
  const word = (REVIEW as Record<string, { label: string }>)[review]?.label ?? review;
  return (
    <Modal
      title="Push plan"
      subtitle={
        <>
          Push <span {...stylex.props(styles.mono)}>{testKey ?? "this test"}</span> to Jira
          {summary ? ` — ${summary}` : ""}
        </>
      }
      icon="push"
      footNote={
        <>
          Same as <span {...stylex.props(styles.mono)}>testimus xray push {testKey ?? testId}</span>
        </>
      }
      actions={
        <>
          <Button variant="quiet" label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            icon="push"
            label="Confirm push"
            disabled={!plan || !ops.length}
            onClick={onConfirm}
          />
        </>
      }
      onClose={onClose}
    >
      <div {...stylex.props(styles.body)}>
        {!plan && !error && (
          <div role="status" aria-busy="true" aria-label="Building the push plan">
            <Skeleton kind="row" />
            <Skeleton kind="row" />
            <Skeleton kind="row" />
          </div>
        )}
        {error && (
          <Banner tone="danger" title="Could not build the push plan">
            <p {...stylex.props(styles.text)}>{error.message}</p>
            {error.fix && (
              <p {...stylex.props(styles.text)}>
                <strong>What to do:</strong> {error.fix}
              </p>
            )}
          </Banner>
        )}
        {plan && (
          <>
            {notValidated && (
              <Banner tone="warning" title={`This test is ${word}, not Validated`}>
                It will reach Jira with its review state as a label. Validate it first if it should go out as reviewed.
              </Banner>
            )}
            {plan.remoteChanged && (
              <Banner
                tone="warning"
                icon="cloud"
                title="Changed in Jira since your pull"
                actions={onCompare && <Button size="sm" label="Compare with Jira" onClick={onCompare} />}
              >
                Someone changed this test in Jira after your pull — pushing replaces their change. Compare first if in
                doubt.
              </Banner>
            )}
            {warnings.map((w) => (
              <Banner key={w} tone="warning" compact>
                {w}
              </Banner>
            ))}
            <span {...stylex.props(styles.what)}>What will happen · {plural(ops.length, "operation")}</span>
            {ops.length ? (
              <OpsTable ops={ops} />
            ) : (
              <EmptyState icon="check-circle" title="Nothing to push: Jira already has this version." compact />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
