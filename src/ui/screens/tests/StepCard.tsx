import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ColumnLayout, ColumnModes, Source, Step, StepImage } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { FieldAutosave } from "../../components/ui/Text.tsx";
import { hasRawEmbed, leafBlocks } from "../../lib/blocks.ts";
import {
  type Column,
  collapsible,
  columnsOf,
  modeOf,
  projectModes as modesOf,
  openByDefault,
  splitTracks,
} from "../../lib/columns.ts";
import type { StepMark } from "../../lib/diff.ts";
import { itemLinks, stepSources } from "../../lib/fields.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { ColumnField } from "./ColumnField.tsx";
import { FieldBlocks } from "./FieldBlocks.tsx";
import { ItemLinks } from "./step/ItemLinks.tsx";
import { MOVE } from "./step/moved.ts";
import { FieldRow, StepFields } from "./step/StepFields.tsx";
import { StepFrame, StepSourcesRow } from "./step/StepFrame.tsx";
import { Grip, GripSlot, StepHead, type StepMarks } from "./step/StepHead.tsx";
import { StepOrphans } from "./step/StepOrphans.tsx";
import { StepSource } from "./step/StepSource.tsx";
import { firstLine } from "./step/stepText.ts";
import { useStepEdits } from "./step/useStepEdits.ts";
import { WasView } from "./WasView.tsx";

export type StepLayout = "stacked" | "split";

const styles = stylex.create({
  body: { boxSizing: "border-box", paddingInlineStart: space.s4, paddingInlineEnd: space.s5, paddingBottom: space.s3 },
});

