import * as stylex from "@stylexjs/stylex";
import type { SyncState, Test } from "../../../core/types.ts";
import { RevertConflict } from "../../components/claude/RevertConflict.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { plural } from "../../lib/format.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { useCancelClaudeRun } from "../tests/editor/EditorBanners.tsx";
import { JiraChanged } from "../tests/editor/JiraChanged.tsx";

export type Marks = { runId: string; steps: Set<number>; added: Set<number> };

export const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s3 },
});

export type BannersProps = {
  test: Test;
  /** the test's folder id: « Cancel the run » stops the run on it */
  testId?: string;
  sync: SyncState;
  checked: boolean;
  stale: boolean;
  claudeRunning: boolean;
  claudeReady: boolean;
  marks: Marks | null;
  revertConflict?: string | null;
  fixMessage?: string;
  checking?: boolean;
  pulling?: boolean;
  onCheck?: () => void;
  onRevert: () => void;
  onRevertAnyway?: () => void;
  onKeepAfterRun?: () => void;
  onCompare: () => void;
  onTakeJira: () => void;
  onKeepMine: () => void;
  onAskFix?: () => void;
  onEditNote?: () => void;
  /** takes the To fix mark off: the test is a draft again */
  onToDraft?: () => void;
};

function ClaudeFixing({ testId }: { testId?: string }) {
  const cancel = useCancelClaudeRun(testId);
  return (
    <Banner tone="claude" icon="lock" title="Claude is fixing this test" actions={cancel}>
      Follow it in the Claude panel. It goes back through the check when Claude is done; Validate waits until then.
    </Banner>
  );
}

// ponytail: what is true of the test under review now, each in its own notice: Jira changed it, Claude works on it or
// changed it, the check has not run or is out of date, it is marked To fix
export function ReviewBanners(p: BannersProps) {
  const { test } = p;
  const claudeOff = !p.claudeReady && "Claude is not available on this PC right now — the note is kept for later";
  return (
    <div {...stylex.props(styles.stack)}>
      {p.sync === "remote-changed" && (
        <JiraChanged
          replacing={p.pulling}
          locked={p.claudeRunning && "Claude is working on this test — wait for it to finish"}
          onCompare={p.onCompare}
          onReplace={p.onTakeJira}
          onKeepMine={p.onKeepMine}
        />
      )}
      {p.claudeRunning && <ClaudeFixing testId={p.testId} />}
      {p.marks && !p.claudeRunning && (
        <Banner
          tone="claude"
          title={`Claude changed ${plural(p.marks.steps.size, "step")}`}
          actions={<Button size="sm" icon="undo" label="Revert" onClick={p.onRevert} />}
        >
          {test.review === "draft"
            ? "The test is back to Draft: review it again."
            : "The test goes back through the check; it stays To fix until you validate it."}
        </Banner>
      )}
      {p.marks && p.revertConflict && (
        <RevertConflict
          detail={p.revertConflict}
          onForce={() => p.onRevertAnyway?.()}
          onKeep={() => p.onKeepAfterRun?.()}
        />
      )}
      {p.fixMessage && !p.claudeRunning && (
        <div role="status" aria-label="Claude's fix">
          <Banner tone="warning" title="Re-check incomplete after Claude's fix">
            {p.fixMessage}
          </Banner>
        </div>
      )}
      {!p.claudeRunning && p.onCheck && (!p.checked || p.stale) && (
        <Banner
          tone={p.checked ? "neutral" : "info"}
          icon={p.checked ? "history" : "clock"}
          title={p.checked ? "Changed since its check" : "Not checked yet"}
          actions={
            <Button
              size="sm"
              icon="verify"
              label={p.checked ? "Check again" : "Check"}
              loading={p.checking}
              onClick={p.onCheck}
            />
          }
        >
          {p.checked
            ? "The findings below may be out of date: check the test again to confirm them."
            : "Check it before you review it: the check finds the claims the documents do not support."}
        </Banner>
      )}
      {test.review === "to-fix" && test.reviewNote && (
        <div role="note" aria-label="To fix note">
          <Banner
            tone="warning"
            icon="to-fix"
            title={["To fix", [test.reviewedBy, when(test.reviewedAt)].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" — ")}
            actions={
              <>
                {p.onAskFix && (
                  <Button
                    size="sm"
                    variant="claude-quiet"
                    icon="claude"
                    label="Ask Claude to fix it"
                    disabled={p.claudeRunning || claudeOff}
                    onClick={p.onAskFix}
                  />
                )}
                {p.onEditNote && <Button size="sm" variant="quiet" label="Edit the note" onClick={p.onEditNote} />}
                {p.onToDraft && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="undo"
                    label="Back to draft"
                    disabled={p.claudeRunning}
                    onClick={p.onToDraft}
                  />
                )}
              </>
            }
          >
            {test.reviewNote}
          </Banner>
        </div>
      )}
    </div>
  );
}
