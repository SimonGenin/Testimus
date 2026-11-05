import { useState } from "react";
import { TableGrid } from "../../../components/ui/TableGrid.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

type Grid = { head: boolean; rows: string[][] };

const START: Grid = {
  head: true,
  rows: [
    ["Champ", "Valeur attendue"],
    ["Position", "Fermé"],
    ["PK voie 1", "12,480"],
  ],
};

const swap = <T,>(xs: T[], i: number, j: number) => {
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

function Live({ readOnly, start = START }: { readOnly?: boolean; start?: Grid }) {
  const [g, setG] = useState<Grid>(start);
  const cols = g.rows[0]?.length ?? 0;
  const rowName = (r: number) =>
    g.head && r === 0 ? "Header row" : g.rows[r][0] ? `Row « ${g.rows[r][0]} »` : `Row ${r}`;
  const colName = (c: number) => (g.head && g.rows[0][c] ? `Column « ${g.rows[0][c]} »` : `Column ${c + 1}`);
  const blank = () => Array.from({ length: cols }, () => "");
  return (
    <TableGrid
      label="Expected values"
      rows={g.rows.length}
      cols={cols}
      head={g.head}
      readOnly={readOnly}
      rowName={rowName}
      colName={colName}
      cell={(r, c, focused) => (
        <Text
          multiline
          appearance="cell"
          size="sm"
          ariaLabel={`${rowName(r)}, ${colName(c)}`}
          value={g.rows[r][c] ?? ""}
          readOnly={readOnly}
          placeholder={g.head && r === 0 ? "Column name" : focused ? "Type, or paste an image" : undefined}
          onChange={(v) =>
            setG((x) => ({
              ...x,
              rows: x.rows.map((row, i) => (i === r ? row.map((t, k) => (k === c ? v : t)) : row)),
            }))
          }
        />
      )}
      onInsertRow={(at) => setG((x) => ({ ...x, rows: [...x.rows.slice(0, at), blank(), ...x.rows.slice(at)] }))}
      onDeleteRow={(r) => setG((x) => ({ ...x, rows: x.rows.filter((_, i) => i !== r) }))}
      onMoveRow={(r, to) => setG((x) => ({ ...x, rows: swap(x.rows, r, to) }))}
      onInsertCol={(at) =>
        setG((x) => ({ ...x, rows: x.rows.map((row) => [...row.slice(0, at), "", ...row.slice(at)]) }))
      }
      onDeleteCol={(c) => setG((x) => ({ ...x, rows: x.rows.map((row) => row.filter((_, k) => k !== c)) }))}
      onMoveCol={(c, to) => setG((x) => ({ ...x, rows: x.rows.map((row) => swap(row, c, to)) }))}
      onHead={(on) => setG((x) => ({ ...x, head: on }))}
      onDelete={() => setG(START)}
    />
  );
}

export const section: KitSection = {
  name: "TableGrid",
  family: "Inputs",
  file: "TableGrid.tsx",
  summary:
    "A table you write in: a step's table block. Each cell is a Text with appearance cell; the grid carries the rows and the columns.",
  note: "The Table with grid draws data; this one is edited. Nothing in it shows only under the pointer.",
  guidelines: [
    {
      head: "Anatomy",
      items: [
        "A bar above the table: the block's grip, « Table », its size in rows and columns, and the table's menu (Add row, Add column, Header row, Delete table).",
        "The grid: a header row on the sunken ground when the table has one; the cell being written is outlined in the focus colour.",
        "Always there while it can be edited: « Add row » under the last row and « + » after the last column, where the new one appears.",
        "On the edge of the cell being written: a handle on its row (left) and one on its column (top). Their menus say what they do: insert, move, delete.",
      ],
    },
    {
      head: "Rules",
      items: [
        "No ✕ in the grid. A row or a column goes through its handle's menu, or the cell's menu (right click, Shift F10).",
        "What goes is gone at once and the toast offers Undo; a menu never asks for a confirmation here.",
        "A row and a column are named by what they say (« Row « PK voie 1 » », « Column « Unité » »), a number only when blank.",
        "Keys: Tab and Shift Tab go from cell to cell, Tab in the last cell adds a row, Alt Shift and an arrow move the row or the column, Escape leaves the table.",
        "A column is at least as wide as a large thumbnail (160 px); past that, the table scrolls in its frame.",
      ],
    },
  ],
  states: () => (
    <States>
      <Cell label="editable (click a cell: its row and column get their handles)" wide column>
        <Live />
      </Cell>
      <Cell label="a new table: blank heads named by a placeholder" wide column>
        <Live
          start={{
            head: true,
            rows: [
              ["", ""],
              ["", ""],
            ],
          }}
        />
      </Cell>
      <Cell label="read-only (the review, an earlier version, a test Claude is writing)" wide column>
        <Live readOnly />
      </Cell>
    </States>
  ),
};
