import * as stylex from "@stylexjs/stylex";
import { Fragment, useContext, useLayoutEffect, useRef, useState } from "react";
import type { Block, Source, StepImage } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { type FieldAutosave, Text } from "../../components/ui/Text.tsx";
import { AppContext } from "../../lib/app.ts";
import { blocksOf } from "../../lib/blocks.ts";
import { NEW_TABLE } from "../../lib/table.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { blockMarker, fieldMarker } from "./markers.stylex.ts";
import { BlockInsert } from "./step/BlockInsert.tsx";
import { ExternBlock, ImageBlock } from "./step/ImageBlock.tsx";
import { MOVE, type Moved } from "./step/moved.ts";
import { StepSource } from "./step/StepSource.tsx";
import { fileName } from "./step/stepText.ts";
import { TableBlock } from "./TableBlock.tsx";

export { MOVE, type Moved };

const styles = stylex.create({
  blocks: { display: "flex", flexDirection: "column", minWidth: 0 },
  row: { position: "relative", display: "flex", alignItems: "flex-start", gap: space.s1, minWidth: 0 },
  grow: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  tools: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    paddingTop: space.s1,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", blockMarker)]: 1,
      [stylex.when.ancestor(":focus-within", blockMarker)]: 1,
    },
  },
  grip: { display: "inline-flex", color: color.textSubtle, cursor: "grab" },
  ro: { margin: 0, paddingBlock: space.s2, color: color.textSubtle },
});

type Item = Block & { draft?: true };

const takes = (e: React.DragEvent) => ["Files", MOVE].some((t) => e.dataTransfer.types.includes(t));
const figureSource = (figure: string) => {
  const at = figure.indexOf("#");
  return { docId: figure.slice(0, at), anchor: figure.slice(at + 1), quote: "" };
};

function Grip() {
  return (
    <span data-testid="block-grip" title="Drag to move" draggable {...stylex.props(styles.grip)}>
      <Icon name="grip" size="sm" />
    </span>
  );
}

