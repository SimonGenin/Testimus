import * as stylex from "@stylexjs/stylex";
import type { DragEvent, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { Card } from "../../../components/ui/Card.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, breakpoint, color, size, space } from "../../../styles/tokens.stylex.ts";
import { stepMarker } from "../markers.stylex.ts";
import { FoldedLine, MarkBadges, type StepMarks, StepNumber } from "./StepHead.tsx";

const styles = stylex.create({
  frame: { containerType: "inline-size", minWidth: 0 },
  dragging: { opacity: 0.5 },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
    minHeight: `calc(${size.controlMd} + ${space.s5})`,
    paddingTop: space.s3,
    paddingBottom: space.s2,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s4,
  },
  folded: { paddingBottom: space.s3 },
  gone: { paddingInlineStart: space.s4 },
  sources: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: { default: "row", [breakpoint.narrow]: "column" },
    alignItems: "flex-start",
    gap: { default: space.s4, [breakpoint.narrow]: space.s2 },
    marginInlineStart: space.s4,
    marginInlineEnd: space.s5,
    paddingTop: space.s3,
    paddingBottom: space.s4,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  label: {
    flex: "none",
    width: { default: size.stepLabel, [breakpoint.narrow]: "auto" },
    paddingTop: space.s1,
    color: color.textMuted,
  },
  chips: { flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: space.s2 },
});

// ponytail: Card padded={false} keeps its body's padding (its `flush` shorthand loses to the body's longhands) — the one
// child of a flush card takes it back; BESOIN in .build/v3/agents/ds-tests.md: drop this once the kit's flush works
export const cardFlush = stylex.create({
  child: { display: "flex", flexDirection: "column", minWidth: 0, margin: `calc(-1 * ${space.s6})` },
});

export const edgeOf = (m: StepMarks) =>
  m.unreadable
    ? "danger"
    : m.claude
      ? "claude"
      : m.mark === "new"
        ? "success"
        : m.mark === "modified"
          ? "warning"
          : undefined;

export type StepFrameProps = {
  n: number;
  marks: StepMarks;
  /** before the number: the drag handle */
  grip?: ReactNode;
  /** a folded card: the first line of its first column, after the marks, and nothing under the head */
  line?: string;
  /** the rest of the head, after the number and the marks */
  head?: ReactNode;
  children?: ReactNode;
  focused?: boolean;
  dragging?: boolean;
  /** Review: the step the arrows are on */
  current?: boolean;
  draggable?: boolean;
  onFocusCapture?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
};

// ponytail: the step card of Tests and Review (SYSTEM.md « the step card, its own wrapper over Card »,
// _editor.mjs .step): a Card whose edge says the step's diff state, its head (grip, number, marks, then the rest), its
// body; the article carries the step's name and its states for tests and the marker that shows the grip on hover
export function StepFrame({
  n,
  marks,
  grip,
  line,
  head,
  children,
  focused = false,
  dragging = false,
  current,
  ...events
}: StepFrameProps) {
  const folded = line !== undefined;
  return (
    <article
      aria-label={`Step ${n}`}
      aria-current={current ? "step" : undefined}
      data-folded={folded || undefined}
      data-mark={marks.mark && marks.mark !== "same" ? marks.mark : undefined}
      data-claude={marks.claude || undefined}
      data-unreadable={marks.unreadable || undefined}
      data-dragging={dragging || undefined}
      data-focused={focused || undefined}
      {...events}
      {...stylex.props(stepMarker, styles.frame, dragging && styles.dragging)}
    >
      <Card edge={edgeOf(marks)} focused={focused} padded={false}>
        <div {...stylex.props(cardFlush.child)}>
          <div {...stylex.props(styles.head, folded && styles.folded)}>
            {grip}
            <StepNumber n={n} marks={marks} />
            <MarkBadges marks={marks} size={folded ? "sm" : undefined} />
            {folded && <FoldedLine text={line} />}
            {head}
          </div>
          {!folded && children}
        </div>
      </Card>
    </article>
  );
}

// the placeholder of a step Jira has and the test no longer does: a dashed card, no number
export function GoneFrame({ head, children }: { head: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label="Deleted step" {...stylex.props(styles.frame)}>
      <Card dashed edge="danger" padded={false}>
        <div {...stylex.props(cardFlush.child)}>
          <div {...stylex.props(styles.head, styles.gone)}>{head}</div>
          {children}
        </div>
      </Card>
    </section>
  );
}

// the foot of a step card: the sources of the step that no column holds, under a hairline
export function StepSourcesRow({ children }: { children: ReactNode }) {
  return (
    <div data-testid="step-sources" {...stylex.props(styles.sources)}>
      <span {...stylex.props(type.small, type.medium, styles.label)}>Sources</span>
      <span {...stylex.props(styles.chips)}>{children}</span>
    </div>
  );
}
