import { testOf } from "../../../app/useClaudeLock.ts";
import { RevertConflict } from "../../../components/claude/RevertConflict.tsx";
import { claudeOn } from "../../../components/claude/turns.ts";
import { useRunningJobs } from "../../../components/shell/Activity.tsx";
import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { useCommand } from "../../../lib/data/query.ts";
import { plural } from "../../../lib/format.ts";
import { errorToast } from "../../../lib/toast.ts";

// the jobs in which Claude edits tests (useClaudeLock): the one the banner can stop
const EDITS = new Set(["claude", "fix"]);

// « Cancel the run » of the Claude run that edits tests, while one runs — the one on `testId` when given (a run on it, or
// on the whole project)
export function useCancelClaudeRun(testId?: string) {
  const job = useRunningJobs().find((j) => EDITS.has(j.kind) && (!testId || claudeOn(testOf(j), testId)));
  const cancel = useCommand("jobs.cancel", { invalidates: "none" });
  if (!job) return undefined;
  return (
    <Button
      size="sm"
      icon="stop"
      label="Cancel the run"
      loading={cancel.isPending}
      onClick={() => cancel.mutate({ id: job.id }, { onError: (e) => errorToast(e, "Could not cancel the run") })}
    />
  );
}

function ClaudeWorking({ here }: { here: boolean }) {
  const cancel = useCancelClaudeRun();
  return (
    <Banner
      tone="claude"
      icon="lock"
      title={here ? "Claude is working on this test" : "Claude is working"}
      actions={cancel}
    >
      Editing is paused until it finishes. Every change can be reverted.
    </Banner>
  );
}

export type ClaudeMarked = { i: number; added: boolean }[];

// the notices that sit above the steps while they are true: Claude at work, what Claude changed, the file changed on disk
export function EditorBanners({
  busy,
  busyHere,
  marked,
  conflict,
  revertConflict,
  onShowChanges,
  onRevert,
  onForceRevert,
  onKeepRevert,
  onReloadDisk,
  onKeepMine,
}: {
  busy: boolean;
  busyHere: boolean;
  /** the steps the last Claude run changed, or null when there is no run to show */
  marked: ClaudeMarked | null;
  conflict: boolean;
  revertConflict: string | null;
  onShowChanges: () => void;
  onRevert: () => void;
  onForceRevert: () => void;
  onKeepRevert: () => void;
  onReloadDisk: () => void;
  onKeepMine: () => void;
}) {
  return (
    <>
      {conflict && (
        <Banner
          tone="warning"
          icon="conflict"
          title="test.md changed on disk"
          actions={
            <>
              <Button size="sm" label="Reload from disk" onClick={onReloadDisk} />
              <Button size="sm" variant="quiet" label="Keep mine" onClick={onKeepMine} />
            </>
          }
        >
          Another program wrote this test while you were editing it.
        </Banner>
      )}
      {busy && <ClaudeWorking here={busyHere} />}
      {marked && (
        <Banner
          tone="claude"
          icon="claude"
          title={marked.length ? `Claude changed ${plural(marked.length, "step")}` : "Claude changed this test."}
          actions={
            <>
              {marked.length > 0 && <Button size="sm" label="Show changes" onClick={onShowChanges} />}
              <Button size="sm" icon="undo" label="Revert" onClick={onRevert} />
            </>
          }
        >
          {marked.length > 0 && `${marked.map((x) => `step ${x.i + 1}${x.added ? " (new)" : ""}`).join(", ")}. `}
          The test goes back through the check before review.
        </Banner>
      )}
      {marked && revertConflict && (
        <RevertConflict detail={revertConflict} onForce={onForceRevert} onKeep={onKeepRevert} />
      )}
    </>
  );
}
