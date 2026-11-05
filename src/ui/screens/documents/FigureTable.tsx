import { Fragment } from "react";
import { Table, type TableColumn } from "../../components/ui/Table.tsx";

type Row = { key: string; cells: string[] };

const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.replace(/\*\*/g, "").trim());

const rule = (line: string) => /^\|?[\s:|-]+$/.test(line.trim());

// ponytail: a table of doc.md drawn as a table — a figure of the text (its caption sits right by it) or a table in the
// reading — the first row heads the columns, a <br> in a cell breaks its line; a row is keyed by its line in the
// table, so `lit` (the line a quote lands in) lights it
export function FigureTable({ table, label, lit }: { table: string; label: string; lit?: number | null }) {
  const [head, ...body] = table
    .split("\n")
    .map((line, j) => ({ key: `${j}`, line }))
    .filter((l) => !rule(l.line))
    .map((l) => ({ key: l.key, cells: cellsOf(l.line) }));
  const columns: TableColumn<Row>[] = (head?.cells ?? []).map((h, i) => ({
    key: `${i}`,
    label: h,
    render: (r) =>
      (r.cells[i] ?? "").split(/\s*<br\s*\/?>\s*/i).map((part, j) => (
        <Fragment key={j}>
          {j > 0 && <br />}
          {part}
        </Fragment>
      )),
  }));
  return (
    <Table
      label={label}
      columns={columns}
      rows={body}
      getKey={(r) => r.key}
      lit={lit == null ? null : `${lit}`}
      dense
      grid
    />
  );
}
