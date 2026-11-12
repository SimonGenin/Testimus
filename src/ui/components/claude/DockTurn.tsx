import * as stylex from "@stylexjs/stylex";
import type { Proposal, Source } from "../../../core/types.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { nameTests, useTestNames } from "../../lib/labels.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { videoPreview } from "../sources/VideoPreview.tsx";
import { Answer } from "../ui/Answer.tsx";
import { Ask } from "../ui/Ask.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Raw } from "../ui/Raw.tsx";
import { SourceChip } from "../ui/SourceChip.tsx";
import { type } from "../ui/type.ts";
import { AnswerText } from "./AnswerText.tsx";
import { DiagnosisText } from "./DiagnosisText.tsx";
import { DockActivity } from "./DockActivity.tsx";
import { ProposalCard } from "./ProposalCard.tsx";
import { RevertConflict } from "./RevertConflict.tsx";
import { type Again, changed, metaLine, pasteOf, type RunCard, runBadges, type Turn } from "./turns.ts";

const styles = stylex.create({
  trouble: { display: "flex", flexDirection: "column", gap: space.s1 },
  troubleTitle: { color: color.text },
  troubleText: { margin: 0, color: color.text },
  sources: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  badges: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});

export type TurnActions = {
  busy: boolean;
  onOpenSource: (s: Source) => void;
  onShowChanges: (run: RunCard) => void;
  onRevert: (t: Turn) => void;
  /** Revert refused: the test changed after this turn's run — said in its card, as the editor and Review say it */
  conflict?: { id: number; detail: string } | null;
  onForceRevert: (t: Turn) => void;
  onKeepRevert: () => void;
  onToggleRaw: (t: Turn) => void;
  onRetry: (a: Again) => void;
  onSettings: () => void;
  /** the pasted block of an answer about a step of a test run becomes that step's note (a NOK) */
  onUseNote?: (t: Turn, note: string) => void;
  /** the proposal whose Apply, Ignore or Revert is at work */
  settling?: string | null;
  onProposal?: (p: Proposal, how: "apply" | "ignore" | "revert") => void;
};

export function UserTurn({ turn }: { turn: Turn }) {
  return (
    <Ask meta={turn.label || undefined} empty="No request — Claude works from the scope and the house rules">
      {turn.text}
    </Ask>
  );
}

// ponytail: Claude's side of a turn — what it does as it goes (DockActivity), the answer with its sources, and the run's card:
// what changed, the numbers, Show changes, Revert, the raw output; a failure says what happened and offers Retry
export function AnswerTurn({ turn: t, actions: a }: { turn: Turn; actions: TurnActions }) {
  const observed = useObserved();
  const failed = !t.running && !!(t.again || t.trouble);
  const words = t.text || (t.running && !t.tools.some((x) => !x.done));
  const names = useTestNames();
  const paste = t.pasteTo && !t.running ? pasteOf(t.text) : "";
  return (
    <>
      <DockActivity turn={t} />
      {(words || t.trouble || t.run || t.note || t.sources?.length || !t.running) && (
        <Answer
          title={t.trouble ? "The run failed" : "Claude"}
          error={!!t.trouble}
          meta={t.meta && !t.running ? metaLine(t.meta) : undefined}
          footer={
            !t.running && (t.run || failed || t.raw !== undefined || paste) ? (
              <>
                {paste && t.pasteTo && a.onUseNote && (
                  <Button
                    size="sm"
                    variant="claude"
                    icon="check"
                    label={`Use as the note of step ${t.pasteTo.step}`}
                    disabled={a.busy ? "Claude is working — wait for it to finish" : false}
                    onClick={() => a.onUseNote?.(t, paste)}
                  />
                )}
                {t.again && (
                  <Button
                    size="sm"
                    icon="refresh"
                    label="Retry"
                    disabled={a.busy}
                    onClick={() => t.again && a.onRetry(t.again)}
                  />
                )}
                {t.run && !t.run.reverted && (
                  <>
                    <Button
                      size="sm"
                      icon="eye"
                      label="Show changes"
                      disabled={changed(t.run) ? false : "Nothing changed"}
                      onClick={() => t.run && a.onShowChanges(t.run)}
                    />
                    <Button
                      size="sm"
                      icon="undo"
                      label="Revert"
                      disabled={a.busy ? "Claude is working — wait for it to finish" : false}
                      onClick={() => a.onRevert(t)}
                    />
                  </>
                )}
                {t.raw !== undefined && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="terminal"
                    label={t.showRaw ? "Hide raw output" : "Show raw output"}
                    onClick={() => a.onToggleRaw(t)}
                  />
                )}
                {failed && (
                  <Button size="sm" variant="quiet" icon="settings" label="Open Settings" onClick={a.onSettings} />
                )}
              </>
            ) : undefined
          }
        >
          {words && (
            <AnswerText
              text={nameTests(t.text, names)}
              running={t.running}
              listed={t.sources}
              onOpenSource={a.onOpenSource}
            />
          )}
          {t.trouble && (
            <div role="status" {...stylex.props(styles.trouble)}>
              <strong {...stylex.props(type.strong, styles.troubleTitle)}>{t.trouble.title}</strong>
              {t.trouble.detail && (
                <p {...stylex.props(styles.troubleText)}>
                  <DiagnosisText text={t.trouble.detail} />
                </p>
              )}
            </div>
          )}
          {!!t.sources?.length && (
            <div {...stylex.props(styles.sources)}>
              {t.sources.map((s, i) => (
                <SourceChip
                  key={i}
                  reference={sourceLabel(s)}
                  quote={s.quote}
                  figure={isPictureAnchor(s.anchor)}
                  observed={observed(s.docId)}
                  preview={videoPreview(s)}
                  onOpen={() => a.onOpenSource(s)}
                />
              ))}
            </div>
          )}
          {t.proposals?.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              busy={a.settling ? (a.settling === p.id ? "Working on it" : "Another change is being applied") : false}
              onApply={() => a.onProposal?.(p, "apply")}
              onIgnore={() => a.onProposal?.(p, "ignore")}
              onRevert={() => a.onProposal?.(p, "revert")}
            />
          ))}
          {t.note && (
            <div role="status" {...stylex.props(styles.trouble)}>
              <strong {...stylex.props(type.strong, styles.troubleTitle)}>Re-check incomplete</strong>
              <p {...stylex.props(styles.troubleText)}>{t.note}</p>
            </div>
          )}
          {t.run && (
            <div {...stylex.props(styles.badges)}>
              {runBadges(t.run, !!t.action).map((b) => (
                <Badge key={b.label} tone={b.tone} icon={b.icon} label={b.label} />
              ))}
            </div>
          )}
          {t.showRaw && t.raw !== undefined && <Raw text={t.raw} maxLines={20} label="Raw output" />}
          {t.run && !t.run.reverted && a.conflict?.id === t.id && (
            <RevertConflict detail={a.conflict.detail} onForce={() => a.onForceRevert(t)} onKeep={a.onKeepRevert} />
          )}
        </Answer>
      )}
    </>
  );
}
