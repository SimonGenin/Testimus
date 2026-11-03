import type { CheckFile, Source, SyncState, Test, XrayJson } from "../../../core/types.ts";
import { RevertConflict } from "../../components/claude/RevertConflict.tsx";
import {
  Badge,
  Button,
  FindingCard,
  GeneratedBadge,
  Icon,
  ReviewBadge,
  Severity,
  SyncBadge,
} from "../../components/ui/index.ts";
import { plural } from "../../lib/format.ts";
import { FindingSources, ReviewStep } from "./ReviewStep.tsx";

export type Marks = { runId: string; steps: Set<number>; added: Set<number> };

export function ReviewTest({
  test,
  sync,
  edited,
  check,
  stale,
  xray,
  folded,
  activeStep,
  selected,
  marks,
  claudeRunning,
  url,
  onFold,
  onFoldAll,
  onSelect,
  onOpenImage,
  onEdit,
  onRevert,
  revertConflict,
  fixMessage,
  onRevertAnyway,
  onKeepAfterRun,
  onCompare,
  onTakeJira,
  onKeepMine,
}: {
  test: Test;
  sync: SyncState;
  edited?: boolean;
  check: CheckFile | null;
  stale: boolean;
  xray: XrayJson;
  folded: Set<number>;
  activeStep: number;
  selected: string;
  marks: Marks | null;
  claudeRunning: boolean;
  url: (file: string) => string;
  onFold: (i: number, folded: boolean) => void;
  onFoldAll: (folded: boolean) => void;
  onSelect: (s: Source, step: number | null) => void;
  onOpenImage: (file: string) => void;
  onEdit: () => void;
  onRevert: () => void;
  revertConflict?: string | null;
  fixMessage?: string;
  onRevertAnyway?: () => void;
  onKeepAfterRun?: () => void;
  onCompare: () => void;
  onTakeJira: () => void;
  onKeepMine: () => void;
}) {
  const findings = check?.findings ?? [];
  const whole = findings.filter((f) => !f.step || f.step > test.steps.length);
  const allFolded = test.steps.every((_, i) => folded.has(i));
  return (
    <div className="rtest">
      <div className="rtest-head">
        <div className="rtest-meta">
          <span className="mono rtest-key">{test.key ?? "Not in Jira yet"}</span>
          <span className="muted rtest-folder">
            <Icon name="folder" />
            {test.folder || "/"}
          </span>
          {test.generatedBy && <GeneratedBadge edited={edited} />}
          <ReviewBadge review={test.review} />
          <SyncBadge sync={sync} />
          <span className="spacer" />
          <Button size="sm" tone="quiet" onClick={() => onFoldAll(!allFolded)}>
            {allFolded ? "Unfold all" : "Fold all"}
          </Button>
          <Button size="sm" icon="edit" aria-pressed={false} onClick={onEdit}>
            Edit
          </Button>
        </div>
        <h2 className="h rtest-title">{test.summary || "Untitled test"}</h2>
        <div className="rtest-sub">
          <span className="muted">{plural(test.steps.length, "step")}</span>
          {!check && <Badge tone="neutral">Not checked yet</Badge>}
        </div>
      </div>

      {sync === "remote-changed" && (
        <div className="rstatus rstatus-warn" role="status">
          <Severity tone="warning">Changed in Jira since your pull</Severity>
          <p>Someone changed this test in Jira after your last pull. Choose which version to keep before you push.</p>
          <div className="rstatus-actions">
            <Button size="sm" onClick={onCompare}>
              Compare
            </Button>
            <Button size="sm" onClick={onTakeJira}>
              Take Jira's version
            </Button>
            <Button size="sm" tone="quiet" onClick={onKeepMine}>
              Keep mine
            </Button>
          </div>
          <p className="muted">
            Push is refused until you choose — or until you push anyway and replace their change on purpose.
          </p>
        </div>
      )}

      {claudeRunning && (
        <div className="rstatus" role="status" aria-live="polite">
          <span className="sev s-info">
            <span className="dot run-dot" />
            Claude is fixing this test — follow it in the Claude panel.
          </span>
        </div>
      )}

      {marks && !claudeRunning && (
        <div className="rstatus rstatus-claude" role="status">
          <Icon name="claude" />
          <span>
            <strong>Claude changed {plural(marks.steps.size, "step")}</strong>
            {test.review === "checked" ? " · re-checked" : " · waiting for the check"}
          </span>
          <span className="spacer" />
          <Button size="sm" icon="revert" onClick={onRevert}>
            Revert
          </Button>
        </div>
      )}

      {marks && revertConflict && (
        <RevertConflict detail={revertConflict} onForce={() => onRevertAnyway?.()} onKeep={() => onKeepAfterRun?.()} />
      )}

      {fixMessage && !claudeRunning && (
        <div className="rstatus rstatus-warn" role="status" aria-label="Claude's fix">
          <Severity tone="warning">Still To fix after Claude's fix</Severity>
          <p>{fixMessage}</p>
        </div>
      )}

      {test.review === "to-fix" && test.reviewNote && (
        <div className="rstatus rstatus-note" role="note" aria-label="To fix note">
          <span className="label">To fix{test.reviewedBy ? ` · ${test.reviewedBy}` : ""}</span>
          <p>{test.reviewNote}</p>
        </div>
      )}

      {whole.map((f, i) => (
        <FindingCard key={i} finding={f} stale={stale} scope="Whole test">
          <FindingSources finding={f} selected={selected} onSelect={(s) => onSelect(s, null)} />
        </FindingCard>
      ))}

      {test.steps.map((s, i) => {
        const n = i + 1;
        return (
          <ReviewStep
            key={i}
            n={n}
            step={s}
            xray={xray}
            findings={findings.filter((f) => f.step === n)}
            stale={stale}
            folded={folded.has(i) && activeStep !== i}
            active={activeStep === i}
            claude={!!marks?.steps.has(n)}
            added={!!marks?.added.has(n)}
            selected={selected}
            url={url}
            onFold={(f) => onFold(i, f)}
            onSelect={onSelect}
            onOpenImage={onOpenImage}
          />
        );
      })}
      {!test.steps.length && <p className="muted">This test has no steps yet.</p>}
    </div>
  );
}
