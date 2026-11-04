import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge, DIFF } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Chip } from "../../../components/ui/Chip.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Tooltip } from "../../../components/ui/Tooltip.tsx";
import type { StepMark } from "../../../lib/diff.ts";
import { border, color, fontSize, fontWeight, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { stepMarker } from "../markers.stylex.ts";

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
    fontSize: fontSize.compact,
    fontWeight: fontWeight.semibold,
    fontVariantNumeric: "tabular-nums",
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
    fontSize: fontSize.compact,
  },
  empty: { color: color.textSubtle },
  grow: { flex: 1 },
  folds: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
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

export type StepMarks = { claude?: boolean; added?: boolean; mark?: StepMark; unreadable?: boolean };

export type Fold = { name: string; open: boolean; filled: boolean; toggle: () => void };

export function StepNumber({ n, marks }: { n: number; marks: StepMarks }) {
  return (
    <span
      data-testid="step-number"
      {...stylex.props(
        styles.num,
        marks.mark === "modified" && styles.numModified,
        marks.mark === "new" && styles.numNew,
        marks.claude && styles.numClaude,
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

// the head of an open step card: grip, number, marks, the Jira version toggle, the column folds and the tools
export function StepHead({
  n,
  index,
  count,
  marks,
  grip,
  jira,
  folds,
  readOnly,
  onAsk,
  onMove,
  onInsert,
  onDelete,
  onFold,
}: {
  n: number;
  index: number;
  count: number;
  marks: StepMarks;
  grip: ReactNode;
  jira?: { open: boolean; toggle: () => void };
  folds: Fold[];
  readOnly?: boolean;
  onAsk?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onInsert?: () => void;
  onDelete?: () => void;
  onFold?: (folded: boolean) => void;
}) {
  return (
    <>
      {grip}
      <StepNumber n={n} marks={marks} />
      <MarkBadges marks={marks} />
      {jira && (
        <Button
          variant="quiet"
          size="sm"
          icon="history"
          label={jira.open ? "Hide Jira version" : "Jira version"}
          pressed={jira.open}
          onClick={jira.toggle}
        />
      )}
      <span {...stylex.props(styles.grow)} />
      <span {...stylex.props(styles.folds)}>
        {folds.map((f) => (
          <Tooltip
            key={f.name}
            label={!f.open && f.filled ? `This step has ${f.name}` : f.open ? `Fold ${f.name}` : `Show ${f.name}`}
          >
            <Chip label={f.name} pressed={f.open} dot={!f.open && f.filled} onToggle={f.toggle} />
          </Tooltip>
        ))}
      </span>
      <span {...stylex.props(styles.tools)}>
        {!readOnly && (
          <>
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
    <span data-testid="step-line" {...stylex.props(styles.line, !text && styles.empty)}>
      {text || "Empty step"}
    </span>
  );
}
