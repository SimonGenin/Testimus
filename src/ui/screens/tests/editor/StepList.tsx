import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ColumnLayout, ColumnModes, Source, Step, StepImage, Test } from "../../../../core/types.ts";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Segmented } from "../../../components/ui/Segmented.tsx";
import type { FieldAutosave } from "../../../components/ui/Text.tsx";
import { type } from "../../../components/ui/type.ts";
import type { SourceFrom } from "../../../lib/app.ts";
import type { Column } from "../../../lib/columns.ts";
import type { Gone, StepMark } from "../../../lib/diff.ts";
import { border, color, radius, space } from "../../../styles/tokens.stylex.ts";
import { ColumnsMenu } from "../ColumnsMenu.tsx";
import { StepCard, type StepLayout } from "../StepCard.tsx";
import { GoneStep } from "../WasView.tsx";

const styles = stylex.create({
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s3,
    paddingTop: space.s3,
  },
  title: { margin: 0 },
  grow: { flex: 1 },
  slot: { position: "relative" },
  drop: {
    height: border.widthStrong,
    marginBlock: space.s1,
    borderRadius: radius.full,
    backgroundColor: color.accent,
  },
});

export type StepMarkOf = { claude?: "changed" | "added"; diff?: StepMark; before?: Step };

// ponytail: the steps of the open test — head (count, columns, layout), the cards in order with the deleted ones
// where they were, the drop line while a step is dragged, and the way to add one
export function StepList({
  test,
  testId,
  xray,
  linked,
  layout,
  projectModes,
  testModes,
  columns,
  gone,
  readOnly,
  focus,
  folded,
  saveState,
  savedUid,
  uidOf,
  markOf,
  url,
  addImage,
  alive,
  onLayout,
  onProjectModes,
  onTestModes,
  onPatch,
  onFold,
  onFocus,
  onMove,
  onInsert,
  onDelete,
  onReorder,
  onAsk,
  onDraft,
  onRestore,
  onOpenImage,
  onOpenSource,
  onImageGone,
}: {
  test: Test;
  testId: string;
  xray: ColumnLayout;
  linked: boolean;
  layout: StepLayout;
  projectModes: ColumnModes;
  testModes: ColumnModes | null;
  columns: Column[];
  gone: Gone[];
  readOnly: boolean;
  focus: number;
  folded: Set<number>;
  saveState?: FieldAutosave;
  /** the step whose field was edited last: it shows the save state */
  savedUid: number;
  uidOf: (s: Step) => number;
  markOf: (s: Step, i: number) => StepMarkOf;
  url: (file: string) => string;
  addImage: (f: File) => Promise<StepImage>;
  alive: () => () => boolean;
  onLayout: (l: StepLayout) => void;
  onProjectModes: (m: ColumnModes) => void;
  onTestModes: (m: ColumnModes | null) => void;
  onPatch: (uid: number, fn: (s: Step) => Step) => void;
  onFold: (uid: number, folded: boolean) => void;
  onFocus: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onInsert: (at: number) => void;
  onDelete: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onAsk: (i: number) => void;
  /** a test without steps: Claude drafts them from its description and sources */
  onDraft?: () => void;
  onRestore: (base: Step, gone: Gone | null, n: number) => void;
  onOpenImage: (file: string, images: StepImage[], step: number, column?: string) => void;
  /** a source of a step opened, with the step it backs and that step's sources (‹ › in the dialog) */
  onOpenSource: (s: Source, from?: SourceFrom) => void;
  onImageGone: (file: string) => void;
}) {
  const [drag, setDrag] = useState(-1);
  const [dropAt, setDropAt] = useState(-1);
  const goneAt = (i: number) => gone.filter((g) => g.at === i);
  const line = <div aria-hidden="true" data-testid="dropline" {...stylex.props(styles.drop)} />;
  const goneCard = (g: Gone, k: number) => (
    <div key={`gone:${g.step.id ?? k}`} {...stylex.props(styles.slot)}>
      <GoneStep
        step={g.step}
        xray={xray}
        layout={layout}
        url={url}
        onOpenImage={(file, images) => onOpenImage(file, images, 0)}
        onRestore={readOnly ? undefined : () => onRestore(g.step, g, test.steps.length)}
      />
    </div>
  );

  return (
    <>
      <div {...stylex.props(styles.head)}>
        <h2 {...stylex.props(type.titleSm, styles.title)}>Steps</h2>
        <Badge label={String(test.steps.length)} count size="sm" />
        <span {...stylex.props(styles.grow)} />
        <ColumnsMenu
          columns={columns}
          projectModes={projectModes}
          testModes={testModes}
          onProject={onProjectModes}
          onTest={onTestModes}
        />
        <Segmented
          label="Step layout"
          size="sm"
          value={layout}
          onChange={onLayout}
          options={[
            { value: "stacked", label: "Stacked", icon: "layout-stacked" },
            { value: "split", label: "Action | Expected", icon: "layout-split" },
          ]}
        />
      </div>
      {goneAt(-1).map(goneCard)}
      {test.steps.flatMap((s, i) => {
        const uid = uidOf(s);
        const m = markOf(s, i);
        return [
          <div key={`${testId}:${uid}`} data-step={i} {...stylex.props(styles.slot)}>
            {drag >= 0 && dropAt === i && line}
            <StepCard
              index={i}
              count={test.steps.length}
              step={s}
              xray={xray}
              linked={linked}
              layout={layout}
              projectModes={projectModes}
              testModes={testModes}
              claude={!!m.claude}
              added={m.claude === "added"}
              mark={m.diff === "same" ? undefined : m.diff}
              before={m.before}
              folded={folded.has(uid)}
              dragging={drag === i}
              focused={focus === i && drag < 0}
              readOnly={readOnly}
              saveState={savedUid === uid ? saveState : undefined}
              url={url}
              addImage={addImage}
              alive={alive}
              onChange={(fn) => onPatch(uid, fn)}
              onImageGone={onImageGone}
              onFold={(v) => onFold(uid, v)}
              onFocus={() => onFocus(i)}
              onMove={(dir) => onMove(i, dir)}
              onInsert={() => onInsert(i + 1)}
              onDelete={() => onDelete(i)}
              onAsk={() => onAsk(i)}
              onRestore={(b) => onRestore(b, null, i + 1)}
              onOpenImage={(file, images, column) => onOpenImage(file, images, i + 1, column)}
              onOpenSource={(src) => onOpenSource(src, { test: test.key ?? testId, step: i + 1, sources: s.sources })}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => {
                if (drag < 0) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
                if (at !== dropAt) setDropAt(at);
              }}
              onDrop={(e) => {
                if (drag < 0) return;
                e.preventDefault();
                onReorder(drag, dropAt);
                setDrag(-1);
                setDropAt(-1);
              }}
              onDragEnd={() => {
                setDrag(-1);
                setDropAt(-1);
              }}
            />
          </div>,
          ...goneAt(i).map(goneCard),
        ];
      })}
      {drag >= 0 && dropAt === test.steps.length && line}
      {test.steps.length === 0 ? (
        <EmptyState
          icon="tests"
          title="This test has no steps yet"
          text="Write the first one, or ask Claude to draft the steps from the test's description and sources."
          actions={
            readOnly ? undefined : (
              <>
                <Button variant="primary" icon="plus" label="Add first step" onClick={() => onInsert(0)} />
                {onDraft && (
                  <Button variant="claude-quiet" icon="claude" label="Ask Claude to draft them" onClick={onDraft} />
                )}
              </>
            )
          }
        />
      ) : (
        !readOnly && (
          <Card dashed padded={false}>
            <Button
              variant="quiet"
              size="lg"
              icon="plus"
              label="Add step"
              block
              onClick={() => onInsert(test.steps.length)}
            />
          </Card>
        )
      )}
    </>
  );
}
