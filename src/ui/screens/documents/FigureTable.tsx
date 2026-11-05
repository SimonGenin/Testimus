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

// ponytail: a figure that is a table of the text (its caption sits right by it), drawn from its doc.md rows — the
// first row heads the columns, a <br> in a cell breaks its line
export function FigureTable({ table, label }: { table: string; label: string }) {
  const [head = [], ...body] = table
    .split("\n")
    .filter((l) => !rule(l))
    .map(cellsOf);
  const columns: TableColumn<Row>[] = head.map((h, i) => ({
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
  const rows = body.map((cells, i) => ({ key: `${i}`, cells }));
  return <Table label={label} columns={columns} rows={rows} getKey={(r) => r.key} dense grid />;
}