// ponytail: a field of Xray text drawn as its blocks — text, screenshots, tables, outside pictures, raw markup — each an
// edit of a slice of the one string, so nothing here holds a model of its own
export function FieldBlocks({
  idBase,
  name,
  label,
  text,
  images,
  url,
  stepNumber,
  readOnly,
  lockedBy,
  nested,
  size,
  saveState,
  onText,
  onAddFiles,
  onFieldText,
  onDropBlock,
  onRemove,
  onOpen,
  onOpenSource,
}: {
  idBase: string;
  name: string;
  label: string;
  text: string;
  images: StepImage[];
  url: (file: string) => string;
  stepNumber: number;
  readOnly?: boolean;
  /** read-only because a Claude run holds the test: the text shows Claude's lock */
  lockedBy?: "claude";
  nested?: boolean;
  /** the text blocks' size: sm inside a table's cells */
  size?: "sm";
  /** the save state of the test, shown on the text block last edited here */
  saveState?: FieldAutosave;
  onText: (at: number, end: number, value: string) => void;
  onAddFiles: (at: number, files: File[]) => void;
  onFieldText: (next: string) => void;
  onDropBlock: (at: number, moved: Moved) => void;
  onRemove: (block: Block) => void;
  onOpen: (file: string) => void;
  /** a figure's source chip: opens the source with the step it sits in (else the app's dialog, without it) */
  onOpenSource?: (s: Source) => void;
}) {
  const app = useContext(AppContext);
  const openSource = onOpenSource ?? app?.openSource;
  // ponytail: the draft caret is a view, not an edit — nothing empty is ever written to the file; it is
  // remembered with the text it was opened on and simply gone once that text changed
  const [draft, setDraft] = useState<{ at: number; text: string } | null>(null);
  const [edited, setEdited] = useState(-1);
  const focusDraft = useRef(false);

  const items: Item[] = blocksOf(text, images);
  if (!readOnly && draft && draft.text === text) {
    const at = draft.at;
    const i = items.findIndex((b) => b.at >= at);
    items.splice(i < 0 ? items.length : i, 0, { kind: "text", text: "", at, end: at, draft: true });
  }
  const id = (i: number) => `${idBase}-${i}`;

  useLayoutEffect(() => {
    if (!focusDraft.current) return;
    focusDraft.current = false;
    const i = items.findIndex((b) => b.draft);
    if (i >= 0) document.getElementById(id(i))?.focus();
  });

  const insert = (at: number, empty = false, edge?: "first" | "last") =>
    readOnly ? null : (
      <BlockInsert
        empty={empty}
        edge={edge}
        table={!nested}
        onText={() => {
          focusDraft.current = true;
          setDraft({ at, text });
        }}
        onImage={(files) => onAddFiles(at, files)}
        onTable={() => onText(at, at, NEW_TABLE)}
        onDrop={(d) => ("moved" in d ? onDropBlock(at, d.moved) : onAddFiles(at, d.files))}
      />
    );

  const remove = (b: Block, what: string) =>
    readOnly ? null : (
      <Button
        variant="quiet"
        size="xs"
        iconOnly
        icon="close"
        label={`Delete this ${what} of ${label} of step ${stepNumber}`}
        onClick={() => onRemove(b)}
      />
    );

  const where = `${label} of step ${stepNumber}`;

  return (
    <div
      data-testid="blocks"
      data-empty={!items.length || undefined}
      {...stylex.props(fieldMarker, styles.blocks)}
      onDragOver={(e) => !readOnly && takes(e) && e.preventDefault()}
      onDrop={(e) => {
        if (readOnly || !takes(e)) return;
        e.preventDefault();
        const moved = e.dataTransfer.getData(MOVE);
        if (moved) onDropBlock(text.length, JSON.parse(moved) as Moved);
        else onAddFiles(text.length, Array.from(e.dataTransfer.files));
      }}
    >
      {readOnly && !items.length && <p {...stylex.props(styles.ro)}>—</p>}
      {items.length ? insert(0, false, "first") : insert(0, true)}
      {items.map((b, i) => (
        <Fragment key={i}>
          <div
            data-testid="block"
            {...stylex.props(blockMarker, styles.row)}
            onDragStart={(e) => {
              if (readOnly || b.draft) return;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(MOVE, JSON.stringify({ step: stepNumber, field: name, at: b.at, end: b.end }));
            }}
            onPaste={(e) => {
              if (readOnly || b.kind !== "text") return;
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (!files.length) return;
              e.preventDefault();
              const box = e.target as HTMLTextAreaElement;
              onAddFiles(b.at + (box.selectionStart ?? b.text.length), files);
            }}
          >
            {b.kind === "text" && (
              <>
                <div {...stylex.props(styles.grow)}>
                  <Text
                    id={id(i)}
                    multiline
                    appearance="inline"
                    size={size}
                    ariaLabel={where}
                    value={b.text}
                    readOnly={readOnly && !lockedBy}
                    lockedBy={lockedBy}
                    autosave={edited === i ? saveState : undefined}
                    onChange={(v) => {
                      setEdited(i);
                      onText(b.at, b.end, v);
                    }}
                    onBlur={() => b.draft && setDraft(null)}
                  />
                </div>
                {!readOnly && !b.draft && (
                  <span {...stylex.props(styles.tools)}>
                    <Grip />
                    {remove(b, "text")}
                  </span>
                )}
              </>
            )}
            {b.kind === "image" && (
              <ImageBlock
                src={url(b.image.file)}
                name={fileName(b.image.file)}
                label={where}
                grip={readOnly ? undefined : <Grip />}
                caption={
                  b.image.figure ? (
                    <StepSource source={figureSource(b.image.figure)} compact onOpen={openSource} />
                  ) : undefined
                }
                onOpen={() => onOpen(b.image.file)}
                onRemove={readOnly ? undefined : () => onRemove(b)}
              />
            )}
            {b.kind === "extern" && (
              <ExternBlock
                url={b.url}
                params={b.params}
                label={where}
                grip={readOnly ? undefined : <Grip />}
                onRemove={readOnly ? undefined : () => onRemove(b)}
              />
            )}
            {b.kind === "table" && (
              <div {...stylex.props(styles.grow)}>
                <TableBlock
                  table={b}
                  text={text}
                  images={images}
                  url={url}
                  idBase={idBase}
                  name={name}
                  label={label}
                  stepNumber={stepNumber}
                  readOnly={readOnly}
                  lockedBy={lockedBy}
                  grip={readOnly ? undefined : <Grip />}
                  onText={onText}
                  onAddFiles={onAddFiles}
                  onFieldText={onFieldText}
                  onDropBlock={onDropBlock}
                  onRemove={onRemove}
                  onOpen={onOpen}
                  onOpenSource={onOpenSource}
                />
              </div>
            )}
            {b.kind === "raw" && (
              <div {...stylex.props(styles.grow)}>
                <Disclosure summary="Xray markup this editor cannot read" quiet>
                  <Raw text={b.text} />
                </Disclosure>
                {!readOnly && (
                  <span {...stylex.props(styles.tools)}>
                    <Grip />
                  </span>
                )}
              </div>
            )}
          </div>
          {insert(b.draft ? b.at : b.end, false, i === items.length - 1 ? "last" : undefined)}
        </Fragment>
      ))}
    </div>
  );
}
