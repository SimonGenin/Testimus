import type { ReactNode } from "react";
import type { Block, Source, StepImage, Table } from "../../../core/types.ts";
import { TableGrid } from "../../components/ui/TableGrid.tsx";
import { dropCol, dropRow, hasHead, insertCol, insertRow, moveCol, moveRow, setHead, width } from "../../lib/table.ts";
import type { Moved } from "./step/moved.ts";
import { TableCell } from "./step/TableCell.tsx";

const SHORT = 24;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ponytail: a row or a column is named by what it says — its first cell, its head — so a menu and an Undo say
// « Row « PK voie 1 » », not a number the reader has to count; a picture or a blank gives the number back
const named = (text: string | undefined) => {
  const t =
    (text ?? "")
      .replace(/!\[\]\([^)]*\)|![^!\n]*!/g, "")
      .trim()
      .split("\n")[0] ?? "";
  return t.length > SHORT ? `${t.slice(0, SHORT - 1)}…` : t;
};

// ponytail: no model behind the table — the cells are slices of the field string, so every edit here, a typed
// character and a dropped column alike, is one replacement of that string; the grid (the kit's TableGrid) draws it
export function TableBlock({
  table,
  text,
  images,
  url,
  idBase,
  label,
  stepNumber,
  readOnly,
  lockedBy,
  grip,
  autoFocus,
  onText,
  onAddFiles,
  onFieldText,
  onDropBlock,
  onRemove,
  onOpen,
  onOpenSource,
}: {
  table: Table;
  text: string;
  images: StepImage[];
  url: (file: string) => string;
  idBase: string;
  label: string;
  stepNumber: number;
  readOnly?: boolean;
  lockedBy?: "claude";
  grip?: ReactNode;
  autoFocus?: boolean;
  onText: (at: number, end: number, value: string) => void;
  onAddFiles: (at: number, files: File[]) => void;
  /** the whole field rewritten; with undo, the change says so in a toast that can take it back */
  onFieldText: (next: string, undo?: string) => void;
  onDropBlock: (at: number, moved: Moved) => void;
  onRemove: (block: Block) => void;
  onOpen: (file: string) => void;
  onOpenSource?: (s: Source) => void;
}) {
  const cols = width(table);
  const head = hasHead(table);
  const rowName = (r: number) => {
    if (head && r === 0) return "Header row";
    const n = named(table.rows[r]?.cells[0]?.text);
    return n ? `Row « ${n} »` : `Row ${r + 1 - (head ? 1 : 0)}`;
  };
  const colName = (c: number) => {
    const n = head ? named(table.rows[0].cells[c]?.text) : "";
    return n ? `Column « ${n} »` : `Column ${c + 1}`;
  };
  const where = `${label} of step ${stepNumber}`;
  return (
    <TableGrid
      label={`Table in ${where}`}
      rows={table.rows.length}
      cols={cols}
      head={head}
      readOnly={readOnly}
      grip={grip}
      autoFocus={autoFocus}
      rowName={rowName}
      colName={colName}
      cell={(r, c, focused) => (
        <TableCell
          cell={table.rows[r].cells[c]}
          head={table.rows[r].head}
          focused={focused}
          id={`${idBase}-r${r}c${c}`}
          label={`${where}, ${lower(rowName(r))}, ${lower(colName(c))}`}
          images={images}
          url={url}
          readOnly={readOnly}
          lockedBy={lockedBy}
          onText={onText}
          onAddFiles={onAddFiles}
          onDropBlock={onDropBlock}
          onRemove={onRemove}
          onOpen={onOpen}
          onOpenSource={onOpenSource}
        />
      )}
      onInsertRow={(at) => onFieldText(insertRow(text, table, at))}
      onDeleteRow={(r) => onFieldText(dropRow(text, table, r), `${rowName(r)} deleted`)}
      onMoveRow={(r, to) => onFieldText(moveRow(text, table, r, to))}
      onInsertCol={(at) => onFieldText(insertCol(text, table, at))}
      onDeleteCol={(c) => onFieldText(dropCol(text, table, c), `${colName(c)} deleted`)}
      onMoveCol={(c, to) => onFieldText(moveCol(text, table, c, to))}
      onHead={(on) => onFieldText(setHead(text, table, on))}
      onDelete={() => onRemove({ ...table, kind: "table" } as Block)}
    />
  );
}
