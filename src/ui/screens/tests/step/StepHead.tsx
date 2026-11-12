import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge, DIFF } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { type } from "../../../components/ui/type.ts";
import type { StepMark } from "../../../lib/diff.ts";
import { border, color, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { stepMarker } from "../markers.stylex.ts";
import { WasToggle } from "./WasToggle.tsx";

const styles = stylex.create({
  grip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlXs,
    height: size.controlXs,
    color: color.textSubtle,
    cursor: "grab",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", stepMarker)]: 1,
      [stylex.when.ancestor(":focus-within", stepMarker)]: 1,
    },
  },
  shown: { opacity: 1 },
  slot: { flex: "none", display: "inline-flex", width: size.controlXs, height: size.controlXs },
  num: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: size.controlSm,
    height: size.controlSm,
    paddingInline: space.s2,
    boxSizing: "border-box",
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.text,
  },
  numModified: { backgroundColor: color.warningSubtle, color: color.warning },
  numNew: { backgroundColor: color.successSubtle, color: color.success },
  numClaude: { backgroundColor: color.claudeSubtle, color: color.claudeText },
  numBad: { backgroundColor: color.dangerSubtle, color: color.danger },
  marks: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  line: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: { color: color.textSubtle },
  grow: { flex: 1 },
  tools: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    paddingInlineStart: space.s2,
    marginInlineStart: space.s2,
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: border.width,
    borderInlineStartColor: color.border,
  },
});

// ponytail: ok / nok — a step played in a test run: its card and number take the tester's mark
export type StepMarks = {
  claude?: boolean;
  added?: boolean;
  mark?: StepMark;
  unreadable?: boolean;
  played?: "ok" | "nok";
};

export function StepNumber({ n, marks }: { n: number; marks: StepMarks }) {
  return (
    <span
      data-testid="step-number"
      {...stylex.props(
        type.compact,
        type.strong,
        type.tabular,
        styles.num,
        marks.mark === "modified" && styles.numModified,
        marks.mark === "new" && styles.numNew,
        marks.claude && styles.numClaude,
        marks.played === "ok" && styles.numNew,
        marks.played === "nok" && styles.numBad,
        marks.unreadable && styles.numBad,
      )}
    >
      {n}
    </span>
  );
}

export function MarkBadges({ marks, size: s }: { marks: StepMarks; size?: "sm" | "md" }) {
  return (
    <span {...stylex.props(styles.marks)}>
      {marks.claude && <Badge {...DIFF.claude} label={marks.added ? "Added by Claude" : DIFF.claude.label} size={s} />}
      {marks.mark === "modified" && <Badge {...DIFF.modified} size={s} />}
      {marks.mark === "new" && <Badge {...DIFF.new} size={s} />}
      {marks.unreadable && (
        <Badge
          label="Not fully read — never pushed"
          tone="danger"
          icon="alert-circle"
          size={s}
          tooltip="Xray markup this editor cannot read"
        />
      )}
    </span>
  );
}

export function Grip({ n, focused, onArm }: { n: number; focused?: boolean; onArm: (armed: boolean) => void }) {
  return (
    <span
      data-testid="step-grip"
      title={`Drag step ${n} to reorder`}
      {...stylex.props(styles.grip, focused && styles.shown)}
      onMouseDown={() => onArm(true)}
      onMouseUp={() => onArm(false)}
    >
      <Icon name="grip" />
    </span>
  );
}

// the grip's room on a read-only card, so the number stays where it is on an editable one
export function GripSlot() {
  return <span aria-hidden="true" {...stylex.props(styles.slot)} />;
}

// the rest of an open step card's head, after its grip, number and marks (StepFrame): the Jira version and Before Claude
// toggles and the tools — which columns a step shows is the Columns menu's, not the card's
export function StepHead({
  n,
  index,
  count,
  jira,
  claudeWas,
  readOnly,
  tool,
  onAsk,
  onMove,
  onInsert,
  onDelete,
  onFold,
}: {
  n: number;
  index: number;
  count: number;
  jira?: { open: boolean; toggle: () => void };
  /** the step as it was before the Claude run that changed it */
  claudeWas?: { open: boolean; toggle: () => void };
  readOnly?: boolean;
  /** a tool of the step before Ask Claude: Find a picture */
  tool?: ReactNode;
  onAsk?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onInsert?: () => void;
  onDelete?: () => void;
  onFold?: (folded: boolean) => void;
}) {
  return (
    <>
      {jira && <WasToggle from="jira" open={jira.open} onToggle={jira.toggle} />}
      {claudeWas && <WasToggle from="claude" open={claudeWas.open} onToggle={claudeWas.toggle} />}
      <span {...stylex.props(styles.grow)} />
      <span {...stylex.props(styles.tools)}>
        {!readOnly && (
          <>
            {tool}
            {onAsk && (
              <Button
                variant="claude-quiet"
                size="sm"
                icon="claude"
                label="Ask Claude"
                onClick={onAsk}
                data-testid="step-ask"
              />
            )}
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="arrow-up"
              label={`Move step ${n} up`}
              shortcut="Alt+↑"
              disabled={index === 0}
              onClick={() => onMove?.(-1)}
            />
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="arrow-down"
              label={`Move step ${n} down`}
              shortcut="Alt+↓"
              disabled={index === count - 1}
              onClick={() => onMove?.(1)}
            />
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="plus"
              label={`Insert a step below step ${n}`}
              shortcut="Ctrl+Enter"
              onClick={onInsert}
            />
            <Button variant="quiet" size="sm" iconOnly icon="trash" label={`Delete step ${n}`} onClick={onDelete} />
          </>
        )}
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon="chevron-up"
          label={`Fold step ${n}`}
          onClick={() => onFold?.(true)}
        />
      </span>
    </>
  );
}

// the line a folded step keeps: its number, its marks and the first line of its first column
export function FoldedLine({ text }: { text: string }) {
  return (
    <span data-testid="step-line" {...stylex.props(type.body, styles.line, !text && styles.empty)}>
      {text || "Empty step"}
    </span>
  );
}
