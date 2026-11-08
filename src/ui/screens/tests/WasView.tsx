import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ColumnLayout, Step, StepImage } from "../../../core/types.ts";
import { Badge, DIFF } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { columnsOf } from "../../lib/columns.ts";
import { border, color, radius, space } from "../../styles/tokens.stylex.ts";
import type { StepLayout } from "./StepCard.tsx";
import { GoneFrame } from "./step/StepFrame.tsx";
import { StepRead } from "./step/StepRead.tsx";
import { firstLine } from "./step/stepText.ts";
import { WAS, type WasFrom, WasToggle } from "./step/WasToggle.tsx";

const styles = stylex.create({
  was: {
    boxSizing: "border-box",
    marginInline: space.s4,
    marginBottom: space.s3,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.warningBorder,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  wasClaude: { borderColor: color.claudeBorder },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s2,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  title: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: color.warning,
  },
  titleClaude: { color: color.claudeText },
  grow: { flex: 1 },
  body: { boxSizing: "border-box", paddingBlock: space.s2, paddingInline: space.s4 },
  ghost: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: color.textMuted,
  },
});

// The snapshot of a step, drawn by the very same field blocks as the live card (same layout, same
// screenshots) — only read-only: no insert strips, no grip, no ✕, and its images still open in the lightbox
export function WasView({
  from = "jira",
  step,
  xray,
  layout,
  index,
  url,
  restoreLabel,
  onOpenImage,
  onRestore,
}: {
  from?: WasFrom;
  step: Step;
  xray: ColumnLayout;
  layout: StepLayout;
  index: number;
  url: (file: string) => string;
  restoreLabel: string;
  onOpenImage: (file: string, images: StepImage[]) => void;
  onRestore?: () => void;
}) {
  const n = index + 1;
  const split = layout === "split";
  return (
    <section
      aria-label={`Step ${n} ${WAS[from].aria}`}
      {...stylex.props(styles.was, from === "claude" && styles.wasClaude)}
    >
      <div {...stylex.props(type.small, styles.head)}>
        <span {...stylex.props(type.medium, styles.title, from === "claude" && styles.titleClaude)}>
          <Icon name="history" size="sm" />
          {WAS[from].title}
        </span>
        <span {...stylex.props(styles.grow)} />
        {onRestore && <Button size="sm" icon="undo" label={restoreLabel} onClick={onRestore} />}
      </div>
      <div {...stylex.props(styles.body)}>
        <StepRead
          idBase={`${from === "claude" ? "before" : "was"}${index}`}
          step={step}
          xray={xray}
          split={split}
          n={n}
          url={url}
          onOpenImage={onOpenImage}
        />
      </div>
    </section>
  );
}

// A step Jira still has (or the test had before Claude's run) and the local test no longer does: an unnumbered
// placeholder, kept only so the deletion is visible and its earlier version still readable, and inert everywhere else
export function GoneStep({
  from = "jira",
  step,
  xray,
  layout,
  url,
  onOpenImage,
  onRestore,
}: {
  from?: WasFrom;
  step: Step;
  xray: ColumnLayout;
  layout: StepLayout;
  url: (file: string) => string;
  onOpenImage: (file: string, images: StepImage[]) => void;
  onRestore?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // ponytail: the folded line of a step is its first column, whatever that column is called (as StepCard's)
  const first = columnsOf(xray, step)[0]?.name;
  return (
    <GoneFrame
      head={
        <>
          <Badge {...DIFF.deleted} />
          <span data-testid="step-line" {...stylex.props(type.compact, styles.ghost)}>
            {firstLine(step.fields[first ?? ""] ?? "")}
          </span>
          <span {...stylex.props(styles.grow)} />
          <WasToggle from={from} open={open} onToggle={() => setOpen(!open)} />
          {onRestore && <Button size="sm" icon="undo" label="Bring the step back" onClick={onRestore} />}
        </>
      }
    >
      {open && (
        <WasView
          from={from}
          step={step}
          xray={xray}
          layout={layout}
          index={-1}
          url={url}
          restoreLabel="Bring the step back"
          onOpenImage={onOpenImage}
        />
      )}
    </GoneFrame>
  );
}
