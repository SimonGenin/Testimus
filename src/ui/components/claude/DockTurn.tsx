import * as stylex from "@stylexjs/stylex";
import type { Source } from "../../../core/types.ts";
import { sourceLabel } from "../../lib/fields.ts";
import {
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { SourceChip } from "../ui/SourceChip.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { AnswerText } from "./AnswerText.tsx";
import { type Again, metaLine, type RunCard, runTitle, type Turn } from "./turns.ts";

const styles = stylex.create({
  ask: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space.s1 },
  label: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textSubtle,
  },
  bubble: {
    maxWidth: "88%",
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  empty: { color: color.textSubtle },
  tools: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  tool: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, overflowWrap: "anywhere" },
  toolMark: { display: "inline-flex", flex: "none", width: size.iconSm, color: color.success },
  answer: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s4,
    borderRadius: radius.r3,
    backgroundColor: color.claudeSubtle,
  },
  answerError: { backgroundColor: color.dangerSubtle },
  head: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.semibold,
    color: color.claudeText,
  },
  headError: { color: color.danger },
  trouble: { display: "flex", flexDirection: "column", gap: space.s1 },
  troubleTitle: { fontWeight: fontWeight.semibold, color: color.text },
  troubleText: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.text },
  sources: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2 },
  badges: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  meta: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
    fontVariantNumeric: "tabular-nums",
  },
  foot: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  raw: {
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: size.dockStripLabel,
    overflowY: "auto",
  },
});

export type TurnActions = {
  busy: boolean;
  onOpenSource: (s: Source) => void;
  onShowChanges: (run: RunCard) => void;
  onRevert: (t: Turn) => void;
  onToggleRaw: (t: Turn) => void;
  onRetry: (a: Again) => void;
  onSettings: () => void;
};

export function UserTurn({ turn }: { turn: Turn }) {
  return (
    <section aria-label={`Request${turn.label ? ` · ${turn.label}` : ""}`} {...stylex.props(styles.ask)}>
      {turn.label && <span {...stylex.props(styles.label)}>{turn.label}</span>}
      <div {...stylex.props(styles.bubble)}>
        {turn.text || (
          <span {...stylex.props(styles.empty)}>No request — Claude works from the scope and the house rules</span>
        )}
      </div>
    </section>
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
        <ul aria-label="What Claude read" {...stylex.props(styles.tools)}>
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
        <div {...stylex.props(styles.answer, t.trouble && styles.answerError)}>
          <span {...stylex.props(styles.head, t.trouble && styles.headError)}>
            <Icon name={t.trouble ? "alert-circle" : "claude"} size="sm" />
            {t.trouble ? "The run failed" : "Claude"}
          </span>
          {words && <AnswerText text={t.text} running={t.running} onOpenSource={a.onOpenSource} />}
          {t.trouble && (
            <div role="status" {...stylex.props(styles.trouble)}>
              <strong {...stylex.props(styles.troubleTitle)}>{t.trouble.title}</strong>
              {t.trouble.detail && <p {...stylex.props(styles.troubleText)}>{t.trouble.detail}</p>}
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
              <strong {...stylex.props(styles.troubleTitle)}>Still To fix</strong>
              <p {...stylex.props(styles.troubleText)}>{t.note}</p>
            </div>
          )}
          {t.run && (
            <div {...stylex.props(styles.badges)}>
              <Badge tone={t.run.reverted ? "neutral" : "claude"} icon="claude" label={runTitle(t.run, !!t.action)} />
            </div>
          )}
          {t.meta && !t.running && <span {...stylex.props(styles.meta)}>{metaLine(t.meta)}</span>}
          {!t.running && (t.run || failed || t.raw !== undefined) && (
            <div {...stylex.props(styles.foot)}>
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
                  <Button size="sm" icon="eye" label="Show changes" onClick={() => t.run && a.onShowChanges(t.run)} />
                  <Button size="sm" icon="undo" label="Revert" onClick={() => a.onRevert(t)} />
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
            </div>
          )}
          {t.showRaw && t.raw !== undefined && <pre {...stylex.props(styles.raw)}>{t.raw || "(no output)"}</pre>}
        </div>
      )}
    </>
  );
}
