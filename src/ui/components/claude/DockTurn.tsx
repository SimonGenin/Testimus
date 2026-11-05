import * as stylex from "@stylexjs/stylex";
import type { Source } from "../../../core/types.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { Answer } from "../ui/Answer.tsx";
import { Ask } from "../ui/Ask.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Raw } from "../ui/Raw.tsx";
import { SourceChip } from "../ui/SourceChip.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { type } from "../ui/type.ts";
import { AnswerText } from "./AnswerText.tsx";
import { DiagnosisText } from "./DiagnosisText.tsx";
import { RevertConflict } from "./RevertConflict.tsx";
import { type Again, changed, metaLine, type RunCard, runBadges, type Turn } from "./turns.ts";

const styles = stylex.create({
  tools: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    color: color.textMuted,
  },
  tool: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, overflowWrap: "anywhere" },
  toolMark: { display: "inline-flex", flex: "none", width: size.iconSm, color: color.success },
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
};

export function UserTurn({ turn }: { turn: Turn }) {
  return (
    <Ask meta={turn.label || undefined} empty="No request — Claude works from the scope and the house rules">
      {turn.text}
    </Ask>
  );
}

// ponytail: Claude's side of a turn — what it read as it goes, the answer with its sources, and the run's card:
// what changed, the numbers, Show changes, Revert, the raw output; a failure says what happened and offers Retry
export function AnswerTurn({ turn: t, actions: a }: { turn: Turn; actions: TurnActions }) {
  const pending = t.tools.some((x) => !x.done);
  const failed = !t.running && !!(t.again || t.trouble);
  const words = t.text || (t.running && !pending);
  return (
    <>
      {t.tools.length > 0 && (
        <ul aria-label="What Claude read" {...stylex.props(type.small, styles.tools)}>
          {t.tools.map((x, i) => (
            <li key={i} {...stylex.props(styles.tool)}>
              <span {...stylex.props(styles.toolMark)}>
                {x.done ? <Icon name="check" size="sm" /> : <Spinner size="sm" />}
              </span>
              <span>
                {x.label}
                {!x.done && "…"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(words || t.trouble || t.run || t.note || t.sources?.length || !t.running) && (
        <Answer
          title={t.trouble ? "The run failed" : "Claude"}
          error={!!t.trouble}
          meta={t.meta && !t.running ? metaLine(t.meta) : undefined}
          footer={
            !t.running && (t.run || failed || t.raw !== undefined) ? (
              <>
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
          {words && <AnswerText text={t.text} running={t.running} listed={t.sources} onOpenSource={a.onOpenSource} />}
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
                  figure={s.anchor.startsWith("fig:")}
                  onOpen={() => a.onOpenSource(s)}
                />
              ))}
            </div>
          )}
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
