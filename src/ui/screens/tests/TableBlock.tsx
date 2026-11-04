import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Block, StepImage, Table } from "../../../core/types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { addCol, addRow, dropCol, dropRow, width } from "../../lib/table.ts";
import { border, color, fontSize, fontWeight, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { FieldBlocks } from "./FieldBlocks.tsx";
import type { Moved } from "./step/moved.ts";

const styles = stylex.create({
  block: { display: "flex", flexDirection: "column", gap: space.s2, marginBlock: space.s1, minWidth: 0 },
  wrap: {
    boxSizing: "border-box",
    overflowX: "auto",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r2,
  },
  table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
  cell: {
    boxSizing: "border-box",
    verticalAlign: "top",
    paddingBlock: 0,
    paddingInline: space.s1,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    textAlign: "start",
    fontWeight: fontWeight.regular,
  },
  head: {
    backgroundColor: color.surfaceSunken,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.semibold,
  },
  grips: { boxSizing: "border-box", borderWidth: 0, paddingBlock: space.s1, textAlign: "end" },
  gripCol: { boxSizing: "border-box", width: space.s7, borderWidth: 0, verticalAlign: "middle", textAlign: "center" },
  tools: { display: "flex", alignItems: "center", gap: space.s1 },
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
  const x = (title: string, run: () => void) => (
    <Button variant="quiet" size="xs" iconOnly icon="close" label={title} onClick={run} />
  );
  return (
    <div {...stylex.props(styles.block)}>
      <div {...stylex.props(styles.wrap)}>
        <table {...stylex.props(styles.table)}>
          {!readOnly && (
            <thead>
              <tr>
                <th {...stylex.props(styles.gripCol)} />
                {Array.from({ length: cols }, (_, i) => (
                  <th key={i} {...stylex.props(styles.grips)}>
                    {x(`Delete column ${i + 1}`, () => onFieldText(dropCol(text, table, i)))}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {table.rows.map((r, ri) => (
              <tr key={ri}>
                {!readOnly && (
                  <td {...stylex.props(styles.gripCol)}>
                    {x(`Delete row ${ri + 1}`, () => onFieldText(dropRow(text, table, ri)))}
                  </td>
                )}
                {Array.from({ length: cols }, (_, ci) => {
                  const c = r.cells[ci];
                  const Cell = r.head ? "th" : "td";
                  return (
                    <Cell
                      key={ci}
                      scope={r.head ? "col" : undefined}
                      {...stylex.props(styles.cell, r.head && styles.head)}
                    >
                      {c && (
                        <FieldBlocks
                          nested
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