export function StepCard({
  index,
  count,
  step,
  xray,
  linked = true,
  layout,
  projectModes,
  testModes = null,
  claude,
  added,
  mark,
  before,
  folded,
  dragging,
  focused,
  readOnly,
  saveState,
  url,
  addImage,
  alive,
  onChange,
  onImageGone,
  onFold,
  onFocus,
  onMove,
  onInsert,
  onDelete,
  onAsk,
  onRestore,
  onOpenImage,
  onOpenSource,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  index: number;
  count: number;
  step: Step;
  xray: ColumnLayout;
  linked?: boolean;
  layout: StepLayout;
  projectModes?: ColumnModes;
  testModes?: ColumnModes | null;
  claude?: boolean;
  added?: boolean;
  mark?: StepMark;
  before?: Step;
  folded?: boolean;
  dragging?: boolean;
  // ponytail: the step last worked on keeps its ring while focus is elsewhere (the dock, a dialog), as in Xray Editor
  focused?: boolean;
  readOnly?: boolean;
  /** the test's save state, shown on the field of this step last edited */
  saveState?: FieldAutosave;
  url: (file: string) => string;
  addImage?: (file: File) => Promise<StepImage>;
  alive?: () => () => boolean;
  onChange: (fn: (s: Step) => Step) => void;
  onImageGone?: (file: string) => void;
  onFold?: (folded: boolean) => void;
  onFocus?: () => void;
  onMove?: (dir: -1 | 1) => void;
  onInsert?: () => void;
  onDelete?: () => void;
  onAsk?: () => void;
  onRestore?: (before: Step) => void;
  onOpenImage?: (file: string, images: StepImage[], column?: string) => void;
  onOpenSource?: (s: Source) => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [wasOpen, setWasOpen] = useState(false);
  const [lastField, setLastField] = useState("");
  const n = index + 1;
  const cols = columnsOf(xray, step, linked);
  const val = (name: string) => step.fields[name] ?? "";
  const unreadable = hasRawEmbed(step);
  const pModes = projectModes ?? modesOf(xray);
  const isOpen = (c: Column) => folds[c.name] ?? openByDefault(modeOf(c, pModes, testModes), val(c.name));
  const shown = cols.filter(isOpen);
  const loose = stepSources(
    xray,
    step,
    shown.map((c) => c.name),
  );
  const edits = useStepEdits({ step, n, onChange, addImage, onImageGone, alive });
  const marks: StepMarks = { claude, added, mark, unreadable };
  const split = layout === "split";

  const embedded = new Set(
    cols.flatMap((c) =>
      leafBlocks(val(c.name), step.images).flatMap((b) => (b.kind === "image" ? [b.image.file] : [])),
    ),
  );
  const orphans = step.images.filter((im) => !embedded.has(im.file));

  const fieldOf = (c: Column) => {
    const value = val(c.name);
    const save = c.name === lastField ? saveState : undefined;
    const touch = () => setLastField(c.name);
    if (c.kind !== "blocks")
      return (
        <ColumnField
          column={c}
          value={value}
          stepNumber={n}
          readOnly={readOnly}
          wrap={split}
          saveState={save}
          onChange={(next) => {
            touch();
            edits.setWhole(c.name, next);
          }}
        />
      );
    return (
      <FieldBlocks
        idBase={`s${index}-${c.name.replace(/\W+/g, "")}`}
        name={c.name}
        label={c.name}
        text={value}
        images={step.images}
        url={url}
        stepNumber={n}
        readOnly={readOnly}
        lockedBy={readOnly ? "claude" : undefined}
        saveState={save}
        onText={(at, end, v) => {
          touch();
          edits.setText(c.name, at, end, v);
        }}
        onAddFiles={(at, files) => void edits.addFiles(c.name, at, files)}
        onFieldText={(next) => edits.setWhole(c.name, next)}
        onDropBlock={(at, moved) => edits.dropBlock(c.name, at, moved)}
        onRemove={(b) => edits.removeBlock(c.name, b)}
        onOpen={(file) => onOpenImage?.(file, step.images, c.name)}
        onOpenSource={onOpenSource}
      />
    );
  };

  const row = (c: Column) => {
    const links = itemLinks(xray, step, c.name);
    return (
      <FieldRow
        key={c.name}
        name={c.name}
        split={split}
        note={
          !c.known ? (
            <Badge
              label="not in Xray"
              size="sm"
              tone="warning"
              icon="alert-triangle"
              tooltip="Kept in test.md, never pushed: the project has no such step field in Xray"
            />
          ) : c.off ? (
            <Badge label="off in Xray" size="sm" icon="eye-off" tooltip="Switched off in Xray's project settings" />
          ) : undefined
        }
        onPaste={(e) => {
          if (readOnly || c.kind !== "blocks" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
          if (!files.length) return;
          e.preventDefault();
          void edits.addFiles(c.name, val(c.name).length, files);
        }}
      >
        {fieldOf(c)}
        {links.length > 0 && <ItemLinks column={c.name} links={links} onOpen={onOpenSource} />}
      </FieldRow>
    );
  };

  const dnd = {
    draggable: armed && !readOnly,
    onDragStart: (e: React.DragEvent) => {
      if (e.target !== e.currentTarget) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `step ${n}`);
      onDragStart?.();
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(MOVE) || e.dataTransfer.types.includes("Files")) return;
      onDragOver?.(e);
    },
    onDrop: (e: React.DragEvent) => {
      setArmed(false);
      if (e.dataTransfer.types.includes(MOVE) || e.dataTransfer.types.includes("Files")) return;
      onDrop?.(e);
    },
    onDragEnd: () => {
      setArmed(false);
      onDragEnd?.();
    },
  };

  const grip = readOnly ? <GripSlot /> : <Grip n={n} focused={focused} onArm={setArmed} />;
  const frame = { n, marks, grip, focused, dragging, onFocusCapture: onFocus, ...dnd };

  if (folded)
    return (
      <StepFrame
        {...frame}
        line={firstLine(cols[0] ? val(cols[0].name) : "")}
        head={
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon="chevron-down"
            label={`Expand step ${n}`}
            onClick={() => onFold?.(false)}
          />
        }
      />
    );

  return (
    <StepFrame
      {...frame}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.ctrlKey && e.key === "Enter") {
          e.preventDefault();
          onInsert?.();
        } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onMove?.(e.key === "ArrowUp" ? -1 : 1);
        }
      }}
      head={
        <StepHead
          n={n}
          index={index}
          count={count}
          jira={before ? { open: wasOpen, toggle: () => setWasOpen(!wasOpen) } : undefined}
          folds={cols.filter(collapsible).map((c) => {
            const open = isOpen(c);
            return {
              name: c.name,
              open,
              filled: val(c.name).trim() !== "",
              toggle: () => setFolds((f) => ({ ...f, [c.name]: !open })),
            };
          })}
          readOnly={readOnly}
          onAsk={onAsk}
          onMove={onMove}
          onInsert={onInsert}
          onDelete={onDelete}
          onFold={onFold}
        />
      }
    >
      {wasOpen && before && (
        <WasView
          step={before}
          xray={xray}
          layout={layout}
          index={index}
          url={url}
          restoreLabel="Restore this step"
          onOpenImage={(file, images) => onOpenImage?.(file, images)}
          onRestore={readOnly || !onRestore ? undefined : () => onRestore(before)}
        />
      )}
      <div {...stylex.props(styles.body)}>
        <StepFields split={split} tracks={splitTracks(shown)}>
          {shown.map(row)}
        </StepFields>
      </div>
      {orphans.length > 0 && (
        <StepOrphans
          n={n}
          orphans={orphans}
          readOnly={readOnly}
          url={url}
          onOpen={(file) => onOpenImage?.(file, step.images)}
          onDetach={edits.detach}
        />
      )}
      {loose.length > 0 && (
        <StepSourcesRow>
          {loose.map((s, i) => (
            <StepSource key={i} source={s} onOpen={onOpenSource} />
          ))}
        </StepSourcesRow>
      )}
    </StepFrame>
  );
}
