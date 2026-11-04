import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ColumnLayout, Step, StepImage } from "../../../core/types.ts";
import { Badge, DIFF } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { collapsible, columnsOf, splitTracks } from "../../lib/columns.ts";
import { border, color, radius, space } from "../../styles/tokens.stylex.ts";
import { ColumnField } from "./ColumnField.tsx";
import { FieldBlocks } from "./FieldBlocks.tsx";
import type { StepLayout } from "./StepCard.tsx";
import { FieldRow, StepFields } from "./step/StepFields.tsx";
import { GoneFrame } from "./step/StepFrame.tsx";
import { firstLine } from "./step/stepText.ts";

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

const none = () => {};

// The snapshot of a step, drawn by the very same field blocks as the live card (same layout, same
// screenshots) — only read-only: no insert strips, no grip, no ✕, and its images still open in the lightbox
export function WasView({
  step,
  xray,
  layout,
  index,
  url,
  restoreLabel,
  onOpenImage,
  onRestore,
}: {
  step: Step;
  xray: ColumnLayout;
  layout: StepLayout;
  index: number;
  url: (file: string) => string;
  restoreLabel: string;
  onOpenImage: (file: string, images: StepImage[]) => void;
  onRestore?: () => void;
}) {
  const shown = columnsOf(xray, step).filter((c) => !collapsible(c) || (step.fields[c.name] ?? "").trim());
  const n = index + 1;
  const split = layout === "split";
  return (
    <section aria-label={`Step ${n} as Jira has it`} {...stylex.props(styles.was)}>
      <div {...stylex.props(type.small, styles.head)}>
        <span {...stylex.props(type.medium, styles.title)}>
          <Icon name="history" size="sm" />
          In Jira, last synced
        </span>
        <span {...stylex.props(styles.grow)} />
        {onRestore && <Button size="sm" icon="undo" label={restoreLabel} onClick={onRestore} />}
      </div>
      <div {...stylex.props(styles.body)}>
        <StepFields split={split} tracks={splitTracks(shown)}>
          {shown.map((c) => {
            const value = step.fields[c.name] ?? "";
            return (
              <FieldRow key={c.name} name={c.name} split={split}>
                {c.kind === "blocks" ? (
                  <FieldBlocks
                    readOnly
                    idBase={`was${index}-${c.name.replace(/\W+/g, "")}`}
                    name={c.name}
                    label={c.name}
                    text={value}
                    images={step.images}
                    url={url}
                    stepNumber={n}
                    onText={none}
                    onAddFiles={none}
                    onFieldText={none}
                    onDropBlock={none}
                    onRemove={none}
                    onOpen={(file) => onOpenImage(file, step.images)}
                  />
                ) : (
                  <ColumnField column={c} value={value} stepNumber={n} readOnly onChange={none} />
                )}
              </FieldRow>
            );
          })}
        </StepFields>
      </div>
    </section>
  );
}

// A step Jira still has and the local test no longer does: an unnumbered placeholder, kept only so the
// deletion is visible and its Jira version still readable, and inert everywhere else
export function GoneStep({
  step,
  xray,
  layout,
  url,
  onOpenImage,
  onRestore,
}: {
  step: Step;
  xray: ColumnLayout;
  layout: StepLayout;
  url: (file: string) => string;
  onOpenImage: (file: string, images: StepImage[]) => void;
  onRestore?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <GoneFrame
      head={
        <>
          <Badge {...DIFF.deleted} />
          <span data-testid="step-line" {...stylex.props(type.compact, styles.ghost)}>
            {firstLine(step.fields.Action ?? "")}
          </span>
          <span {...stylex.props(styles.grow)} />
          <Button
            variant="quiet"
            size="sm"
            icon="history"
            label={open ? "Hide Jira version" : "Jira version"}
            pressed={open}
            onClick={() => setOpen(!open)}
          />
          {onRestore && <Button size="sm" icon="undo" label="Bring the step back" onClick={onRestore} />}
        </>
      }
    >
      {open && (
        <WasView
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
