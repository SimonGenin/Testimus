import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Block, StepImage, Table } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { type } from "../../components/ui/type.ts";
import { addCol, addRow, dropCol, dropRow, width } from "../../lib/table.ts";
import { border, color, radius, shadow, size, space } from "../../styles/tokens.stylex.ts";
import { FieldBlocks } from "./FieldBlocks.tsx";
import { tableMarker } from "./markers.stylex.ts";
import type { Moved } from "./step/moved.ts";

const styles = stylex.create({
  block: { position: "relative", display: "flex", flexDirection: "column", marginBlock: space.s1, minWidth: 0 },
  wrap: {
    boxSizing: "border-box",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.borderStrong,
    borderRadius: radius.r2,
    overflow: "hidden",
    backgroundColor: color.surface,
  },
  table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
  cell: {
    boxSizing: "border-box",
    position: "relative",
    verticalAlign: "top",
    paddingBlock: space.s1,
    paddingInline: space.s3,
    borderWidth: 0,
    borderStyle: "solid",
    borderColor: color.border,
    textAlign: "start",
  },
  below: { borderBottomWidth: border.width },
  after: { borderInlineStartWidth: border.width },
  room1: { paddingInlineEnd: `calc(${space.s3} + ${size.controlXs})` },
  room2: { paddingInlineEnd: `calc(${space.s3} + ${space.s1} + 2 * ${size.controlXs})` },
  cellX: {
    position: "absolute",
    top: 0,
    bottom: 0,
    insetInlineEnd: space.s1,
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", tableMarker)]: 1,
      [stylex.when.ancestor(":focus-within", tableMarker)]: 1,
    },
    pointerEvents: {
      default: "none",
      [stylex.when.ancestor(":hover", tableMarker)]: "auto",
      [stylex.when.ancestor(":focus-within", tableMarker)]: "auto",
    },
  },
  tools: {
    position: "absolute",
    top: "100%",
    insetInlineStart: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    marginTop: space.s1,
    paddingInline: space.s2,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s2,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", tableMarker)]: 1,
      [stylex.when.ancestor(":focus-within", tableMarker)]: 1,
    },
    pointerEvents: {
      default: "none",
      [stylex.when.ancestor(":hover", tableMarker)]: "auto",
      [stylex.when.ancestor(":focus-within", tableMarker)]: "auto",
    },
  },
});

// ponytail: no model behind the table — the cells are slices of the field string, so every edit here,
// a typed character and a dropped column alike, is one replacement of that string
export function TableBlock({
  table,
  text,
  images,
  url,
  idBase,
  name,
  label,
  stepNumber,
  readOnly,
  lockedBy,
  grip,
  onText,
  onAddFiles,
  onFieldText,
  onDropBlock,
  onRemove,
  onOpen,
}: {
  table: Table;
  text: string;
  images: StepImage[];
  url: (file: string) => string;
  idBase: string;
  name: string;
  label: string;
  stepNumber: number;
  readOnly?: boolean;
  lockedBy?: "claude";
  grip?: ReactNode;
  onText: (at: number, end: number, value: string) => void;
  onAddFiles: (at: number, files: File[]) => void;
  onFieldText: (next: string) => void;
  onDropBlock: (at: number, moved: Moved) => void;
  onRemove: (block: Block) => void;
  onOpen: (file: string) => void;
}) {
  const cols = width(table);
  const last = table.rows.length - 1;
  const x = (title: string, run: () => void) => (
    <Button variant="quiet" size="xs" iconOnly icon="close" label={title} onClick={run} />
  );
  return (
    <div {...stylex.props(styles.block, tableMarker)}>
      <div {...stylex.props(styles.wrap)}>
        <table {...stylex.props(styles.table)}>
          <tbody>
            {table.rows.map((r, ri) => (
              <tr key={ri}>
                {Array.from({ length: cols }, (_, ci) => {
                  const c = r.cells[ci];
                  const Cell = r.head ? "th" : "td";
                  const lastCol = ci === cols - 1;
                  const room = readOnly ? 0 : Number(ri === 0) + Number(lastCol);
                  return (
                    <Cell
                      key={ci}
                      scope={r.head ? "col" : undefined}
                      {...stylex.props(
                        type.regular,
                        styles.cell,
                        ri < last && styles.below,
                        ci > 0 && styles.after,
                        room === 1 && styles.room1,
                        room === 2 && styles.room2,
                        r.head && type.caption,
                      )}
                    >
                      {c && (
                        <FieldBlocks
                          nested
                          size="sm"
                          idBase={`${idBase}-r${ri}c${ci}`}
                          name={name}
                          label={`${label}, row ${ri + 1} column ${ci + 1}`}
                          text={c.text}
                          images={images}
                          url={url}
                          stepNumber={stepNumber}
                          readOnly={readOnly}
                          lockedBy={lockedBy}
                          onText={(at, end, v) => onText(c.at + at, c.at + end, v)}
                          onAddFiles={(at, files) => onAddFiles(c.at + at, files)}
                          onFieldText={(next) => onFieldText(text.slice(0, c.at) + next + text.slice(c.end))}
                          onDropBlock={(at, moved) => onDropBlock(c.at + at, moved)}
                          onRemove={(b) => onRemove({ ...b, at: c.at + b.at, end: c.at + b.end })}
                          onOpen={onOpen}
                        />
                      )}
                      {room > 0 && (
                        <span {...stylex.props(styles.cellX)}>
                          {ri === 0 && x(`Delete column ${ci + 1}`, () => onFieldText(dropCol(text, table, ci)))}
                          {lastCol && x(`Delete row ${ri + 1}`, () => onFieldText(dropRow(text, table, ri)))}
                        </span>
                      )}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div {...stylex.props(styles.tools)}>
          {grip}
          <Button
            variant="quiet"
            size="sm"
            icon="plus"
            label="Add row"
            onClick={() => onFieldText(addRow(text, table))}
          />
          <Button
            variant="quiet"
            size="sm"
            icon="plus"
            label="Add column"
            onClick={() => onFieldText(addCol(text, table))}
          />
          <Button
            variant="quiet"
            size="sm"
            icon="trash"
            label="Remove the table"
            onClick={() => onRemove({ ...table, kind: "table" } as Block)}
          />
        </div>
      )}
    </div>
  );
}
